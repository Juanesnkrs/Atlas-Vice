/* Service Worker ligero de LeonidApp (sin dependencias).
 * - Navegacion (HTML): Network-First; actualiza la cache con la respuesta fresca y usa la copia
 *   guardada solo si no hay conexion. Evita pantallas en blanco tras un despliegue nuevo.
 * - /api/*: Network-First y NUNCA se cachea (sin respuestas obsoletas); sin red responde 503.
 * - Assets estaticos (/assets/*, iconos y manifest): Cache-First (sus nombres llevan hash).
 * - Fuentes propias (/fonts/*.woff2, SIL OFL): Cache-First (nombre fijo, contenido inmutable; si cambian, subir la version de la cache).
 * - Manifiesto de teselas (/map-tiles/manifest.json): siempre red (una copia vieja desencaja la piramide).
 * - Teselas del mapa (/map-tiles/*?v=N): stale-while-revalidate; la version del manifiesto va en la URL.
 * - Imagenes propias (/media/<id>[?w=800]): cache-first en una cache aparte con tope de 80 entradas (URL inmutables).
 * - NUNCA se intercepta ni cachea: /_staff (area oculta), /api/* (incluye /api/auth/*), sitemap/robots y el propio sw.js.
 * - Sin red y sin copia de la shell se muestra una pagina offline propia (OFFLINE_HTML), no el dinosaurio del navegador.
 */
const CACHE = 'leonidapp-static-v11';
const MEDIA_CACHE = 'leonidapp-media-v1';
const MEDIA_MAX = 80;
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];
const STATIC_PATHS = new Set(['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k))))
      .then(purgeStaleTiles)
      .then(() => self.clients.claim()),
  );
});

// Las teselas llevan ?v=<manifest.v>: al activarse (y en cada arranque del SW) se descartan las de otra version,
// de modo que cambiar "v" en public/map-tiles/manifest.json invalida las teselas antiguas sin tocar el nombre de la cache.
function purgeStaleTiles() {
  return fetch('/map-tiles/manifest.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      if (!m || m.v === undefined) return undefined;
      return caches.open(CACHE).then((c) =>
        c.keys().then((reqs) =>
          Promise.all(
            reqs.map((rq) => {
              const u = new URL(rq.url);
              return u.pathname.startsWith('/map-tiles/') && u.pathname !== '/map-tiles/manifest.json' && u.searchParams.get('v') !== String(m.v) ? c.delete(rq) : undefined;
            }),
          ),
        ),
      );
    })
    .catch(() => undefined);
}

const OFFLINE_HTML =
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="theme-color" content="#2E1A47"><title>Sin conexión | LeonidApp</title>' +
  '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box;' +
  'background:linear-gradient(180deg,#2E1A47,#7B2C6F 55%,#E14B7B);color:#FBF1F5;font-family:system-ui,sans-serif}' +
  'main{max-width:360px}h1{font-size:1.5rem;margin:0 0 8px}p{margin:0 0 20px;line-height:1.5}' +
  'a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 24px;border-radius:999px;' +
  'background:linear-gradient(90deg,#E1307E,#F67E56);color:#1A0A22;font-weight:700;text-decoration:none}</style></head>' +
  '<body><main><h1>Sin conexión</h1><p>Esta página aún no está guardada en tu dispositivo. Reconéctate para verla; lo que ya abriste sigue disponible.</p>' +
  '<a href="/">Reintentar</a></main></body></html>';
const offlinePage = () => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/** Cache LRU simple: tras guardar, elimina las entradas mas antiguas por encima del tope. */
function trimCache(name, max) {
  return caches.open(name).then((c) =>
    c.keys().then((reqs) => (reqs.length > max ? Promise.all(reqs.slice(0, reqs.length - max).map((r) => c.delete(r))) : undefined)),
  );
}

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
  if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt' || url.pathname === '/sw.js' || url.pathname === '/map-tiles/manifest.json') return;

  // Area oculta de staff: jamas pasa por la cache del SW (ni su HTML ni sus chunks en /_staff/assets/).
  if (url.pathname === '/_staff' || url.pathname.startsWith('/_staff/')) return;

  // Navegacion: Network-First. La copia de '/' (shell de la SPA) solo sirve sin conexion.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || offlinePage())),
    );
    return;
  }

  // Imagenes propias del Estudio de Imagenes: URL inmutables -> cache-first con tope.
  if (url.pathname.startsWith('/media/')) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok && res.type === 'basic') {
                c.put(req, res.clone()).then(() => trimCache(MEDIA_CACHE, MEDIA_MAX));
              }
              return res;
            }),
        ),
      ),
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
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || STATIC_PATHS.has(url.pathname)) {
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
