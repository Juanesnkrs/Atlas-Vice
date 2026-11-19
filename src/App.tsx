// =============================================================================
// LEONIDAPP - Enrutador con History API (rutas limpias, sin '#'; sin react-router: funciona bajo
// Capacitor y offline). El núcleo (navigate, popstate, interceptación de <a href>, usePageMeta)
// vive en store/useRouteStore.ts; aquí está la tabla ruta -> vista y las guardas.
// Regla de los 3 clics: Landing -> (Invitado) -> Hub -> Mapa / Catálogo / Foro -> ficha.
//
//   /                       Portada pública (HomePage)
//   /entrar                 P01+P02  Acceso: OAuth2 PKCE + Magic Link (noindex)
//   /hub, /progreso         P03      Dashboard (noindex)
//   /mapa                   P04      Mapa de Leonida (?region= &marker=)
//   /catalogo               P05      Inspector NUI (?comparar=a,b[,c] abre el comparador)
//   /catalogo/:modulo/:slug P05      Ficha de entidad
//   /guias, /guias/:slug             Guías (editorial)
//   /noticias, /noticias/:slug       Noticias oficiales
//   /foro                   P07      Foro (?hilo= &entity= &marker=)
//   /aportar                P06      Aportes, moderación (ADMIN), Control Total (SUPER_ADMIN) (noindex)
//   /aportes                         Redirige a /aportar
// La guarda de UI es cosmética: el servidor decide (RBAC en hooks Fastify).
// =============================================================================
import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { BottomDock, DOCK_ITEMS } from './components/layout/BottomDock';
import { ViceShell } from './components/layout/ViceShell';
import { PalmButton } from './components/ui/PalmButton';
import { useModuleGate, useProgressSummary } from './data/seed';
import HomePage from './pages/HomePage';
import { isApiConfigured, useAuthStore } from './store/useAuthStore';
import { installRouter, matchRoute, navigate, useLocation, usePageMeta, type PageMeta } from './store/useRouteStore';

installRouter();

