/* content.js — Instagram: download direto para Downloads (sem biblioteca) */
(() => {
  if (window.__igdwnContentInstalled) {
    try {
      document.querySelectorAll('.igdwn-chip').forEach((c) => c.remove());
      document.querySelectorAll('[data-igdwn]').forEach((v) => v.removeAttribute('data-igdwn'));
      document.querySelectorAll('[data-igdwn-cell]').forEach((a) => a.removeAttribute('data-igdwn-cell'));
      if (window.__igdwnObserver) try { window.__igdwnObserver.disconnect(); } catch(e){}
      if (window.__igdwnCleanInterval) try { clearInterval(window.__igdwnCleanInterval); } catch(e){}
    } catch (e) {}
  }
  window.__igdwnContentInstalled = true;

  const SH = window.__igdwnShared;
  const CHIP_CLASS = 'igdwn-chip';
  const STYLE_ID = 'igdwn-style';
  let enabled = true;
  const chipRegistry = new Map();

  chrome.storage.local.get('igdwnEnabled', (data) => {
    if (data.igdwnEnabled === false) { enabled = false; removeUI(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.igdwnEnabled) return;
    setEnabled(changes.igdwnEnabled.newValue !== false);
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'IGDWN_TOGGLE') return;
    setEnabled(msg.enabled !== false);
  });
  function setEnabled(on) { enabled = on; if (enabled) scan(); else removeUI(); }
  function removeUI() {
    for (const [, chip] of chipRegistry) chip.remove();
    chipRegistry.clear();
    document.querySelectorAll('video[data-igdwn]').forEach((v) => v.removeAttribute('data-igdwn'));
    document.querySelectorAll('a[data-igdwn-cell]').forEach((a) => a.removeAttribute('data-igdwn-cell'));
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .igdwn-chip {
        position: fixed;
        z-index: 2147483646;
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 4px;
        background: #0a0a0a;
        border: 1px solid #222222;
        border-radius: 999px;
        padding: 3px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.5);
        max-width: 92vw;
        overflow: hidden;
      }
      .igdwn-chip button {
        background: #ffffff;
        color: #000000;
        border: 1px solid #ffffff;
        border-radius: 999px;
        padding: 6px 10px;
        font: 600 12px/1 Inter, sans-serif;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      .igdwn-chip button:hover { background: #f0f0f0; }
      .igdwn-chip .ico { width: 14px; height: 14px; display: block; }
      .igdwn-chip.igdwn-busy { pointer-events: none; opacity: 0.7; }
      .igdwn-hidden { display: none !important; }
      #igdwn-toast {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: center;
        pointer-events: none;
      }
      .igdwn-toast-item {
        background: #ffffff;
        color: #000000;
        border-radius: 999px;
        padding: 8px 14px;
        font: 500 12px/1.4 Inter, sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        max-width: 420px;
        text-align: center;
      }
      .igdwn-toast-out { opacity: 0; transition: opacity 0.25s; }
    `;
    document.documentElement.appendChild(style);
  }

  let __igdwnCache = null;
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.type === 'IGDWN_GQL_DATA') {
      __igdwnCache = e.data.payload;
    }
  });
  function getTapData() {
    return __igdwnCache;
  }
  function tapEntryForCode(code) {
    if (!code) return null;
    const data = getTapData(); if (!data || !data.byCode) return null;
    return data.byCode[code] || null;
  }
  function tapUrlForCode(code) { const e = tapEntryForCode(code); return e && e.v ? e.v : null; }

  function shortcodeForVideo(video) {
    let el = video;
    for (let i = 0; el && i < 6; i += 1, el = el.parentElement) {
      const a = el.querySelector ? el.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]') : null;
      if (a) { const m = a.getAttribute('href').match(/\/(?:p|reel|reels)\/([^/]+)/); if (m) return m[1]; }
    }
    return pageCode();
  }
  function pageCode() { const m = location.pathname.match(/\/(?:p|reel|reels)\/([^/]+)/); return m ? m[1] : null; }
  function isValidCode(c){ return typeof c==='string' && /^[A-Za-z0-9_-]{6,30}$/.test(c); }
  function resolveUrl(video) {
    const direct = video.currentSrc || video.src;
    if (direct && !direct.startsWith('blob:')) return direct;
    const cands = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\.mp4(\?|$)/i.test(n) && !/\.m3u8|\.html/i.test(n));
    return cands[cands.length - 1] || null;
  }
  function isHls(url) { return /\.m3u8(\?|$)/i.test(url); }
  function isMp4(buf){ const h=new Uint8Array(buf,0,12); return h[4]===0x66&&h[5]===0x74&&h[6]===0x79&&h[7]===0x70; }
  const RELAY_SCRIPTS = 'script[type="application/json"][data-sjs]';
  function findRelayItems(){
    const items=[]; const search=(node,depth)=>{
      if(depth>30||node===null||typeof node!=='object') return;
      if(Array.isArray(node)){ for(const it of node) search(it,depth+1); return; }
      if(typeof node.video_versions==='object'&&node.video_versions!==null){ items.push(node); return; }
      for(const v of Object.values(node)) search(v,depth+1);
    };
    for(const sc of document.querySelectorAll(RELAY_SCRIPTS)){ let d; try{ d=JSON.parse(sc.textContent);}catch(e){ continue; } search(d,0); }
    return items;
  }
  function findRelayItemForVideo(video){
    const code=shortcodeForVideo(video); if(code){ const h=findRelayItemForCode(code); if(h) return h; }
    const items=findRelayItems(); return items.length?items[0]:null;
  }
  function findRelayItemForCode(code){
    if(!code) return null;
    for(const sc of document.querySelectorAll(RELAY_SCRIPTS)){
      let d; try{ d=JSON.parse(sc.textContent);}catch(e){ continue; }
      const search=(node,depth)=>{
        if(depth>25||!node||typeof node!=='object') return null;
        if(Array.isArray(node)){ for(const it of node){ const r=search(it,depth+1); if(r) return r; } return null; }
        if(node.code===code||node.shortcode===code) if(Array.isArray(node.video_versions)||node.image_versions2) return node;
        for(const v of Object.values(node)){ const r=search(v,depth+1); if(r) return r; }
        return null;
      };
      const hit=search(d,0); if(hit) return hit;
    }
    return null;
  }
  function pickBestVideoURL(item){
    const versions=item.video_versions; if(!Array.isArray(versions)||!versions.length) return null;
    const best=versions.find((v)=>v.type===101)||versions[0];
    return best&&best.url&&!best.url.startsWith('blob:')?best.url:null;
  }
  function videoFamilyUrls(){
    const byKey=new Map();
    for(const e of performance.getEntriesByType('resource')){
      if(!e.name.includes('bytestart')) continue;
      let url; try{ url=new URL(e.name);}catch(e){ continue; }
      url.searchParams.delete('bytestart'); url.searchParams.delete('byteend');
      const key=url.origin+url.pathname+url.search; if(byKey.has(key)) continue;
      const m=/\/m(\d+)\//.exec(url.pathname);
      byKey.set(key,{url:url.toString(),score:m?parseInt(m[1],10):0,time:e.startTime||0});
    }
    return [...byKey.values()].sort((a,b)=>b.score-a.score||b.time-a.time);
  }
  function fetchFullFromFamily(family){ const sep=family.includes('?')?'&':'?'; return fetch(family+sep+'bytestart=0&byteend=999999999'); }
  function hasVideoTrack(buf){
    const len=Math.min(buf.byteLength,2*1024*1024); const view=new Uint8Array(buf,0,len);
    let s=''; const chunk=65536; for(let i=0;i<view.length;i+=chunk) s+=String.fromCharCode.apply(null,view.subarray(i,i+chunk));
    return /avc1|hvc1|hev1|vp09|av01|mp4v/i.test(s);
  }
  function saveBytes(buf,filename){
    const s=SH&&SH.stripMp4Metadata?SH.stripMp4Metadata(buf):null; if(s) buf=s.buf;
    const blob=new Blob([buf],{type:'video/mp4'}); const objectUrl=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=objectUrl; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
  }
  function fetchViaBackground(url, opts){
    return new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage({type:'FETCH',url,headers:opts&&opts.headers},(res)=>{
        if(chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if(!res||!res.ok) return reject(new Error((res&&res.error)||'fetch failed'));
        resolve(res.data);
      });
    });
  }
  async function trySave(buf,url,filename,opts){
    if(isMp4(buf)&&(!opts||!opts.requireVideo||hasVideoTrack(buf))){ saveBytes(buf,filename); return true; }
    return false;
  }
  async function doDownload(url, video, filename){
    try{ const r=await fetch(url, { signal: AbortSignal.timeout(20000) }); if(r.ok){ const b=await r.arrayBuffer(); if(await trySave(b,url,filename)) return true; } }catch(e){}
    try{
      let relayUrl=null;
      if(video){ const c=shortcodeForVideo(video); relayUrl=tapUrlForCode(c); if(!relayUrl){ const it=findRelayItemForVideo(video); relayUrl=it?pickBestVideoURL(it):null; } }
      if(relayUrl&&relayUrl!==url){ const r=await fetch(relayUrl, { signal: AbortSignal.timeout(20000) }); if(r.ok){ const b=await r.arrayBuffer(); if(await trySave(b,relayUrl,filename)) return true; } }
    }catch(e){}
    try{
      const families=videoFamilyUrls();
      for(const fam of families){ try{ const r=await fetchFullFromFamily(fam.url); if(!r.ok) throw new Error('status '+r.status); const b=await r.arrayBuffer(); if(await trySave(b,fam.url,filename,{requireVideo:true})) return true; }catch(e){} }
    }catch(e){}
    try{ const b=await fetchViaBackground(url); if(await trySave(b,url,filename)) return true; }catch(e){}
    let dlUrl=url; try{ const u=new URL(dlUrl); if(u.searchParams.has('bytestart')){ u.searchParams.delete('bytestart'); u.searchParams.delete('byteend'); dlUrl=u.toString(); } }catch(e){}
    return await new Promise((resolve)=>{ chrome.runtime.sendMessage({type:'DOWNLOAD',url:dlUrl,filename,referer:location.href},(res)=> resolve(!!(res&&res.ok))); });
  }

  function smartName(code){
    if(SH&&SH.smartFilename){ try{ const e=tapEntryForCode(code); const meta={username:(e&&e.a)||'',caption:(e&&e.c)||'',date:null,code:code||'video',ext:'mp4'}; return SH.smartFilename(meta);}catch(e){} }
    return `instagram_${(code||'video').slice(0,12)}_${Date.now().toString().slice(-6)}.mp4`;
  }

  function decodeEmbedHtml(text){
    let s=String(text||'').replace(/&amp;/g,'&');
    s=s.replace(/\\+u([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
    s=s.replace(/\\+\//g,'/');
    return s;
  }

  function pickEmbedVideoUrl(html){
    const s=decodeEmbedHtml(html);
    let url=null;
    const i=s.indexOf('video_url');
    if(i>=0){ const m=s.slice(i).match(/https?:\/\/[^"\\\s]+/); if(m) url=m[0]; }
    if(!url){ const m=s.match(/https?:\/\/[^"\\\s]+\.mp4[^"\\\s]*/); if(m) url=m[0]; }
    return url?url.replace(/\\+$/,'').replace(/&amp;/g,'&'):null;
  }

  async function embedVideoUrl(code){
    for(const kind of ['reel','p']){
      const url=location.origin+'/'+kind+'/'+code+'/embed/captioned/';
      try{
        let html=null;
        try{ const r=await fetch(url,{credentials:'include'}); if(r.ok) html=await r.text(); }catch(e){}
        if(!html){ try{ const buf=await fetchViaBackground(url); if(buf) html=new TextDecoder().decode(new Uint8Array(buf)); }catch(e){} }
        if(html){ const u=pickEmbedVideoUrl(html); if(u) return u; }
      }catch(e){}
    }
    return null;
  }

  function buildChip(video, code){
    const chip=document.createElement('div'); chip.className=CHIP_CLASS;
    const dl=document.createElement('button'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>'; dl.title='Baixar vídeo';
    dl.addEventListener('click', async(ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      dl.classList.add('igdwn-busy'); dl.innerHTML='<span>Baixando…</span>';
      let url=tapUrlForCode(code); if(!url) url=resolveUrl(video);
      if(!url||isHls(url)){ const it=findRelayItemForVideo(video); const ru=it?pickBestVideoURL(it):null; if(ru) url=ru; }
      const c=code||shortcodeForVideo(video)||'video'; const filename=smartName(c);
      const entry = tapEntryForCode(c);
      if (entry && SH && SH.saveItem) {
        SH.saveItem({
          code: c,
          source: 'instagram',
          author: entry.a || '',
          caption: entry.c || '',
          link: location.href,
          takenAt: entry.t ? entry.t * 1000 : Date.now(),
          mediaType: entry.m || 2,
          videoUrl: url,
          coverUrl: entry.w || '',
          counts: { play: entry.play || 0, like: entry.like || 0, comm: entry.comm || 0 }
        }).catch(()=>{});
      }
      if(!url||isHls(url)){ SH.toast(isHls(url)?'HLS não suportado':'Aguarde o vídeo carregar','err'); dl.classList.remove('igdwn-busy'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>'; return; }
      const ok=await doDownload(url,video,filename);
      dl.classList.remove('igdwn-busy'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
      SH.toast(ok?'Download iniciado — veja em Downloads':'Falha ao baixar','ok');
    });
    chip.append(dl); return chip;
  }

  function cellCode(a){ const m=(a.getAttribute('href')||'').match(/\/(?:p|reel|reels)\/([^/]+)/); return m?m[1]:null; }
  function bgImageUrl(el){
    if(!el) return null;
    const inline=el.style&&el.style.backgroundImage;
    if(inline&&inline!=='none'){ const m=inline.match(/url\(["']?(.*?)["']?\)/); if(m&&m[1]) return m[1]; }
    try{
      const computed=getComputedStyle(el).backgroundImage;
      if(computed&&computed!=='none'){ const m=computed.match(/url\(["']?(.*?)["']?\)/); if(m&&m[1]) return m[1]; }
    }catch(e){}
    return null;
  }
  function cellImage(a){
    const img=a.querySelector('img'); if(img) return img.currentSrc||img.src||null;
    const video=a.querySelector('video'); if(video&&video.poster) return video.poster;
    const node=a.querySelector('[style*="background-image"]'); if(node) return bgImageUrl(node);
    const first=a.firstElementChild; return bgImageUrl(first);
  }
  function cellHasThumb(a){ return !!cellImage(a); }

  // tenta resolver URL direto sem precisar abrir o reel na UI: TAP -> relay -> API shortcode -> viewer HTML
  async function resolveCellVideoUrl(code){
    if(!code||!isValidCode(code)) return null;
    const tapUrl=tapUrlForCode(code); if(tapUrl) return tapUrl;
    const item=findRelayItemForCode(code); if(item){ const u=pickBestVideoURL(item); if(u) return u; }
    // 2.a: embed público (/embed/captioned/) expõe video_url mesmo sem abrir o reel
    const embed=await embedVideoUrl(code); if(embed) return embed;
    // 2.b: API privada shortcode (mais confiável que viewer HTML)
    const apiUrls=[
      `https://www.instagram.com/api/v1/media/shortcode/${code}/info/`,
      `https://i.instagram.com/api/v1/media/shortcode/${code}/info/`
    ];
    for(const api of apiUrls){
      try{
        // tenta via content fetch (com credenciais) e via background como fallback
        const apiHeaders={'x-ig-app-id':'936619743392459','x-requested-with':'XMLHttpRequest'};
        let text=null;
        try{ const r=await fetch(api,{credentials:'include',headers:apiHeaders}); if(r.ok) text=await r.text(); }catch(e){}
        if(!text){ try{ const buf=await fetchViaBackground(api,{headers:apiHeaders}); // background retorna ArrayBuffer
            if(buf) text=new TextDecoder().decode(new Uint8Array(buf).slice(0,800000)); }catch(e){} }
        if(text && text.length>20){
          // procura video_versions no JSON
          const m=text.match(/"video_versions"\s*:\s*\[/);
          if(m){
            try{
              const j=JSON.parse(text);
              const walk=(n)=>{
                if(!n||typeof n!=='object') return null;
                if(Array.isArray(n)){ for(const it of n){ const r=walk(it); if(r) return r; } return null; }
                if(Array.isArray(n.video_versions)) return n;
                for(const v of Object.values(n)){ const r=walk(v); if(r) return r; }
                return null;
              };
              const hit=walk(j);
              if(hit){ const u=pickBestVideoURL(hit); if(u) return u; }
              // formato alternativo items[0]
              if(j.items && j.items[0]){ const u=pickBestVideoURL(j.items[0]); if(u) return u; }
              if(j.media) { const u=pickBestVideoURL(j.media); if(u) return u; }
            }catch(e){}
            // fallback regex
            const rm=text.match(/"url"\s*:\s*"(https:\/\/[^"]+\.mp4[^"]*)"/);
            if(rm) return rm[1].replace(/\\u0026/g,'&').replace(/\\/g,'');
          }
        }
      }catch(e){}
    }
    // 3: viewer HTML (último recurso, não exige navegação do usuário, só fetch em background)
    try{
      const viewerUrl=location.origin+'/reel/'+code+'/';
      let html=null;
      try{ const r=await fetch(viewerUrl,{credentials:'include'}); if(r.ok) html=await r.text(); }catch(e){}
      if(!html){ // tenta via background se bloqueado
        try{ const buf=await fetchViaBackground(viewerUrl); if(buf) html=new TextDecoder().decode(new Uint8Array(buf)); }catch(e){}
      }
      if(html){
        const doc=new DOMParser().parseFromString(html,'text/html');
        for(const sc of doc.querySelectorAll('script[type="application/json"][data-sjs]')){
          try{
            const data=JSON.parse(sc.textContent);
            const search=(node,depth)=>{
              if(depth>25||!node||typeof node!=='object') return null;
              if(Array.isArray(node)){ for(const it of node){ const r=search(it,depth+1); if(r) return r; } return null; }
              if(node.code===code||node.shortcode===code) if(node.video_versions) return node;
              for(const v of Object.values(node)){ const r=search(v,depth+1); if(r) return r; }
              return null;
            };
            const hit=search(data,0); if(hit){ const u=pickBestVideoURL(hit); if(u) return u; }
          }catch(e){}
        }
        const og=html.match(/property="og:video(?::url)?"\s+content="([^"]+)"/i); if(og&&og[1]) return og[1].replace(/&amp;/g,'&');
        const pm=html.match(/"playable_url"\s*:\s*"([^"]+)"/); if(pm&&pm[1]) return pm[1].replace(/\\u0026/g,'&').replace(/\\/g,'');
      }
    }catch(e){}
    return null;
  }

  function buildCellChip(a, code){
    const chip=document.createElement('div'); chip.className=CHIP_CLASS; chip.dataset.code=code;
    const dl=document.createElement('button'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>'; dl.title='Baixar direto — sem abrir o reel';
    dl.addEventListener('click', async(ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      dl.classList.add('igdwn-busy'); dl.innerHTML='<span>Baixando…</span>';
      const filename=smartName(code);
      let url=await resolveCellVideoUrl(code);
      if(url){
        const ok=await doDownload(url,null,filename);
        dl.classList.remove('igdwn-busy'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
        SH.toast(ok?'Download iniciado':'Falha — tente novamente','ok');
        return;
      }
      const imgUrl=cellImage(a);
      if(imgUrl){
        try{
          const r=await fetch(imgUrl); const blob=await r.blob();
          const objectUrl=URL.createObjectURL(blob); const ae=document.createElement('a');
          ae.href=objectUrl; ae.download=filename.replace(/\.mp4$/,'.jpg'); document.body.appendChild(ae); ae.click(); ae.remove(); setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
          SH.toast('Vídeo ainda não disponível — capa baixada. Role a grade e tente de novo.','ok');
        }catch(e){ SH.toast('Não foi possível resolver — role a grade e tente novamente','err'); }
      } else SH.toast('Não foi possível resolver — role a grade e tente novamente','err');
      dl.classList.remove('igdwn-busy'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
    });
    chip.append(dl); return chip;
  }

  function refreshChips(){
    const vw=window.innerWidth, vh=window.innerHeight;
    for(const [el,chip] of chipRegistry){
      if(!el.isConnected){ chip.remove(); chipRegistry.delete(el); continue; }
      const r=el.getBoundingClientRect();
      const inView=r.width>80&&r.height>80&&r.bottom>20&&r.top < vh-20 && r.right>20 && r.left < vw-20;
      const hovering=chip.dataset.hovering==='1';
      const pinned=chip.dataset.pinned==='1';
      // esconde imediatamente se fora da viewport ou se está dentro de modal fechado
      if(!inView){ chip.classList.add('igdwn-hidden'); continue; }
      // vazamento: limita posição dentro do viewport e dentro do elemento
      if((hovering||pinned) && inView){
        // garante que o chip não vaze para fora do vídeo (clamp)
        const cw=chip.offsetWidth||120, ch=chip.offsetHeight||32;
        let left=Math.round(r.right - cw - 8);
        let top=Math.round(r.top + 8);
        left=Math.max(8, Math.min(left, vw - cw - 8));
        top=Math.max(8, Math.min(top, vh - ch - 8));
        // se vídeo muito pequeno, centraliza no topo do vídeo
        if(r.width < cw+16) left=Math.round(r.left + (r.width - cw)/2);
        chip.style.left=left+'px'; chip.style.top=top+'px';
        chip.classList.remove('igdwn-hidden');
      } else chip.classList.add('igdwn-hidden');
    }
  }
  let pointerRaf=null;
  function onPointerMove(e){
    if(pointerRaf) return;
    pointerRaf=requestAnimationFrame(()=>{
      pointerRaf=null; const x=e.clientX,y=e.clientY;
      for(const [el,chip] of chipRegistry){
        if(!el.isConnected) continue;
        const r=el.getBoundingClientRect();
        const overEl=r.width>0&&r.left<=x&&x<=r.right&&r.top<=y&&y<=r.bottom;
        const cr=chip.getBoundingClientRect();
        const overChip=cr.width>0&&cr.left<=x&&x<=cr.right&&cr.top<=y&&y<=cr.bottom;
        chip.dataset.hovering=overEl||overChip?'1':'0';
      }
      refreshChips();
    });
  }
  function attachTo(video){
    if(!enabled||video.dataset.igdwn==='1') return;
    // ignora vídeos minúsculos (story preview, avatar)
    const rr=video.getBoundingClientRect(); if(rr.width<120||rr.height<120) {
      // mas se for reel em tela cheia, ainda é grande — então só ignora se muito pequeno
      if(rr.width<50||rr.height<50) return;
    }
    video.dataset.igdwn='1';
    const code=shortcodeForVideo(video);
    const chip=buildChip(video,code);
    chip.classList.add('igdwn-hidden');
    chipRegistry.set(video,chip);
    const onPlay=()=>{ chip.dataset.pinned='1'; refreshChips(); };
    const onPause=()=>{ delete chip.dataset.pinned; refreshChips(); };
    video.addEventListener('playing',onPlay); video.addEventListener('pause',onPause);
    chip.addEventListener('click',(ev)=>ev.stopPropagation());
    document.body.appendChild(chip);
  }
  function attachToCell(a){
    if(!enabled||!a||a.dataset.igdwnCell==='1') return;
    const code=cellCode(a); if(!code||!isValidCode(code)) return;
    try{
      if(a.querySelector('video')) return;
      const art=a.closest('article'); if(art&&art.querySelector('video')) return;
      if(a.closest('nav, header, footer, [role="navigation"]')) return;
      for(const [el] of chipRegistry){
        if(el.dataset&&el.dataset.igdwnCell==='1'&&el.isConnected){
          const ec=cellCode(el); if(ec===code){
            const r1=el.getBoundingClientRect(); const r2=a.getBoundingClientRect();
            const near=Math.abs(r1.left-r2.left)<5&&Math.abs(r1.top-r2.top)<5&&Math.abs(r1.width-r2.width)<5;
            if(near) return;
            const dist=Math.hypot(r1.left-r2.left, r1.top-r2.top);
            if(dist<30&&r1.width>0&&r2.width>0) return;
          }
        }
      }
    }catch(e){}
    const rect=a.getBoundingClientRect();
    if(rect.width<80||rect.height<80) return;
    if(!cellHasThumb(a)) return;
    a.dataset.igdwnCell='1';
    const chip=buildCellChip(a,code);
    chip.classList.add('igdwn-hidden');
    chipRegistry.set(a,chip);
    document.body.appendChild(chip);
  }
  let refreshRaf=null;
  function throttledRefresh(){ if(refreshRaf) return; refreshRaf=requestAnimationFrame(()=>{ refreshRaf=null; refreshChips(); }); }
  function scan(){
    if(!enabled) return;
    document.querySelectorAll('video').forEach(attachTo);
    document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]').forEach(attachToCell);
  }
  injectStyles(); scan();
  document.addEventListener('mousemove', onPointerMove, true);
  window.addEventListener('scroll', throttledRefresh, true);
  window.addEventListener('resize', throttledRefresh);
  let timer=null;
  const obs=new MutationObserver(()=>{ clearTimeout(timer); timer=setTimeout(scan,150); });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  window.__igdwnObserver=obs;
  window.__igdwnCleanInterval=setInterval(()=>{
    // Auto-harvest tap data into storage for bulk download library
    const tapData = getTapData();
    if (tapData && tapData.byCode) {
      for (const [code, entry] of Object.entries(tapData.byCode)) {
        if (entry && entry.v && SH && SH.saveItem) {
          SH.saveItem({
            code: code,
            source: 'instagram',
            author: entry.a || '',
            caption: entry.c || '',
            link: location.origin + '/p/' + code + '/',
            takenAt: entry.t ? entry.t * 1000 : Date.now(),
            mediaType: entry.m || 2,
            videoUrl: entry.v,
            coverUrl: entry.w || '',
            counts: { play: entry.play || 0, like: entry.like || 0, comm: entry.comm || 0 }
          }).catch(()=>{});
        }
      }
    }

    for(const [el,chip] of chipRegistry) if(!el.isConnected){ try{ chip.remove(); }catch(e){} chipRegistry.delete(el); }
    const seen=new Map();
    for(const [el,chip] of [...chipRegistry]){
      if(!el.dataset||el.dataset.igdwnCell!=='1') continue;
      const c=cellCode(el); if(!c) continue;
      if(seen.has(c)){ try{ chip.remove(); }catch(e){} chipRegistry.delete(el); el.removeAttribute('data-igdwn-cell'); }
      else seen.set(c,el);
    }
    refreshChips();
  }, 2500);
  // esconde chips quando Instagram abre modal de reel (evita vazamento no fundo)
  const mo=new MutationObserver(()=>{ throttledRefresh(); });
  mo.observe(document.body,{attributes:true, attributeFilter:['style','class']});
})();
