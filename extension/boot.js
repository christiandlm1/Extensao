try {
  document.documentElement.setAttribute('data-igdwn-boot', '1');
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('tap.js');
  s.onload = () => document.documentElement.setAttribute('data-igdwn-tap', 'tag');
  s.onerror = () => document.documentElement.setAttribute('data-igdwn-tap', 'tag-err');
  (document.head || document.documentElement).appendChild(s);
  chrome.runtime.sendMessage({ type: 'BOOT_TAP' }, () => void chrome.runtime.lastError);
} catch (err) {
  /* ignora */
}