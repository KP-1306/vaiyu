// web/public/sw.js
// VAiyu PWA Service Worker
// - Precache app shell
// - Stale-while-revalidate for same-origin static assets
// - Network-first for cross-origin (API) with cache fallback
// - SPA navigation fallback to /index.html
// - Never cache SSE (/events) or non-GET

const PRECACHE = 'vaiyu-precache-v3';
const RUNTIME  = 'vaiyu-runtime-v3';

// Core shell to precache (Vite serves hashed assets separately)
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest'];

/* ---------------- Install ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

/* ---------------- Activate ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== PRECACHE && k !== RUNTIME)
        .map((k) => caches.delete(k))
    );
    // Enable navigation preload (faster SPA nav on slow networks)
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
  })());
});

/* ---------------- Utilities ---------------- */
async function putRuntimeCache(request, response) {
  try {
    const cache = await caches.open(RUNTIME);
    await cache.put(request, response.clone());
  } catch {
    // ignore cache put errors (opaque/CORS/quota)
  }
}

function isSSE(request) {
  const url = new URL(request.url);
  // Our server streams at /events (text/event-stream)
  return url.pathname === '/events' ||
         request.headers.get('accept')?.includes('text/event-stream');
}

function isApiLike(request) {
  const url = new URL(request.url);
  // Treat cross-origin as API; also treat same-origin /api/* if you add that later
  const sameOrigin = url.origin === self.location.origin;
  return !sameOrigin || url.pathname.startsWith('/api/');
}

/* ---------------- Fetch ---------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET, skip SSE & non-GET
  if (req.method !== 'GET' || isSSE(req)) return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNavigate = req.mode === 'navigate';

  // 1) SPA navigations: serve cached index.html (cache-first; revalidate in bg)
  if (isNavigate) {
    event.respondWith((async () => {
      const preload = 'preloadResponse' in event ? await event.preloadResponse : null;
      if (preload) return preload;

      const cache = await caches.open(PRECACHE);
      const cached = await cache.match('/index.html');
      const fetchAndUpdate = fetch('/index.html')
        .then((res) => {
          if (res && res.ok) cache.put('/index.html', res.clone());
          return res;
        })
        .catch(() => cached); // offline fallback

      return cached ? Promise.race([fetchAndUpdate, Promise.resolve(cached)]) : fetchAndUpdate;
    })());
    return;
  }

  // 2) Same-origin static assets: stale-while-revalidate
  if (sameOrigin && !isApiLike(req)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const fetchAndPut = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached); // offline fallback

      return cached ? Promise.race([fetchAndPut, Promise.resolve(cached)]) : fetchAndPut;
    })());
    return;
  }

  const PRECACHE_URLS = [
  '/', '/index.html', '/manifest.webmanifest',
  '/icons/favicon-light-192.png',
  '/icons/favicon-light-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-180-alt.png',
];

  // 3) API / cross-origin: network-first with cache fallback
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      if (net && net.ok) putRuntimeCache(req, net);
      return net;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;

      // If HTML requested cross-origin (rare), give SPA shell
      if (req.headers.get('accept')?.includes('text/html')) {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      // Propagate error if nothing cached
      return new Response('Offline and no cache available.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  })());
});

/* ---------------- Messages ---------------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
