/* content-tiktok.js — TikTok: download direto para Downloads */
(() => {
  if (window.__igdwnTiktokInstalled) {
    try {
      document.querySelectorAll('.igdwn-chip').forEach((c) => c.remove());
      document.querySelectorAll('[data-igdwn]').forEach((v) => v.removeAttribute('data-igdwn'));
      document.querySelectorAll('[data-igdwn-cell]').forEach((a) => a.removeAttribute('data-igdwn-cell'));
      if (window.__igdwnTiktokObserver) try { window.__igdwnTiktokObserver.disconnect(); } catch(e){}
      if (window.__igdwnTiktokInterval) try { clearInterval(window.__igdwnTiktokInterval); } catch(e){}
    } catch (e) {}
  }
  window.__igdwnTiktokInstalled = true;
  const SH = window.__igdwnShared;
  const CHIP_CLASS = 'igdwn-chip';
  const STYLE_ID = 'igdwn-style-tiktok';
  let enabled = true;
  const chipRegistry = new Map();
  chrome.storage.local.get('igdwnEnabled', (data) => {
    if (data.igdwnEnabled === false) { enabled=false; removeUI(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area!=='local' || !changes.igdwnEnabled) return;
    setEnabled(changes.igdwnEnabled.newValue!==false);
  });
  chrome.runtime.onMessage.addListener((msg)=>{ if(msg && msg.type==='IGDWN_TOGGLE') setEnabled(msg.enabled!==false); });
  function setEnabled(on){ enabled=on; if(enabled) scan(); else removeUI(); }
  function removeUI(){
    for(const [,chip] of chipRegistry) chip.remove();
    chipRegistry.clear();
    document.querySelectorAll('video[data-igdwn]').forEach(v=>v.removeAttribute('data-igdwn'));
    document.querySelectorAll('a[data-igdwn-cell]').forEach(a=>a.removeAttribute('data-igdwn-cell'));
  }
  function injectStyles(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      .igdwn-chip{position:fixed;z-index:2147483647;pointer-events:auto;display:flex;align-items:center;gap:4px;background:#0a0a0a;border:1px solid #222222;border-radius:999px;padding:3px;box-shadow:0 2px 12px rgba(0,0,0,0.5);}
      .igdwn-chip button{background:#ffffff;color:#000000;border:1px solid #ffffff;border-radius:999px;padding:6px 10px;font:600 12px/1 Inter,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}
      .igdwn-chip button:hover{background:#f0f0f0;}
      .igdwn-chip .ico{width:14px;height:14px;display:block;}
      .igdwn-chip.igdwn-busy{pointer-events:none;opacity:0.7;}
      .igdwn-hidden{display:none!important;}
      #igdwn-toast{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none;}
      .igdwn-toast-item{background:#ffffff;color:#000000;border-radius:999px;padding:8px 14px;font:500 12px/1.4 Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);max-width:420px;text-align:center;}
      .igdwn-toast-out{opacity:0;transition:opacity 0.25s;}
    `;
    document.documentElement.appendChild(style);
  }

  // ---------- helpers ----------
  function isMp4(buf){ const h=new Uint8Array(buf,0,12); return h[4]===0x66&&h[5]===0x74&&h[6]===0x79&&h[7]===0x70; }
  function saveBytes(buf, filename){
    const s=SH && SH.stripMp4Metadata ? SH.stripMp4Metadata(buf) : null;
    if(s) buf=s.buf;
    const blob=new Blob([buf],{type:'video/mp4'});
    const objectUrl=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=objectUrl; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
  }
  function fetchViaBackground(url){
    return new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage({type:'FETCH',url},(res)=>{
        if(chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if(!res||!res.ok) return reject(new Error((res&&res.error)||'fetch failed'));
        resolve(res.data);
      });
    });
  }
  async function fetchMedia(url){
    try{ const r=await fetch(url,{credentials:'include', signal: AbortSignal.timeout(20000)}); if(r.ok){ const b=await r.arrayBuffer(); if(isMp4(b)) return b; } }catch(e){}
    return fetchViaBackground(url);
  }
  function tiktokVideoUrls(){
    const sc=document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if(!sc) return [];
    let data; try{ data=JSON.parse(sc.textContent);}catch(e){ return []; }
    const scope=(data&&data.__DEFAULT_SCOPE__)||{};
    const vd=scope['webapp.video-detail']||{};
    const item=vd.itemInfo&&vd.itemInfo.itemStruct;
    if(!item||!item.video) return [];
    return tiktokVideoUrlsFromItem(item);
  }
  function tiktokVideoUrlsFromItem(item){
    if(!item||!item.video) return [];
    const video=item.video;
    const structs=Array.isArray(video.PlayAddrStruct)?video.PlayAddrStruct:[];
    const infos=Array.isArray(video.bitrateInfo)?video.bitrateInfo:[];
    const seen=new Set(); const urls=[];
    const push=(u)=>{ if(typeof u==='string'&&u&&u.startsWith('http')&&!seen.has(u)){ seen.add(u); urls.push(u); } };
    for(const s of structs){ if(s&&Array.isArray(s.UrlList)) s.UrlList.forEach(push); if(s&&Array.isArray(s.url_list)) s.url_list.forEach(push); }
    for(const b of infos){ if(b&&b.PlayAddr&&Array.isArray(b.PlayAddr.UrlList)) b.PlayAddr.UrlList.forEach(push); if(b&&b.PlayAddr&&Array.isArray(b.PlayAddr.url_list)) b.PlayAddr.url_list.forEach(push); }
    const directPlay=video.playAddr||video.play_addr||video.PlayAddr;
    if(directPlay){ if(Array.isArray(directPlay.UrlList)) directPlay.UrlList.forEach(push); if(Array.isArray(directPlay.url_list)) directPlay.url_list.forEach(push); }
    const dl=video.downloadAddr||video.download_addr||video.DownloadAddr;
    if(dl){ if(Array.isArray(dl.UrlList)) dl.UrlList.forEach(push); if(Array.isArray(dl.url_list)) dl.url_list.forEach(push); }
    return urls;
  }
  function tiktokExtractMetrics(item){
    const counts = item.stats || item.video?.stats || {};
    return { play: counts.playCount || counts.play || 0, like: counts.diggCount || counts.like || 0, comm: counts.commentCount || counts.comment || 0 };
  }
  function lastMediaUrl(){
    const entries=performance.getEntriesByType('resource');
    for(let i=entries.length-1;i>=0;i--){ const n=entries[i].name; if(/\/(play|video)\/|\.mp4(\?|$)/i.test(n) && !/\.m3u8|\.html|\.js|\.css/i.test(n)) return n; }
    return null;
  }
  const blobMap=new Map();
  function resolveUrl(video){
    const direct=video.currentSrc||video.src;
    if(direct&&!direct.startsWith('blob:')) return direct;
    const hit=blobMap.get(direct); if(hit) return hit;
    return lastMediaUrl();
  }
  function snapshotUrl(video){
    const url=lastMediaUrl();
    if(url){ blobMap.set(video.currentSrc,url); }
  }
  async function doDownload(video, filename){
    const url=resolveUrl(video);
    if(url && !url.startsWith('blob:')){
      try{ const buf=await fetchMedia(url); if(buf&&isMp4(buf)){ saveBytes(buf,filename); return true; } }catch(e){}
    }
    const urls=tiktokVideoUrls();
    for(const u of urls){ try{ const buf=await fetchMedia(u); if(buf&&isMp4(buf)){ saveBytes(buf,filename); return true; } }catch(e){} }
    const dlUrl=url||urls[0];
    if(dlUrl){
      return await new Promise((resolve)=>{
        chrome.runtime.sendMessage({type:'DOWNLOAD',url:dlUrl,filename,referer:location.href},(res)=>resolve(!!(res&&res.ok)));
      });
    }
    return false;
  }
  function smartName(code){
    if(SH && SH.smartFilename) try{ return SH.smartFilename({username:'tiktok',caption:'',date:null,code:code||'tiktok',ext:'mp4'});}catch(e){}
    return `tiktok_${(code||'video').slice(0,12)}_${Date.now().toString().slice(-6)}.mp4`;
  }
  const GRID_CODE_RE=/\/video\/(\d+)/;
  function profileHandle(){ const m=location.pathname.match(/^\/@([^\/\?\s]+)/); if(m) return m[1]; const hm=location.href.match(/\/@([^\/\?\s&]+)/); return hm?hm[1]:''; }
  function isProfileGridPage(){ return /^\/@[^\/]+/.test(location.pathname) && !/\/video\//.test(location.pathname); }
  function cellCode(a){ const href=(a&&a.getAttribute&&a.getAttribute('href'))||''; const m=href.match(GRID_CODE_RE); return m?m[1]:null; }
  function cellCoverUrl(a){ if(!a) return null; const img=a.querySelector('img'); if(img) return img.currentSrc||img.src||null; return null; }
  async function doDownloadForCell(code, href, filename){
    // tenta resolver via rehydration
    let item=null;
    try{
      const sc=document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if(sc){
        const data=JSON.parse(sc.textContent);
        let found=null;
        const walk=(node,depth)=>{
          if(depth>35||!node||typeof node!=='object'||found) return;
          if(Array.isArray(node)){ for(const it of node) walk(it,depth+1); return; }
          if(String(node.aweme_id)===String(code)||String(node.id)===String(code)) if(node.video){ found=node; return; }
          for(const v of Object.values(node)) walk(v,depth+1);
        };
        walk(data,0);
        if(found) item=found;
      }
    }catch(e){}
    let result={urls:[],play:0,like:0,comm:0};
    if(item){ result.urls=tiktokVideoUrlsFromItem(item); result.counts=tiktokExtractMetrics(item); }
    let urls=result.urls;
    if(urls.length===0){
      // tenta fetch da página do vídeo
      try{
        let url=href;
        if(!/^https?:/i.test(url)) url=location.origin+ (url.startsWith('/')?url:'/'+url);
        const resp=await fetch(url,{credentials:'include', signal: AbortSignal.timeout(20000)});
        if(resp.ok){
          const html=await resp.text();
          const doc=new DOMParser().parseFromString(html,'text/html');
          const sc=doc.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if(sc){
            const data=JSON.parse(sc.textContent);
            let found=null;
            const walk=(node,depth)=>{
              if(depth>35||!node||typeof node!=='object'||found) return;
              if(Array.isArray(node)){ for(const it of node) walk(it,depth+1); return; }
              if(String(node.aweme_id)===String(code)||String(node.id)===String(code)) if(node.video){ found=node; return; }
              for(const v of Object.values(node)) walk(v,depth+1);
            };
            walk(data,0);
            if(found){ result.urls=tiktokVideoUrlsFromItem(found); result.counts=tiktokExtractMetrics(found); urls=result.urls; }
          }
        }
      }catch(e){}
    }
    for(const u of urls){ try{ const buf=await fetchMedia(u); if(buf&&isMp4(buf)){ saveBytes(buf,filename); return true; } }catch(e){} }
    if(urls[0]){
      return await new Promise((resolve)=>{ chrome.runtime.sendMessage({type:'DOWNLOAD',url:urls[0],filename,referer:href||location.href},(r)=>resolve(!!(r&&r.ok))); });
    }
    return false;
  }

  function buildChip(video){
    const chip=document.createElement('div'); chip.className=CHIP_CLASS;
    const dl=document.createElement('button');
    dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
    dl.title='Baixar vídeo direto';
    dl.addEventListener('click',(ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      dl.classList.add('igdwn-busy'); dl.innerHTML='<span>Baixando…</span>';
      const metaFile=smartName('tiktok');
      doDownload(video, metaFile).then((ok)=>{
        dl.classList.remove('igdwn-busy'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
        SH.toast(ok?'Download iniciado':'Falha ao baixar','ok' ? 'ok':'err');
      });
    });
    chip.append(dl);
    return chip;
  }
  function buildCellChip(a, code){
    const chip=document.createElement('div'); chip.className=CHIP_CLASS; chip.dataset.code=code;
    const dl=document.createElement('button');
    dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
    dl.title='Baixar vídeo';
    dl.addEventListener('click',async(ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      dl.classList.add('igdwn-busy'); dl.innerHTML='<span>Baixando…</span>';
      const hrefRaw=(a&&a.getAttribute&&a.getAttribute('href'))||'';
      let href=hrefRaw;
      if(!href) href=location.origin+'/@'+profileHandle()+'/video/'+code;
      if(!/^https?:/i.test(href)) href=href.startsWith('/')?location.origin+href:location.origin+'/'+href;
      const filename=smartName(code);
      const ok=await doDownloadForCell(code, href, filename);
      dl.classList.remove('igdwn-busy'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
      SH.toast(ok?'Download iniciado':'Falha ao baixar','ok' ? 'ok':'err');
    });
    chip.append(dl);
    return chip;
  }

  const chipRegistry2=chipRegistry;
  function refreshChips(){
    for(const [el,chip] of chipRegistry){
      if(!el.isConnected){ chip.remove(); chipRegistry.delete(el); continue; }
      const r=el.getBoundingClientRect();
      const inView=r.width>0&&r.height>0&&r.bottom>0&&r.top<window.innerHeight;
      const hovering=chip.dataset.hovering==='1';
      const pinned=chip.dataset.pinned==='1';
      if((hovering||pinned)&&inView){ chip.style.left=Math.max(4,r.right-chip.offsetWidth-8)+'px'; chip.style.top=Math.max(4,r.top+8)+'px'; chip.classList.remove('igdwn-hidden'); }
      else chip.classList.add('igdwn-hidden');
    }
  }
  let pointerRaf=null;
  function onPointerMove(e){
    if(pointerRaf) return;
    pointerRaf=requestAnimationFrame(()=>{
      pointerRaf=null;
      const x=e.clientX,y=e.clientY;
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
    video.dataset.igdwn='1';
    const chip=buildChip(video);
    chip.classList.add('igdwn-hidden');
    chipRegistry.set(video, chip);
    video.addEventListener('loadeddata',()=>snapshotUrl(video));
    video.addEventListener('playing',()=>snapshotUrl(video));
    const onPlay=()=>{ chip.dataset.pinned='1'; refreshChips(); };
    const onPause=()=>{ delete chip.dataset.pinned; refreshChips(); };
    video.addEventListener('playing',onPlay);
    video.addEventListener('pause',onPause);
    chip.addEventListener('click',(ev)=>ev.stopPropagation());
    document.body.appendChild(chip);
  }
  function attachToCell(a){
    if(!enabled||!a||a.dataset.igdwnCell==='1') return;
    const code=cellCode(a); if(!code) return;
    const rect=a.getBoundingClientRect();
    if(rect.width===0&&rect.height===0&&!a.querySelector('img')) return;
    a.dataset.igdwnCell='1';
    const chip=buildCellChip(a,code);
    chip.classList.add('igdwn-hidden');
    chipRegistry.set(a, chip);
    document.body.appendChild(chip);
  }
  let refreshRaf=null;
  function throttledRefresh(){ if(refreshRaf) return; refreshRaf=requestAnimationFrame(()=>{ refreshRaf=null; refreshChips(); }); }
  function scan(){
    if(!enabled) return;
    document.querySelectorAll('video').forEach(attachTo);
    if(isProfileGridPage()){
      document.querySelectorAll('a[href*="/video/"]').forEach(attachToCell);
      document.querySelectorAll('[data-e2e="user-post-item"] a[href*="/video/"], [data-e2e="user-post-item-list"] a[href*="/video/"]').forEach(attachToCell);
    }
  }
  injectStyles(); scan();
  document.addEventListener('mousemove', onPointerMove, true);
  window.addEventListener('scroll', throttledRefresh, true);
  window.addEventListener('resize', throttledRefresh);
  let timer=null;
  const obs = new MutationObserver(()=>{ clearTimeout(timer); timer=setTimeout(scan,150); });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  window.__igdwnTiktokObserver = obs;
  window.__igdwnTiktokInterval = setInterval(()=>{
    // Auto-harvest tiktok rehydration items
    try {
      const sc = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (sc && SH && SH.saveItem) {
        const data = JSON.parse(sc.textContent);
        const walk = (node, depth) => {
          if (depth > 30 || !node || typeof node !== 'object') return;
          if (Array.isArray(node)) { for (const it of node) walk(it, depth + 1); return; }
          if (node.video && (node.aweme_id || node.id)) {
            const code = String(node.aweme_id || node.id);
            const urls = tiktokVideoUrlsFromItem(node);
            const stats = node.stats || {};
            if (urls.length > 0) {
              SH.saveItem({
                code: code,
                source: 'tiktok',
                author: (node.author && node.author.uniqueId) || '',
                caption: node.desc || '',
                link: location.origin + '/@' + ((node.author && node.author.uniqueId) || 'user') + '/video/' + code,
                takenAt: node.createTime ? node.createTime * 1000 : Date.now(),
                mediaType: 2,
                videoUrl: urls[0],
                coverUrl: (node.video.cover && node.video.cover.url_list && node.video.cover.url_list[0]) || '',
                counts: { play: stats.playCount || 0, like: stats.diggCount || 0, comm: stats.commentCount || 0 }
              }).catch(()=>{});
            }
          }
          for (const v of Object.values(node)) walk(v, depth + 1);
        };
        walk(data, 0);
      }
    } catch(e) {}

    for (const [el, chip] of chipRegistry) if (!el.isConnected) { try{ chip.remove(); }catch(e){} chipRegistry.delete(el); }
    // dedup por código
    const seen=new Map();
    for (const [el, chip] of [...chipRegistry]) {
      if (!el.dataset || el.dataset.igdwnCell!=='1') continue;
      const c=cellCode(el); if(!c) continue;
      if (seen.has(c)) { try{ chip.remove(); }catch(e){} chipRegistry.delete(el); el.removeAttribute('data-igdwn-cell'); }
      else seen.set(c, el);
    }
  }, 3000);
})();
