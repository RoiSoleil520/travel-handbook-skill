const CACHE_PREFIX = `travel-handbook:${self.registration.scope}:`;
const CACHE = CACHE_PREFIX + '__CACHE_VERSION__';
const FILES = __PRECACHE__;
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data === 'CACHE_STATUS') event.source?.postMessage('CACHE_READY');
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Use one complete build per worker, so a deployment never mixes app and data versions.
    const cached = await cache.match(event.request, {ignoreSearch: true});
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (error) {
      if (event.request.mode === 'navigate') return await cache.match('./') || Response.error();
      throw error;
    }
  })());
});
