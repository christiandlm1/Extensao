(() => {
  if (window.__igdwnTapInstalled) return;
  window.__igdwnTapInstalled = true;

  const byCode = {};
  let template = '';
  let pagBody = '';
  let flushTimer = 0;

  const flush = () => {
    try {
      window.postMessage({ type: 'IGDWN_GQL_DATA', payload: { byCode, template, pag: pagBody } }, '*');
    } catch (err) {
      /* ignora */
    }
  };
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = 0;
      flush();
    }, 150);
  };

  const isGraphql = (url) => typeof url === 'string' && /graphql/i.test(url);

  const captureBody = (bodyStr) => {
    if (!bodyStr || bodyStr.length < 40) return;
    if (bodyStr.indexOf('doc_id=') !== -1) {
      if (
        bodyStr.indexOf('PolarisClipsTabDesktopPaginationQuery') !== -1 ||
        bodyStr.indexOf('28439660052323373') !== -1
      ) {
        pagBody = bodyStr;
      } else if (!template) {
        template = bodyStr;
      }
      scheduleFlush();
    }
  };

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const code = node.code;
    const versions = node.video_versions;
    if (code && Array.isArray(versions) && versions.length > 0) {
      const best = versions.find((v) => v.type === 101) || versions[0];
      const cover =
        node.image_versions2 &&
        Array.isArray(node.image_versions2.candidates) &&
        node.image_versions2.candidates[0];
      if (best && best.url && best.url.indexOf('blob:') !== 0) {
        byCode[String(code)] = {
          v: best.url,
          c: (node.caption && node.caption.text) || '',
          a: (node.user && node.user.username) || '',
          w: (cover && cover.url) || '',
          h: !!node.has_audio,
          m: node.media_type || 2,
          pk: node.pk || '',
          t: node.taken_at || null,
          play: node.play_count || 0,
          like: (node.like_count != null ? node.like_count : (node.edge_media_preview_like && node.edge_media_preview_like.count)) || 0,
          comm: (node.comment_count != null ? node.comment_count : (node.edge_media_to_comment && node.edge_media_to_comment.count)) || 0,
        };
        const keys = Object.keys(byCode);
        if (keys.length > 300) {
          keys.slice(0, keys.length - 300).forEach((k) => delete byCode[k]);
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'video_versions') continue;
      walk(node[key]);
    }
  };

  try {
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__igdwnUrl = String(url || '');
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function (body) {
        const self = this;
        if (isGraphql(self.__igdwnUrl)) {
          let bodyStr = '';
          try {
            bodyStr =
              body instanceof URLSearchParams ? body.toString() : String(body || '');
          } catch (err) {
            /* ignora */
          }
          captureBody(bodyStr);
          self.addEventListener('load', () => {
            try {
              const text = self.responseText;
              if (text && text.length > 100) {
                walk(JSON.parse(text));
                scheduleFlush();
              }
            } catch (err) {
              /* resposta não-JSON */
            }
          });
        }
        return origSend.apply(this, arguments);
      };
    }
    if (window.fetch) {
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        let url =
          typeof input === 'string' ? input : (input && input.url) || '';
        let bodyStr = '';
        if (init && init.body) {
          try {
            bodyStr =
              init.body instanceof URLSearchParams
                ? init.body.toString()
                : String(init.body);
          } catch (err) {
            /* ignora */
          }
        }
        if (isGraphql(url)) {
          if (bodyStr) captureBody(bodyStr);
          return origFetch.apply(this, arguments).then((resp) => {
            resp
              .clone()
              .text()
              .then((text) => {
                try {
                  if (text && text.length > 100) {
                    walk(JSON.parse(text));
                    scheduleFlush();
                  }
                } catch (err) {
                  /* resposta não-JSON */
                }
              })
              .catch(() => {
                /* clone falhou */
              });
            return resp;
          });
        }
        return origFetch.apply(this, arguments);
      };
    }
  } catch (err) {
    /* ambiente sem XHR/fetch: nada a capturar */
  }

  window.addEventListener('DOMContentLoaded', flush);
  window.addEventListener('load', flush);
  setInterval(flush, 3000);
  if (document.readyState !== 'loading') flush();
})();