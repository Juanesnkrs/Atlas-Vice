/* Service Worker ligero de LeonidApp (sin dependencias).
 * - /api/*: Network-First y NUNCA se cachea (sin respuestas obsoletas).
 * - Estaticos del mismo origen (index.html, CSS, JS, iconos): Cache-First.
 */
const CACHE = 'leonidapp-static-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const offlineApi = () =>
  new Response(JSON.stringify({ error: 'Sin conexion' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API (mismo origen o API_URL absoluto): red primero, sin tocar la cache.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(offlineApi));
    return;
  }

  if (url.origin !== self.location.origin) return;
  // SEO dinamico y el propio SW: siempre red.
  if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt' || url.pathname === '/sw.js') return;

  const isNav = req.mode === 'navigate';
  const key = isNav ? '/' : req;
  event.respondWith(
    caches.match(key).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (isNav || res.type === 'basic')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        }),
    ).catch(() => caches.match('/')),
  );
});
