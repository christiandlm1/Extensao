importScripts('strip.js', 'remux.js');

function registerTap() {
  if (!chrome.scripting) return;
  const p = chrome.scripting.registerContentScripts([
    {
      id: 'igdwn-tap',
      matches: ['https://www.instagram.com/*'],
      js: ['tap.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: false,
    },
  ]);
  if (p && p.catch) p.catch(() => {});
}

function ensureTap(tabId) {
  registerTap();
  if (!tabId || !chrome.scripting) return Promise.resolve();
  return chrome.scripting
    .executeScript({
      target: { tabId },
      files: ['tap.js'],
      world: 'MAIN',
    })
    .catch(() => {});
}
registerTap();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'BOOT_TAP') {
    ensureTap(sender.tab && sender.tab.id)
      .then(() => {
        try { chrome.storage.local.set({ igdwnTap: { ok: true, t: Date.now() } }); } catch (e) {}
        sendResponse({ ok: true });
      })
      .catch((e) => {
        try { chrome.storage.local.set({ igdwnTap: { ok: false, err: String(e), t: Date.now() } }); } catch (e2) {}
        sendResponse({ ok: false });
      });
    return true;
  }
  if (msg.type === 'FETCH') {
    fetchMedia(msg.url, msg.headers)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false, error: 'network' }));
    return true;
  }
  if (msg.type === 'DOWNLOAD') {
    downloadDirect(msg.url, msg.filename)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false, error: 'network' }));
    return true;
  }
  if (msg.type === 'DOWNLOAD_URL') {
    const safe = sanitizeFilename(msg.filename || `video_${Date.now()}.mp4`);
    chrome.downloads.download(
      { url: msg.url, filename: safe, conflictAction: 'uniquify' },
      (id) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true });
      }
    );
    return true;
  }
});

// ---------- IndexedDB blob storage ----------
const SW_BLOB_DB = 'igdwn-blobs';
const SW_BLOB_STORE = 'videos';

function swBlobOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SW_BLOB_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SW_BLOB_STORE)) db.createObjectStore(SW_BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function swBlobPut(key, arrayBuf) {
  const db = await swBlobOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SW_BLOB_STORE, 'readwrite');
    tx.objectStore(SW_BLOB_STORE).put(arrayBuf, key);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function swBlobGet(key) {
  const db = await swBlobOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SW_BLOB_STORE, 'readonly');
    const req = tx.objectStore(SW_BLOB_STORE).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function swBlobDelete(key) {
  const db = await swBlobOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SW_BLOB_STORE, 'readwrite');
    tx.objectStore(SW_BLOB_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

function isMp4(buf) {
  const head = new Uint8Array(buf, 0, 12);
  return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

async function fetchMedia(url, headers) {
  const init = { credentials: 'include', signal: AbortSignal.timeout(20000) };
  if (headers && typeof headers === 'object') init.headers = headers;
  const resp = await fetch(url, init);
  if (!resp.ok) return { ok: false, error: 'network' };
  const buf = await resp.arrayBuffer();
  if (!isMp4(buf)) return { ok: false, error: 'not-video' };
  return { ok: true, data: buf };
}

function sanitizeFilename(name) {
  const base = String(name || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 140);
  return base || 'conteudo';
}

function looksLikeVideo(u) {
  return !/\.jpg(\?|$)|\.jpeg(\?|$)|\.png(\?|$)|\.webp(\?|$)|amplify_video_thumb|pbs\.twimg\.com/i.test(u || '');
}

function binToBase64(u8) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function downloadDirect(url, filename) {
  return new Promise((resolve) => {
    if (/\.m3u8(\?|$)/i.test(url)) {
      resolve({ ok: false, error: 'hls' });
      return;
    }
    const safe = sanitizeFilename(filename || `video_${Date.now()}.mp4`);
    const doDownload = (dlUrl) => {
      chrome.downloads.download(
        { url: dlUrl, filename: safe, conflictAction: 'uniquify' },
        (id) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: 'network' });
            return;
          }
          resolve({ ok: true });
        }
      );
    };
    fetch(url, { signal: AbortSignal.timeout(25000) })
      .then((resp) => {
        if (!resp.ok) throw new Error('status ' + resp.status);
        return resp.arrayBuffer();
      })
      .then(async (buf) => {
        if (!isMp4(buf)) throw new Error('not-video');
        let out = buf;
        const remuxed = self.__igdwnRemuxFragmented ? self.__igdwnRemuxFragmented(buf) : null;
        if (remuxed) out = remuxed;
        if (out === buf) {
          const s = self.__igdwnStripMp4Metadata ? self.__igdwnStripMp4Metadata(buf) : null;
          if (s && s.buf) out = s.buf;
        }
        try { await swBlobPut(safe, out); } catch (e) {}
        doDownload('data:video/mp4;base64,' + binToBase64(new Uint8Array(out)));
      })
      .catch(async () => {
        if (looksLikeVideo(url)) {
          try {
            const resp = await fetch(url);
            if (resp.ok) {
              const buf = await resp.arrayBuffer();
              try { await swBlobPut(safe, buf); } catch (e) {}
            }
          } catch (e) {}
          doDownload(url);
        } else {
          resolve({ ok: false, error: 'not-video' });
        }
      });
  });
}
