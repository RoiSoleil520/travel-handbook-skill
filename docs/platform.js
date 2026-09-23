(function () {
  'use strict';
  let prefix = '';
  const escape = value => String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character]);
  async function offline() {
    const status = document.querySelector('#offline-status');
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { status.textContent = '离线功能需要 HTTPS 或本地预览'; return; }
    try {
      const registration = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      const worker = registration.active || registration.waiting;
      if (worker) worker.postMessage('CACHE_STATUS');
      status.textContent = navigator.onLine ? '正在准备离线内容' : '当前离线 · 使用已保存内容';
    } catch (error) { status.textContent = '离线缓存未完成，请联网重新打开此页'; }
  }
  window.TripPlatform = {
    async ready(storagePrefix) { prefix = storagePrefix; },
    read(key, fallback) {
      try { const value = JSON.parse(localStorage.getItem(prefix + key)); return value == null ? fallback : value; }
      catch (error) { return fallback; }
    },
    async save(key, value) {
      try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; }
      catch (error) { return false; }
    },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch (error) { return false; }
    },
    externalLink(url, label, attributes = '') {
      return `<a href="${escape(url)}" target="_blank" rel="noopener" ${attributes}>${label}</a>`;
    },
    offline() {
      if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', event => {
        if (event.data === 'CACHE_READY') document.querySelector('#offline-status').textContent = '离线内容已就绪 · 保存在此设备';
      });
      window.addEventListener('offline', () => { document.querySelector('#offline-status').textContent = '当前离线 · 使用已保存内容'; });
      window.addEventListener('online', offline);
      return offline();
    }
  };
})();
