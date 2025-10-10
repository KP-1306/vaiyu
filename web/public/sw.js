// web/public/sw.js
// VAiyu PWA Service Worker
// - Precache app shell
// - Stale-while-revalidate for same-origin assets
// - Network-first for cross-origin (API) with cache fallback
// - SPA navigation fallback to /index.html

const PRECACHE = 'vaiyu-precache-v2';
const RUNTIME = 'vaiyu-runtime-v2';

// Core shell to precache (Vite will serve hashed assets separately)
const PRECACHE_URLS = ['/', '/index.html'];

// ----- Install: seed the precache -----
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })()
  );
});

// ----- Activate: clean up old caches -----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== PRECACHE && k !== RUNTIME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Utility: put response in cache (clone-safe)
async function putRuntimeCache(request, response) {
  try {
    const cache = await caches.open(RUNTIME);
    await cache.put(request, response.clone());
  } catch {
    // ignore cache put errors (opaque/CORS, quota, etc.)
  }
}

// Utility: match from either cache
async function matchAnyCache(request) {
  return (await caches.match(request)) || (await caches.match(new Request('/index.html')));
}

// ----- Fetch: runtime caching strategies -----
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigate = req.mode === 'navigate';

  // 1) SPA navigation fallback: serve cached index.html (cache-first, revalidate in bg)
  if (isNavigate) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PRECACHE);
        const cached = await cache.match('/index.html');
        const fetchAndUpdate = fetch('/index.html')
          .then((res) => {
            if (res && res.ok) cache.put('/index.html', res.clone());
            return res;
          })
          .catch(() => cached); // offline fallback

        // If we have a cached shell, return it immediately, else wait for network
        return cached ? Promise.race([fetchAndUpdate, Promise.resolve(cached)]) : fetchAndUpdate;
      })()
    );
    return;
  }

  // 2) Same-origin assets: stale-while-revalidate
  if (isSameOrigin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME);
        const cached = await cache.match(req);
        const fetchAndPut = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached); // offline fallback to cache if network fails

        // Return cached fast if present, while updating in background
        return cached ? Promise.race([fetchAndPut, Promise.resolve(cached)]) : fetchAndPut;
      })()
    );
    return;
  }

  // 3) Cross-origin (likely API): network-first with cache fallback
  event.respondWith(
    (async () => {
      try {
        const net = await fetch(req);
        // Cache only successful CORS-allowed responses
        if (net && net.ok) putRuntimeCache(req, net);
        return net;
      } catch {
        // offline or network error → try cache
        const cached = await caches.match(req);
        if (cached) return cached;
        // last resort: if HTML requested cross-origin (rare), give app shell
        if (req.headers.get('accept')?.includes('text/html')) {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        // else propagate error
        throw new Error('Network error and no cache.');
      }
    })()
  );
});

// Optional: allow immediate activation from the page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
