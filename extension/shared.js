/* shared.js — utilitários comuns aos content scripts e à biblioteca.
   Carregado ANTES de content.js / content-tiktok.js (mesmo isolated world). */

(() => {
  const SH = {};

  // ---------- Storage ----------
  const DEFAULTS = {
    igdwnEnabled: true,
    igdwnItems: {},
    igdwnSchemaV: 2,
    igdwnProjects: ['Geral'],
    igdwnProject: 'Geral',
  };

  SH.storageGet = (keys) =>
    new Promise((resolve) => {
      chrome.storage.local.get(keys, (data) => resolve(data || {}));
    });

  SH.storageSet = (obj) =>
    new Promise((resolve) => chrome.storage.local.set(obj, resolve));

  SH.getItems = async () => {
    const data = await SH.storageGet('igdwnItems');
    return data.igdwnItems || {};
  };

  SH.saveItem = async (item) => {
    const items = await SH.getItems();
    if (!item.project) item.project = await SH.getProject();
    items[item.code] = item;
    await SH.storageSet({ igdwnItems: items });
    return item;
  };

  SH.deleteItem = async (code) => {
    const items = await SH.getItems();
    if (items[code]) {
      delete items[code];
      await SH.storageSet({ igdwnItems: items });
    }
  };

  SH.hasItem = async (code) => {
    const items = await SH.getItems();
    return !!items[code];
  };

  // ---------- Projetos ----------
  const DEFAULT_PROJECT = 'Geral';
  SH.DEFAULT_PROJECT = DEFAULT_PROJECT;

  /* Projeto de um item (itens antigos sem projeto pertencem a "Geral"). */
  SH.projectOf = (item) => (item && item.project) || DEFAULT_PROJECT;

  SH.getProjects = async () => {
    const data = await SH.storageGet('igdwnProjects');
    const list =
      Array.isArray(data.igdwnProjects) && data.igdwnProjects.length ? data.igdwnProjects : [DEFAULT_PROJECT];
    if (!list.includes(DEFAULT_PROJECT)) list.push(DEFAULT_PROJECT);
    return list;
  };

  /* Projeto atualmente selecionado (onde itens novos são salvos). */
  SH.getProject = async () => {
    const data = await SH.storageGet('igdwnProject');
    const list = await SH.getProjects();
    const cur = String(data.igdwnProject || '').trim() || DEFAULT_PROJECT;
    if (!list.includes(cur)) {
      list.push(cur);
      await SH.storageSet({ igdwnProjects: list });
    }
    return cur;
  };

  SH.setProject = async (name) => {
    const clean = String(name || '').trim() || DEFAULT_PROJECT;
    const list = await SH.getProjects();
    if (!list.includes(clean)) {
      list.push(clean);
      await SH.storageSet({ igdwnProjects: list });
    }
    await SH.storageSet({ igdwnProject: clean });
    return clean;
  };

  // ---------- Nomes de arquivo ----------
  function stripDiacritics(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  SH.slugify = (text, max) => {
    const slug = stripDiacritics(String(text || ''))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max || 60);
    return slug;
  };

  SH.sanitizeFilename = (name, ext) => {
    let base = String(name || '')
      .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 140);
    if (!base) base = 'conteudo';
    if (ext && !/^\./.test(ext)) ext = '.' + ext;
    return base + (ext || '');
  };

  /* Nome inteligente: usuario-slug-data.ext — fallback seguro p/ arquivo. */
  SH.smartFilename = ({ username, caption, date, code, ext }) => {
    const parts = [];
    if (username) parts.push(SH.slugify(username, 24));
    const slug = SH.slugify(caption, 48);
    if (slug) parts.push(slug);
    else if (code) parts.push(code.slice(0, 12));
    const ds = SH.dayStamp(date);
    if (ds) parts.push(ds);
    return SH.sanitizeFilename(parts.join('-'), ext || 'mp4');
  };

  // ---------- Datas ----------
  SH.dayKey = (ts) => {
    const d = new Date(ts);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  };

  SH.dayStamp = (ts) => {
    const d = ts ? new Date(ts) : new Date();
    return (
      String(d.getFullYear()) +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  };

  SH.formatDate = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '/' + mm + '/' + d.getFullYear();
  };

  // ---------- Texto ----------
  SH.extractHashtags = (text) => {
    const out = [];
    const re = /#[A-Za-z0-9_]+/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const tag = m[0].toLowerCase();
      if (!out.includes(tag)) out.push(tag);
    }
    return out;
  };

  SH.formatCopied = (item) => {
    const lines = [];
    if (item.author) lines.push('Autor:\n@' + item.author);
    if (item.caption) lines.push('\nLegenda:\n' + item.caption);
    if (item.hashtags && item.hashtags.length) lines.push('\nHashtags:\n' + item.hashtags.join(' '));
    if (item.link) lines.push('\nLink:\n' + item.link);
    if (item.takenAt) lines.push('\nData:\n' + SH.formatDate(item.takenAt));
    if (item.mediaType) lines.push('\nTipo:\n' + SH.typeLabel(item.mediaType));
    if (item.tags && item.tags.length) lines.push('\nTags:\n' + item.tags.join(', '));
    return lines.join('\n');
  };

  SH.copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (err) {
        return false;
      }
    }
  };

  // ---------- Metadados ----------
  const STATUS_LABELS = { pendente: 'Pendente', favorito: 'Favorito', publicado: 'Publicado', inspiracao: 'Inspiração' };
  SH.STATUSES = ['pendente', 'favorito', 'publicado', 'inspiracao'];
  SH.statusLabel = (s) => STATUS_LABELS[s] || 'Pendente';

  SH.typeLabel = (t) => {
    if (t === 1) return 'Imagem';
    if (t === 2) return 'Vídeo';
    if (t === 8) return 'Carrossel';
    return String(t || '');
  };

  SH.sourceLabel = (s) => (s === 'tiktok' ? 'TikTok' : s === 'x' ? 'X (Twitter)' : 'Instagram');

  /* Registro padrão de conteúdo reciclado. */
  SH.newItem = ({ code, source, author, caption, hashtags, link, takenAt, mediaType, videoUrl, coverUrl, coverDataUrl, carouselMedia }) => {
    const now = Date.now();
    return {
      code: String(code || now),
      source: source || 'instagram',
      author: author || '',
      caption: caption || '',
      hashtags: Array.isArray(hashtags) ? hashtags : [],
      link: link || '',
      takenAt: takenAt || null,
      savedAt: now,
      mediaType: mediaType || 2,
      videoUrl: videoUrl || '',
      coverUrl: coverUrl || '',
      coverDataUrl: coverDataUrl || '',
      carouselMedia: Array.isArray(carouselMedia) ? carouselMedia : [],
      status: 'pendente',
      tags: [],
      niche: SH.nicheFromText(caption || ''),
      counts: {},
    };
  };

  /* Classificação local de nicho por palavras-chave (sem IA). */
  const NICHE_RULES = [
    { niche: 'moda', words: ['moda', 'look', 'outfit', 'style', 'tendência', 'tendencia', 'roupa', 'estilo'] },
    { niche: 'beleza', words: ['maquiagem', 'makeup', 'skincare', 'cabelo', 'beleza', 'skin'] },
    { niche: 'fitness', words: ['treino', 'fitness', 'gym', 'academia', 'musculação', 'musculacao', 'hiit', 'corrida'] },
    { niche: 'alimentação', words: ['receita', 'comida', 'café', 'cafe', 'cozinha', 'alimentação', 'alimentacao', 'dieta', 'gastronomia'] },
    { niche: 'tech', words: ['tecnologia', 'app', 'software', 'ia ', 'inteligência artificial', 'inteligencia artificial', 'gadget', 'iphone', 'android'] },
    { niche: 'finanças', words: ['dinheiro', 'investir', 'investimento', 'renda', 'cartão', 'cartao', 'finanças', 'financas', 'economia'] },
    { niche: 'marketing', words: ['marketing', 'vendas', 'tráfego', 'trafego', 'funil', 'conversão', 'conversao', 'copy', 'social media'] },
    { niche: 'viagem', words: ['viagem', 'viagens', 'turismo', 'destino', 'roteiro', 'passagem', 'hotel', 'praia'] },
    { niche: 'motivação', words: ['motivação', 'motivacao', 'mindset', 'disciplina', 'hábito', 'habito', 'superação', 'superacao'] },
    { niche: 'humor', words: ['humor', 'piada', 'comédia', 'comedia', 'meme', 'engraçado'] },
  ];
  SH.nicheFromText = (text) => {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    for (const rule of NICHE_RULES) {
      for (const w of rule.words) {
        if (t.includes(w)) return rule.niche;
      }
    }
    return '';
  };

  /* Gancho local: primeira frase curta (<= 90 chars) da legenda. */
  SH.detectHook = (caption) => {
    const t = String(caption || '').trim();
    if (!t) return '';
    const first = t.split(/\n|(?<=[.!?])\s+/)[0].trim();
    return first.length <= 90 ? first : first.slice(0, 87) + '…';
  };

  /* Payload normalizado p/ futura integração de IA (local hoje). */
  SH.prepareAIContext = (item) => ({
    source: item.source,
    author: item.author,
    caption: item.caption,
    hashtags: item.hashtags,
    link: item.link,
    takenAt: item.takenAt,
    mediaType: item.mediaType,
    niche: item.niche || SH.nicheFromText(item.caption),
    hook: SH.detectHook(item.caption),
    status: item.status,
    tags: item.tags,
  });

  /* Local-first: análises disponíveis sem LLM. Estrutura pronta p/ plugar um provider. */
  SH.ai = {
    provider: 'local',
    local: {
      hook: SH.detectHook,
      niche: SH.nicheFromText,
    },
    /* Adaptador futuro: defina SH.ai.provider = 'ollama'|'api' e implemente estes métodos. */
    async enhance(item) {
      const ctx = SH.prepareAIContext(item);
      if (SH.ai.provider === 'local') {
        return {
          hook: ctx.hook,
          niche: ctx.niche,
          summary: '',
          ctas: [],
          hooks: [],
          roteiro: '',
        };
      }
      return null;
    },
  };

  // ---------- UI: toast discreto ----------
  SH.toast = (msg, kind) => {
    let box = document.getElementById('igdwn-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'igdwn-toast';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'igdwn-toast-item' + (kind ? ' igdwn-toast-' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('igdwn-toast-out'), 2200);
    setTimeout(() => el.remove(), 2600);
  };

  // ---------- Navegação ----------
  SH.openLibrary = (code) => {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_LIBRARY', code }, () => void chrome.runtime.lastError);
    } catch (e) { /* ignore */ }
  };

  // ---------- Banco de duplicados ----------
  SH.findDuplicate = async (code) => {
    const items = await SH.getItems();
    return items[code] || null;
  };

  // ---------- IndexedDB: armazenamento de blobs de vídeo ----------
  const BLOB_DB = 'igdwn-blobs';
  const BLOB_STORE = 'videos';
  const BLOB_VERSION = 1;

  function blobOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(BLOB_DB, BLOB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  SH.blobPut = async (key, arrayBuf) => {
    const db = await blobOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      tx.objectStore(BLOB_STORE).put(arrayBuf, key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  };

  SH.blobGet = async (key) => {
    const db = await blobOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readonly');
      const req = tx.objectStore(BLOB_STORE).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  };

  SH.blobDelete = async (key) => {
    const db = await blobOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      tx.objectStore(BLOB_STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  };

  SH.blobDeleteMany = async (keys) => {
    const db = await blobOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite');
      const store = tx.objectStore(BLOB_STORE);
      for (const k of keys) store.delete(k);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  };

  SH.blobHas = async (key) => {
    const db = await blobOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readonly');
      const req = tx.objectStore(BLOB_STORE).count(key);
      req.onsuccess = () => { db.close(); resolve(req.result > 0); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  };

  // ---------- Histórico/estatísticas ----------
  SH.stats = async () => {
    const items = await SH.getItems();
    const list = Object.values(items);
    const today = SH.dayKey(Date.now());
    const yesterdayKey = SH.dayKey(Date.now() - 86400000);
    let hoje = 0;
    let ontem = 0;
    for (const it of list) {
      const k = SH.dayKey(it.savedAt || it.takenAt || Date.now());
      if (k === today) hoje += 1;
      else if (k === yesterdayKey) ontem += 1;
    }
    return { total: list.length, hoje, ontem, items: list };
  };

  // ---------- Remoção de metadados de MP4 ----------
  SH.stripMp4Metadata = (buf) => {
    try {
      const f =
        typeof window !== 'undefined' ? window.__igdwnStripMp4Metadata : null;
      return f ? f(buf) : null;
    } catch (e) {
      return null;
    }
  };

  // ---------- Ícones SVG (sem emojis) ----------
  const S = (inner) =>
    '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    inner +
    '</svg>';
  SH.icons = {
    recycle: S('<path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"/><path d="m13.378 9.633 4.096 1.098 1.097-4.096"/>'),
    download: S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    upload: S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
    key: S('<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
    folder: S('<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>'),
    power: S('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'),
    save: S('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>'),
    check: S('<path d="M20 6 9 17l-5-5"/>'),
    more: S('<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>'),
    copy: S('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
    link: S('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    image: S('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    music: S('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    trash: S('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
    sparkles: S('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>'),
    x: S('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    checkall: S('<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>'),
    heart: S('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>'),
  };

  window.__igdwnShared = SH;
})();