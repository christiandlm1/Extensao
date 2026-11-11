const toggle = document.getElementById('toggle');
const shopeeToggle = document.getElementById('shopee-toggle');
const SHOPEE_URL = 'http://127.0.0.1:8788';

function renderToggle(on) {
  toggle.classList.toggle('off', !on);
  document.getElementById('toggle-label').textContent = on ? 'Ativado' : 'Desativado';
}

chrome.storage.local.get('igdwnEnabled', (data) => {
  renderToggle(data.igdwnEnabled !== false);
});

toggle.addEventListener('click', () => {
  const on = toggle.classList.contains('off');
  chrome.storage.local.set({ igdwnEnabled: on });
  renderToggle(on);
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.runtime.sendMessage({ type: 'IGDWN_TOGGLE', enabled: on }, () => {
        void chrome.runtime.lastError;
      });
    }
  });
});

async function refreshShopee() {
  try {
    const r = await fetch(SHOPEE_URL + '/status');
    const s = await r.json();
    shopeeToggle.classList.toggle('off', !s.running);
    document.getElementById('shopee-label').textContent = s.running ? 'Bot Shopee: rodando' : 'Bot Shopee: parado';
  } catch (e) {
    shopeeToggle.classList.add('off');
    document.getElementById('shopee-label').textContent = 'Bot Shopee: offline';
  }
}

shopeeToggle.addEventListener('click', async () => {
  const isOn = !shopeeToggle.classList.contains('off');
  shopeeToggle.disabled = true;
  try {
    const r = await fetch(SHOPEE_URL + (isOn ? '/stop' : '/start'));
    await r.json();
  } catch (e) {
    document.getElementById('shopee-label').textContent = 'Bot Shopee: offline';
  }
  shopeeToggle.disabled = false;
  refreshShopee();
});

refreshShopee();
