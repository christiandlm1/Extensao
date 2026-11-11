/* content-x.js — X/Twitter: download direto para Downloads */
(() => {
  if (window.__igdwnXInstalled) {
    try {
      document.querySelectorAll('.igdwn-chip').forEach((c) => c.remove());
      document.querySelectorAll('[data-igdwn]').forEach((v) => v.removeAttribute('data-igdwn'));
      if (window.__igdwnXObserver) try { window.__igdwnXObserver.disconnect(); } catch(e){}
      if (window.__igdwnXInterval) try { clearInterval(window.__igdwnXInterval); } catch(e){}
    } catch (e) {}
  }
  window.__igdwnXInstalled = true;
  const SH = window.__igdwnShared;
  const CHIP_CLASS = 'igdwn-chip';
  const STYLE_ID = 'igdwn-style-x';
  let enabled = true;
  const chipRegistry = new Map();
  chrome.storage.local.get('igdwnEnabled', (data) => { if(data.igdwnEnabled===false){ enabled=false; removeUI(); }});
  chrome.storage.onChanged.addListener((changes, area)=>{ if(area!=='local'||!changes.igdwnEnabled) return; setEnabled(changes.igdwnEnabled.newValue!==false); });
  chrome.runtime.onMessage.addListener((msg)=>{ if(!msg||msg.type!=='IGDWN_TOGGLE') return; setEnabled(msg.enabled!==false); });
  function setEnabled(on){ enabled=on; if(enabled) scan(); else removeUI(); }
  function removeUI(){
    for(const [,chip] of chipRegistry) chip.remove();
    chipRegistry.clear();
    document.querySelectorAll('video[data-igdwn], img[data-igdwn]').forEach(v=>v.removeAttribute('data-igdwn'));
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
  function isFullVideoUrl(u){
    if(!u||typeof u!=='string') return false;
    if(/\.m3u8(\?|$)|\.m4s(\?|$)|\.ts(\?|$)/i.test(u)) return false;
    if(/amplify_video_thumb|pbs\.twimg\.com|\.jpg(\?|$)|\.jpeg(\?|$)|\.png(\?|$)|\.webp(\?|$)/i.test(u)) return false;
    if(/\/init\.mp4|media_\d+\.mp4|seg-|seg\d+\.mp4/i.test(u)) return false;
    return /video\.twimg\.com|ext_tw_video|amplify_video/i.test(u);
  }
  function xVideoUrls(){
    const out=[]; const seen=new Set();
    for(const e of performance.getEntriesByType('resource')){
      const n=e.name; if(!isFullVideoUrl(n)) continue;
      let u=n; try{ const p=new URL(n); p.searchParams.delete('bytestart'); p.searchParams.delete('byteend'); p.searchParams.delete('tag'); u=p.toString(); }catch(e){}
      if(!seen.has(u)){ seen.add(u); out.push(u); }
    }
    return out;
  }
  function resolveVideoUrl(video){
    const direct=video.currentSrc||video.src;
    if(direct&&!direct.startsWith('blob:')) return direct;
    const hit=blobMap.get(direct); if(hit) return hit;
    const urls=xVideoUrls(); return urls[urls.length-1]||null;
  }
  function snapshotUrl(video){
    const urls=xVideoUrls(); const last=urls[urls.length-1];
    if(last) blobMap.set(video.currentSrc,last);
  }
  const blobMap=new Map();
  function isMp4(buf){ const h=new Uint8Array(buf,0,12); return h[4]===0x66&&h[5]===0x74&&h[6]===0x79&&h[7]===0x70; }
  function saveBytes(buf, filename){
    let out=buf;
    const remuxed=window.__igdwnRemuxFragmented ? window.__igdwnRemuxFragmented(buf) : null;
    if(remuxed) out=remuxed;
    if(out===buf){ const s=SH.stripMp4Metadata(buf); if(s) out=s.buf; }
    const blob=new Blob([out],{type:'video/mp4'});
    const objectUrl=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=objectUrl; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
  }
  function downloadBytes(buf, filename){
    return new Promise((resolve)=>{
      chrome.runtime.sendMessage({type:'DOWNLOAD_BYTES',data:buf,filename},(res)=>{
        if(chrome.runtime.lastError) return resolve(false);
        resolve(!!(res&&res.ok));
      });
    });
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
  function downloadViaDownloads(url, filename){
    return new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage({type:'DOWNLOAD_URL',url,filename},(res)=>{
        if(chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if(!res||!res.ok) return reject(new Error((res&&res.error)||'download falhou'));
        resolve(true);
      });
    });
  }
  async function fetchFull(url){
    try{ const r=await fetch(url,{credentials:'include'}); if(r.ok){ const b=await r.arrayBuffer(); if(isMp4(b)) return b; } }catch(e){}
    const sep=url.includes('?')?'&':'?';
    const r=await fetch(url+sep+'bytestart=0&byteend=999999999',{credentials:'include'});
    if(!r.ok) throw new Error('status '+r.status);
    return r.arrayBuffer();
  }
  async function doDownload(video, filename, preferredUrl){
    const seen=new Set(); const attempts=[];
    const push=(u)=>{ if(u&&!seen.has(u)){ seen.add(u); attempts.push(u); } };
    push(preferredUrl); push(resolveVideoUrl(video));
    for(const u of xVideoUrls()) push(u);
    for(const u of attempts){
      try{
        const buf=await fetchFull(u);
        if(buf&&isMp4(buf)){
          let out=buf;
          const remuxed=window.__igdwnRemuxFragmented ? window.__igdwnRemuxFragmented(buf) : null;
          if(remuxed) out=remuxed; else { const s=SH.stripMp4Metadata(buf); if(s&&s.buf) out=s.buf; }
          const ok=await downloadBytes(out, filename);
          if(ok) return true;
        }
      }catch(e){}
    }
    for(const u of attempts){
      if(!isFullVideoUrl(u)) continue;
      try{ const ok=await downloadViaDownloads(u, filename); if(ok) return true; }catch(e){}
    }
    return false;
  }
  function isMediaImg(img){ const src=img.currentSrc||img.src||''; return /pbs\.twimg\.com\/media\//i.test(src); }
  function origUrl(u){
    if(!u) return '';
    try{ const p=new URL(u); if(/\.twimg\.com$/i.test(p.hostname)){ p.search=''; p.searchParams.set('format','jpg'); p.searchParams.set('name','orig'); return p.toString(); } }catch(e){}
    return u;
  }
  async function downloadImage(url, filename){
    try{ const r=await fetch(url); if(!r.ok) throw new Error('status '+r.status); const blob=await r.blob(); const objectUrl=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=objectUrl; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(objectUrl),60000); return true; }catch(e){ return false; }
  }
  function statusIdFromUrl(){ const m=location.pathname.match(/\/status\/(\d+)/); return m?m[1]:null; }
  function statusIdOf(el){
    let node=el;
    for(let i=0; node&&i<8; i+=1, node=node.parentElement){
      const a=node.querySelector?node.querySelector('a[href*="/status/"]'):null;
      if(a){ const m=a.getAttribute('href').match(/\/status\/(\d+)/); if(m) return m[1]; }
      if(node.tagName==='ARTICLE') break;
    }
    return statusIdFromUrl();
  }
  function smartName(code, isPhoto){
    if(SH && SH.smartFilename) try{ return SH.smartFilename({username:'x',caption:'',date:null,code:code||'x',ext: isPhoto?'jpg':'mp4'}).replace(/\.mp4$/, isPhoto?'.jpg':'.mp4'); }catch(e){}
    return `x_${(code||'x').slice(0,12)}_${Date.now().toString().slice(-6)}.${isPhoto?'jpg':'mp4'}`;
  }

  function buildVideoChip(video, code){
    const chip=document.createElement('div'); chip.className=CHIP_CLASS;
    const dl=document.createElement('button');
    dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
    dl.title='Baixar vídeo direto';
    dl.addEventListener('click',(ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      dl.classList.add('igdwn-busy'); dl.innerHTML='<span>Baixando…</span>';
      const filename=smartName(code,false);
      doDownload(video, filename, null).then((ok)=>{
        dl.classList.remove('igdwn-busy'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
        SH.toast(ok?'Download iniciado':'Falha ao baixar', ok?'ok':'err');
      });
    });
    chip.append(dl);
    return chip;
  }
  function buildImgChip(img, code){
    const chip=document.createElement('div'); chip.className=CHIP_CLASS;
    const dl=document.createElement('button');
    dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
    dl.title='Baixar imagem direto';
    dl.addEventListener('click',async(ev)=>{
      ev.preventDefault(); ev.stopPropagation();
      dl.classList.add('igdwn-busy'); dl.innerHTML='<span>Baixando…</span>';
      const url=origUrl(img.currentSrc||img.src||'');
      const filename=smartName(code,true);
      const ok=await downloadImage(url, filename);
      dl.classList.remove('igdwn-busy'); dl.innerHTML=(SH.icons.download||'↓')+'<span>Baixar</span>';
      SH.toast(ok?'Imagem baixada':'Falha ao baixar', ok?'ok':'err');
    });
    chip.append(dl);
    return chip;
  }

  // ---------- hover ----------
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
  function attachToVideo(video){
    if(!enabled||video.dataset.igdwn==='1') return;
    video.dataset.igdwn='1';
    const code=statusIdOf(video);
    const chip=buildVideoChip(video, code);
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
  function attachToImg(img){
    if(!enabled||img.dataset.igdwn==='1') return;
    if(!isMediaImg(img)) return;
    const r=img.getBoundingClientRect();
    if(r.width<100&&r.height<100){ img.addEventListener('load',()=>attachToImg(img),{once:true}); return; }
    img.dataset.igdwn='1';
    const code=statusIdOf(img);
    const chip=buildImgChip(img, code);
    chip.classList.add('igdwn-hidden');
    chipRegistry.set(img, chip);
    chip.addEventListener('click',(ev)=>ev.stopPropagation());
    document.body.appendChild(chip);
  }
  let refreshRaf=null;
  function throttledRefresh(){ if(refreshRaf) return; refreshRaf=requestAnimationFrame(()=>{ refreshRaf=null; refreshChips(); }); }
  function scan(){
    if(!enabled) return;
    document.querySelectorAll('video').forEach(attachToVideo);
    document.querySelectorAll('img').forEach(attachToImg);
  }
  injectStyles(); scan();
  document.addEventListener('mousemove', onPointerMove, true);
  window.addEventListener('scroll', throttledRefresh, true);
  window.addEventListener('resize', throttledRefresh);
  let timer=null;
  const obs = new MutationObserver(()=>{ clearTimeout(timer); timer=setTimeout(scan,150); });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  window.__igdwnXObserver = obs;
  window.__igdwnXInterval = setInterval(()=>{
    for (const [el, chip] of chipRegistry) if (!el.isConnected) { try{ chip.remove(); }catch(e){} chipRegistry.delete(el); }
  }, 3000);
})();