// Code-splitting por ruta: solo la portada (HomePage) va en el bundle inicial.
const AdminSubmitPage = lazy(() => import('./pages/AdminSubmitPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ForumPage = lazy(() => import('./pages/ForumPage'));
const GuidesPage = lazy(() => import('./pages/GuidesPage'));
const LandingAuthPage = lazy(() => import('./pages/LandingAuthPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const NewsPage = lazy(() => import('./pages/NewsPage'));

/** Fallback de carga: bloque de altura fija y sin contenido (no reflota) para no provocar saltos (CLS = 0). */
function PageFallback() {
  return <div className="min-h-[100dvh] w-full" role="status" aria-label="Cargando" aria-busy="true" />;
}

type RouteId =
  | 'landing'
  | 'login'
  | 'hub'
  | 'progress'
  | 'map'
  | 'catalog'
  | 'entity'
  | 'guides'
  | 'guide'
  | 'news'
  | 'newsItem'
  | 'forum'
  | 'contribute'
  | 'legacyContribute';

const ROUTES: ReadonlyArray<readonly [string, RouteId]> = [
  ['/', 'landing'],
  ['/entrar', 'login'],
  ['/hub', 'hub'],
  ['/progreso', 'progress'],
  ['/mapa', 'map'],
  ['/catalogo', 'catalog'],
  ['/catalogo/:modulo/:slug', 'entity'],
  ['/guias', 'guides'],
  ['/guias/:slug', 'guide'],
  ['/noticias', 'news'],
  ['/noticias/:slug', 'newsItem'],
  ['/foro', 'forum'],
  ['/aportar', 'contribute'],
  ['/aportes', 'legacyContribute'],
];

const NOINDEX = 'noindex,nofollow' as const;

/** Metadatos estáticos por ruta. Las rutas con contenido dinámico los fijan en su propia vista. */
const STATIC_META: Partial<Record<RouteId, PageMeta>> = {
  landing: {
    title: 'Mapa, catálogo y guías de Leonida',
    description:
      'LeonidApp reúne el mapa interactivo de Leonida, el catálogo de armas, vehículos y coleccionables, guías y noticias oficiales.',
    robots: 'index,follow',
    canonicalPath: '/',
  },
  login: { title: 'Entrar', description: 'Accede a LeonidApp con Google, Discord, Apple o Magic Link.', robots: NOINDEX },
  hub: { title: 'Hub', robots: NOINDEX },
  progress: { title: 'Mi progreso', robots: NOINDEX },
  map: {
    title: 'Mapa de Leonida',
    description: 'Mapa táctico de Leonida con capas, filtros y pines de coleccionables, armas, vehículos y puntos de interés.',
  },
  catalog: {
    title: 'Catálogo de Leonida',
    description: 'Inspector del catálogo: armas, vehículos, coleccionables y guías de Leonida con estadísticas y comparador.',
  },
  forum: {
    title: 'Foro de la comunidad',
    description: 'Foro de LeonidApp: hilos, guías y ayuda, secretos y crews de la comunidad de Leonida.',
  },
  contribute: { title: 'Aportar', robots: NOINDEX },
};

/** Ítem del dock resaltado por ruta (portada, guías, noticias y progreso no resaltan ninguno). */
const DOCK_ACTIVE: Partial<Record<RouteId, string>> = {
  hub: 'hub',
  map: 'map',
  catalog: 'catalog',
  entity: 'catalog',
  forum: 'forum',
  contribute: 'contribute',
};

// ---- Navegación (dock único): los módulos inactivos no aparecen ----------------------------
function useDock() {
  const { isActive, catalogActive } = useModuleGate();
  return useMemo(
    () =>
      DOCK_ITEMS.filter((item) => {
        if (item.id === 'map') return isActive('mapa');
        if (item.id === 'catalog') return catalogActive;
        if (item.id === 'forum') return isActive('foro');
        return true;
      }),
    [isActive, catalogActive],
  );
}

// ---- Cabecera: enlaces editoriales, progreso y sesión --------------------------------------
const HEADER_PILL =
  'glass flex min-h-11 items-center rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold';

function HeaderEnd() {
  const status = useAuthStore((s) => s.status);
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const summary = useProgressSummary();
  const authenticated = status === 'authenticated';

  return (
    <div className="flex items-center gap-2">
      <nav aria-label="Secciones" className="mr-2 hidden items-center gap-1 md:flex">
        {[
          { href: '/guias', label: 'Guías' },
          { href: '/noticias', label: 'Noticias' },
        ].map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-vice-text hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            {l.label}
          </a>
        ))}
      </nav>
      <a
        href="/progreso"
        className={`${HEADER_PILL} font-display text-vice-orange`}
        aria-label={`Progreso total ${summary.percent}%. Abrir mi avance`}
      >
        {summary.percent}%
      </a>
      {authenticated ? (
        <button
          type="button"
          onClick={() => void signOut()}
          className={`${HEADER_PILL} gap-2`}
          aria-label="Cerrar sesión"
        >
          <span className="max-w-[9ch] truncate">{profile?.username ?? user?.email?.split('@')[0] ?? 'Cuenta'}</span>
          <span className="hidden text-vice-orange sm:inline">Salir</span>
        </button>
      ) : (
        <a href="/entrar" className={HEADER_PILL}>
          Entrar
        </a>
      )}
    </div>
  );
}

// ---- Guarda: requiere cuenta (no Invitado). Cosmética: el servidor decide. ---------------
function RequireAccount({ next, children }: { next: string; children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'authenticated') return <>{children}</>;
  if (status === 'loading') {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center p-6" role="status">
        Verificando sesión…
      </div>
    );
  }
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-6">
      <section className="glass max-w-md rounded-2xl p-8 text-center" aria-labelledby="lock-title">
        <h1 id="lock-title" className="font-display text-2xl font-bold">
          Necesitas una cuenta
        </h1>
        <p className="mt-3 text-vice-text/85">
          Como Invitado puedes explorar el mapa, el catálogo y el foro en lectura. Para aportar o
          publicar inicia sesión con Google, Discord, Apple o Magic Link.
        </p>
        {!isApiConfigured && (
          <p className="mt-3 text-sm text-vice-gold">
            Esta copia funciona sin conexión a la API, por lo que el inicio de sesión no está
            disponible.
          </p>
        )}
        <div className="mt-6 flex justify-center">
          <PalmButton as="a" href={`/entrar?next=${encodeURIComponent(next)}`}>
            Iniciar sesión
          </PalmButton>
        </div>
      </section>
    </div>
  );
}

const LOCKED: ReadonlySet<RouteId> = new Set<RouteId>(['map', 'catalog', 'forum']);

