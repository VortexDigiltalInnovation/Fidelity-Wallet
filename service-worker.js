/* Fidelity Wallet – Service Worker v12.7 */
const VERSION = 'v12-7';
const SHELL_CACHE = 'fidelity-wallet-shell-' + VERSION;
const RUNTIME_CACHE = 'fidelity-wallet-runtime-' + VERSION;
const RUNTIME_MAX_ENTRIES = 150;
const NAV_TIMEOUT_MS = 3500;

// File locali: obbligatori. Se uno manca l'installazione fallisce (comportamento voluto).
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.html',
  './Guida%20Utente%20Wallet%20Fedelta.pdf',
  './icons/favicon-64.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Librerie esterne (versioni fisse): precache "best effort", senza bloccare l'installazione.
const CDN_PRECACHE = [
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
  'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode_js@1.0.0/qrcode.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8',
  'https://unpkg.com/@zxing/library@0.21.3',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
];

// Solo questi host vengono messi in cache. Tutto il resto (Google Drive/OAuth, Nominatim, ecc.)
// passa direttamente dalla rete: niente dati sincronizzati o risposte autenticate in cache.
const CACHEABLE_HOSTS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'icon.horse',
  'cdn-icons-png.flaticon.com'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(APP_SHELL);
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(CDN_PRECACHE.map(async url => {
      const res = await fetch(new Request(url, { mode: 'no-cors', credentials: 'omit' }));
      if (res && (res.ok || res.type === 'opaque')) await runtime.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith('wallet-fedelta') || k.startsWith('fidelity-wallet')) && !keep.includes(k)).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// Navigazione: rete (con preload e timeout), poi cache. Funziona anche con ?openCard=... o ?source=pwa.
async function handleNavigation(event) {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const network = (async () => (await event.preloadResponse) || fetch(event.request))();
    const response = await withTimeout(network, NAV_TIMEOUT_MS);
    if (response && response.ok) shell.put('./index.html', response.clone()).catch(() => {});
    return response;
  } catch (err) {
    return (await shell.match('./index.html')) || (await shell.match('./')) || Response.error();
  }
}

// File locali statici: risponde subito dalla cache e aggiorna in background.
async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request, { ignoreSearch: false });
  const update = fetch(event.request).then(res => {
    if (res && res.ok) cache.put(event.request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(update); return cached; }
  return (await update) || Response.error();
}

// Librerie/immagini esterne: cache-first (le versioni sono fisse).
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).then(() => trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES)).catch(() => {});
    }
    return res;
  } catch (err) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (url.origin === self.location.origin) {
    // Richieste Range (anteprima PDF): risposta completa dalla cache se presente.
    if (request.headers.has('range')) {
      event.respondWith(
        caches.match(request.url, { ignoreSearch: true, ignoreVary: true })
          .then(hit => hit || fetch(request))
      );
      return;
    }
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
    return;
  }

  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
  // Altri host: nessuna intercettazione.
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const cardId = event.notification.data && event.notification.data.cardId;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'OPEN_CARD', cardId });
        return;
      }
    }
    const target = new URL('./', self.location).href + '?openCard=' + encodeURIComponent(cardId || '');
    await self.clients.openWindow(target);
  })());
});
