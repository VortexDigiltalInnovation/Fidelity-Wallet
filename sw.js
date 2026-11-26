const CACHE = 'stylista-shell-v52-2.42.0';
const CORE = ['index.html','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png'];
const BASE = new URL('./', self.location.href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(path => new URL(path, BASE).href))));
});
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if ((name.startsWith('wardrobe-shell-') || name.startsWith('stylista-shell-')) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin) return;
  if (request.mode === 'navigate' && url.pathname.startsWith(BASE.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const indexUrl = new URL('index.html', BASE).href;
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) { cache.put(indexUrl, fresh.clone()); return fresh; }
        throw new Error('risposta non valida');
      } catch (e) { const stored = await cache.match(indexUrl); return stored || Response.error(); }
    })());
    return;
  }
  const core = CORE.map(path => new URL(path, BASE).href);
  if (!core.includes(url.href)) return;
  event.respondWith((async () => { const cache = await caches.open(CACHE); return (await cache.match(request)) || fetch(request); })());
});