function Unavailable({ title, text }: { title: string; text: string }) {
  usePageMeta({ title, robots: NOINDEX });
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-6">
      <section className="glass max-w-md rounded-2xl p-8 text-center" aria-labelledby="na-title">
        <h1 id="na-title" className="font-display text-2xl font-bold">
          {title}
        </h1>
        <p className="mt-3 text-vice-text/85">{text}</p>
        <div className="mt-6 flex justify-center">
          <PalmButton as="a" href="/hub">
            Volver al Hub
          </PalmButton>
        </div>
      </section>
    </div>
  );
}

const MODULE_OFF = 'Este módulo está desactivado temporalmente.';

export default function App() {
  const { path, params } = useLocation();
  const { isActive, catalogActive } = useModuleGate();
  const dock = useDock();

  const match = matchRoute(ROUTES, path);
  const route: RouteId | 'notfound' = match?.id ?? 'notfound';

  // Metadatos por ruta (guías, noticias y fichas los gestionan ellas mismas).
  const comparing = route === 'catalog' && params.has('comparar');
  const baseMeta = route === 'notfound' ? null : (STATIC_META[route] ?? null);
  const meta: PageMeta | null =
    comparing && baseMeta ? { ...baseMeta, robots: NOINDEX, canonicalPath: '/catalogo' } : baseMeta;
  usePageMeta(meta);

  // Redirección de cliente (replaceState): /aportes -> /aportar.
  useEffect(() => {
    if (route === 'legacyContribute') navigate('/aportar', { replace: true });
  }, [route]);

  if (route === 'legacyContribute') return null;
  if (route === 'login') {
    return (
      <Suspense fallback={<PageFallback />}>
        <LandingAuthPage next={params.get('next')} />
      </Suspense>
    );
  }

  const modulo = match?.params.modulo ?? '';
  const slug = match?.params.slug ?? '';

  let page: ReactNode;
  switch (route) {
    case 'landing':
      page = <HomePage />;
      break;
    case 'hub':
      page = <DashboardPage section="hub" />;
      break;
    case 'progress':
      page = <DashboardPage section="progress" />;
      break;
    case 'news':
      page = <NewsPage />;
      break;
    case 'newsItem':
      page = <NewsPage slug={slug} />;
      break;
    case 'map':
      page = isActive('mapa') ? <MapPage params={params} /> : <Unavailable title="Mapa no disponible" text={MODULE_OFF} />;
      break;
    case 'catalog':
      page = catalogActive ? (
        <CatalogPage params={params} />
      ) : (
        <Unavailable title="Catálogo no disponible" text={MODULE_OFF} />
      );
      break;
    case 'entity':
      page = isActive(modulo) ? (
        <CatalogPage params={params} detail={{ modulo, slug }} />
      ) : (
        <Unavailable title="Módulo no disponible" text={MODULE_OFF} />
      );
      break;
    case 'guides':
      page = isActive('guias') ? <GuidesPage /> : <Unavailable title="Guías no disponibles" text={MODULE_OFF} />;
      break;
    case 'guide':
      page = isActive('guias') ? <GuidesPage slug={slug} /> : <Unavailable title="Guías no disponibles" text={MODULE_OFF} />;
      break;
    case 'forum': {
      // Alias del contrato de URL (?hilo=) hacia el parámetro interno de ForumPage (?thread=).
      const fp = new URLSearchParams(params);
      const hilo = fp.get('hilo');
      if (hilo && !fp.has('thread')) fp.set('thread', hilo);
      page = isActive('foro') ? (
        <ForumPage key={fp.toString()} params={fp} />
      ) : (
        <Unavailable title="Foro no disponible" text={MODULE_OFF} />
      );
      break;
    }
    case 'contribute':
      page = (
        <RequireAccount next="/aportar">
          <AdminSubmitPage />
        </RequireAccount>
      );
      break;
    default:
      page = <Unavailable title="Página no encontrada" text="La ruta que buscas no existe en LeonidApp." />;
  }

  const activeId = route === 'notfound' ? undefined : DOCK_ACTIVE[route];
  const locked = route !== 'notfound' && LOCKED.has(route);

  return (
    <ViceShell
      showHeader
      lockScroll={locked}
      footer={!locked}
      headerEnd={<HeaderEnd />}
      dock={<BottomDock activeId={activeId} items={dock} />}
    >
      <Suspense fallback={<PageFallback />}>{page}</Suspense>
    </ViceShell>
  );
}
