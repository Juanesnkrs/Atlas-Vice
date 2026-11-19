/* Service Worker ligero de LeonidApp (sin dependencias).
 * - Navegacion (HTML): Network-First; actualiza la cache con la respuesta fresca y usa la copia
 *   guardada solo si no hay conexion. Evita pantallas en blanco tras un despliegue nuevo.
 * - /api/*: Network-First y NUNCA se cachea (sin respuestas obsoletas); sin red responde 503.
 * - Assets estaticos (/assets/*, iconos y manifest): Cache-First (sus nombres llevan hash).
 * - Teselas del mapa (/map-tiles/*): stale-while-revalidate (sirve la copia y refresca en segundo plano).
 */
const CACHE = 'leonidapp-static-v4';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
const STATIC_PATHS = new Set(['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']);

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

  // Navegacion: Network-First. La copia de '/' (shell de la SPA) solo sirve sin conexion.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
    return;
  }

  // Teselas del mapa: stale-while-revalidate (sin hash en el nombre, pero casi inmutables).
  if (url.pathname.startsWith('/map-tiles/')) {
    event.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => {
              if (res.ok && res.type === 'basic') c.put(req, res.clone());
              return res;
            })
            .catch(() => hit || Response.error());
          return hit || net;
        }),
      ),
    );
    return;
  }

  // Estaticos con hash o inmutables: Cache-First.
  if (url.pathname.startsWith('/assets/') || STATIC_PATHS.has(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
  // Resto: sin intercepcion (red directa).
});
