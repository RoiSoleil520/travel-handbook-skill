(function () {
  'use strict';
  const keys = ['preferences', 'checklist', 'ticket-status', 'custom-todos', 'theme'];
  const values = Object.create(null);
  const blocked = new Set();
  const writes = Object.create(null);
  let prefix = '', native = null, warning = '';
  const escape = value => String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character]);

  function valid(key, value) {
    if (key === 'theme') return typeof value === 'string';
    if (key === 'custom-todos') return Array.isArray(value) && value.every(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.text === 'string');
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function legacy(key) {
    try {
      const value = JSON.parse(localStorage.getItem(prefix + key));
      return valid(key, value) ? value : undefined;
    } catch (error) { return undefined; }
  }
  async function buildVersion() {
    const xhs = window.xhs;
    const read = options => Number(options && options.miniToolEnv && options.miniToolEnv.buildVersion) || 0;
    const version = read(xhs && xhs.launchOptions);
    if (version) return version;
    const api = xhs && xhs.miniTool;
    if (!api || typeof api.getLaunchOptions !== 'function') return 0;
    try { return read(await api.getLaunchOptions()); } catch (error) { return 0; }
  }
  async function ready(storagePrefix) {
    prefix = storagePrefix;
    const api = window.xhs && window.xhs.miniTool;
    if (Math.floor(await buildVersion() / 1000) >= 9460 && api && typeof api.getStorage === 'function' && typeof api.setStorage === 'function') native = api;
    let existing;
    if (native && typeof native.getStorageInfo === 'function') {
      try {
        const info = await native.getStorageInfo();
        if (!info || !Array.isArray(info.keys)) throw new Error('Invalid storage keys');
        existing = info.keys;
      } catch (error) {
        keys.forEach(key => blocked.add(key));
        warning = '本机数据暂时无法读取，修改无法保存；请重新打开后重试。';
        return;
      }
    }
    await Promise.all(keys.map(async key => {
      if (!native) { values[key] = legacy(key); return; }
      try {
        const result = existing && !existing.includes(prefix + key) ? {data: null} : await native.getStorage({key: prefix + key});
        if (!result || !Object.prototype.hasOwnProperty.call(result, 'data')) throw new Error('Invalid storage result');
        if (result.data !== null && result.data !== undefined) {
          const value = JSON.parse(result.data);
          if (!valid(key, value)) throw new Error('Invalid saved data');
          values[key] = value;
        } else {
          const value = legacy(key);
          if (value === undefined) return;
          // Copy before removing the old value; a failed migration keeps the original.
          await native.setStorage({key: prefix + key, data: JSON.stringify(value)});
          values[key] = value;
          try { localStorage.removeItem(prefix + key); } catch (error) { /* Native copy is authoritative. */ }
        }
      } catch (error) {
        blocked.add(key);
        warning = '部分本机数据未能读取，相关修改无法保存；请重新打开后重试。';
      }
    }));
  }
  function save(key, value) {
    if (!keys.includes(key) || blocked.has(key) || !valid(key, value)) return Promise.resolve(false);
    let data;
    try { data = JSON.stringify(value); } catch (error) { return Promise.resolve(false); }
    // Serialize each key so a slow older write cannot overwrite the latest edit.
    const pending = (writes[key] || Promise.resolve()).then(async () => {
      try {
        if (native) await native.setStorage({key: prefix + key, data});
        else localStorage.setItem(prefix + key, data);
        values[key] = JSON.parse(data);
        return true;
      } catch (error) { return false; }
    });
    writes[key] = pending;
    return pending;
  }
  function externalLink(url, label, attributes = '') {
    let text = url, title = '查看来源文本';
    try {
      const location = new URL(url);
      if (location.hostname === 'uri.amap.com' && location.pathname === '/search') text = location.searchParams.get('keyword') || url;
      if (location.hostname === 'www.google.com' && location.pathname.indexOf('/maps/') === 0) {
        text = location.searchParams.get('query') || [location.searchParams.get('origin'), location.searchParams.get('destination')].filter(Boolean).join(' → ') || url;
      }
      if (text !== url) title = '查看地点文本';
    } catch (error) { /* Display the original reference as plain text. */ }
    const safeAttributes = attributes.replace(/\s*aria-label="[^"]*"/g, '');
    const caption = (text !== url ? label.replace(/地图|导航/g, '文本').replace(/Google Maps/g, '地点文本') : label).replace(/↗/g, '');
    return `<button type="button" ${safeAttributes} data-copy-location="${escape(text)}" aria-label="${title}：${escape(text)}">${caption}</button>`;
  }
  window.TripPlatform = {
    ready,
    read(key, fallback) { return values[key] == null ? fallback : values[key]; },
    save,
    async copy() { return false; },
    externalLink,
    offline() {
      document.querySelector('#offline-status').textContent = '离线小册 · 地点与来源可在页内查看';
      document.querySelectorAll('[data-sync-status]').forEach(element => {
        element.textContent = warning || (native ? '修改保存在本机小工具缓存，清理后可能丢失' : '兼容模式：修改仅存在当前浏览器，可能被清理');
      });
      if (warning) {
        const feedback = document.querySelector('#save-feedback');
        feedback.textContent = warning;
        feedback.hidden = false;
      }
    }
  };
})();
