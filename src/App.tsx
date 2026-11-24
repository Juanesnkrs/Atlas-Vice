// =============================================================================
// LEONIDAPP - Enrutador con History API (rutas limpias, sin '#'; sin react-router: funciona bajo
// Capacitor y offline). El núcleo (navigate, popstate, interceptación de <a href>, usePageMeta)
// vive en store/useRouteStore.ts; aquí está la tabla ruta -> vista y las guardas.
// Regla de los 3 clics: Landing -> (Invitado) -> Hub -> Mapa / Catálogo / Foro -> ficha.
//
//   /                       Portada pública (HomePage)
//   /entrar                 P01+P02  Acceso: OAuth2 PKCE + Magic Link (noindex)
//   /hub, /progreso         P03      Dashboard (noindex)
//   /mapa                   P04      Mapa de Leonida (?region= ?pin=<slug>; ?marker= y ?entity= heredados)
//   /catalogo               P05      Entrada: replaceState a /catalogo/armas (?q= ?comparar= ?modulo= ?entity= heredados)
//   /catalogo/:categoria    P05      Inspector NUI de una categoría (Module.slug activo; en minúsculas)
//   /catalogo/mapa[/:slug]           replaceState a /mapa[?pin=<slug>] (el mapa no es una categoría del catálogo)
//   /catalogo/:categoria/:itemSlug   Inspector con el ítem preseleccionado (?vista=ficha = ficha completa)
//   /guias, /guias/:slug             Guías (editorial)
//   /noticias, /noticias/:slug       Noticias oficiales
//   /foro                   P07      Foro (?hilo= &entity= &marker=)
//   /aportar                P06      Buzón de la comunidad (noindex)
//   /aportes                         Redirige a /aportar
//   /legal/privacidad, /legal/cookies, /legal/terminos, /legal/marcas, /legal/retirada   Páginas legales (S6.3)
// La guarda de UI es cosmética: el servidor decide (RBAC en hooks Fastify).
// =============================================================================
import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { BottomDock, DOCK_ITEMS } from './components/layout/BottomDock';
import { FEATURES } from './data/v1';
import { ViceShell } from './components/layout/ViceShell';
import { PalmButton } from './components/ui/PalmButton';
import type { LegalId } from './data/legalDocs';
import { useModuleGate, useProgressSummary } from './data/seed';
import HomePage from './pages/HomePage';
import { isApiConfigured, useAuthStore } from './store/useAuthStore';
import { installRouter, matchRoute, navigate, useLocation, usePageMeta, type PageMeta } from './store/useRouteStore';

installRouter();

// Code-splitting por ruta: solo la portada (HomePage) va en el bundle inicial.
const AportarPage = lazy(() => import('./pages/AportarPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ForumPage = lazy(() => import('./pages/ForumPage'));
const GuidesPage = lazy(() => import('./pages/GuidesPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const LandingAuthPage = lazy(() => import('./pages/LandingAuthPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const NewsPage = lazy(() => import('./pages/NewsPage'));
// Módulo privado: solo se importa tras confirmar el rol (ver App). Su chunk sale de /assets (ver vite.config.ts).
const StaffPage = lazy(() => import('./pages/StaffPage'));

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
  | 'guides'
  | 'guide'
  | 'news'
  | 'newsItem'
  | 'forum'
  | 'contribute'
  | 'legacyContribute'
  | 'legal'
  | 'staff';

const ROUTES: ReadonlyArray<readonly [string, RouteId]> = [
  ['/', 'landing'],
  ['/entrar', 'login'],
  ['/hub', 'hub'],
  ['/progreso', 'progress'],
  ['/mapa', 'map'],
  // Las 3 formas comparten RouteId: la vista no se desmonta al cambiar de categoría o de ítem.
  ['/catalogo', 'catalog'],
  ['/catalogo/:categoria', 'catalog'],
  ['/catalogo/:categoria/:itemSlug', 'catalog'],
  ['/guias', 'guides'],
  ['/guias/:slug', 'guide'],
  ['/noticias', 'news'],
  ['/noticias/:slug', 'newsItem'],
  ['/foro', 'forum'],
  ['/aportar', 'contribute'],
  ['/aportes', 'legacyContribute'],
  ['/legal/privacidad', 'legal'],
  ['/legal/cookies', 'legal'],
  ['/legal/terminos', 'legal'],
  ['/legal/marcas', 'legal'],
  ['/legal/retirada', 'legal'],
  ['/_staff', 'staff'],
];

const NOINDEX = 'noindex,nofollow' as const;

/** Metadatos estáticos por ruta. Las rutas con contenido dinámico los fijan en su propia vista. */
const STATIC_META: Partial<Record<RouteId, PageMeta>> = {
  landing: {
    title: 'Mapa, catálogo y guías de Leonida',
    description:
      'LeonidApp reúne el mapa interactivo de Leonida, el catálogo de armas y vehículos, guías y noticias oficiales.',
    robots: 'index,follow',
    canonicalPath: '/',
  },
  login: { title: 'Entrar', description: 'Accede a LeonidApp con Google, Discord, Apple o tu correo.', robots: NOINDEX },
  hub: { title: 'Hub', robots: NOINDEX },
  progress: { title: 'Mi avance', robots: NOINDEX },
  map: {
    title: 'Mapa de Leonida',
    description: 'Mapa táctico de Leonida con capas, filtros y pines de coleccionables, armas, vehículos y puntos de interés.',
  },
  forum: {
    title: 'Foro de la comunidad',
    description: 'Foro de LeonidApp: hilos, guías y ayuda, secretos y crews de la comunidad de Leonida.',
  },
  contribute: { title: 'Aportar', robots: NOINDEX },
};

/** Ítem del dock resaltado por ruta (dock completo, oculto en la v1). */
const DOCK_ACTIVE: Partial<Record<RouteId, string>> = {
  hub: 'hub',
  map: 'map',
  catalog: 'catalog',
  forum: 'forum',
  contribute: 'contribute',
};

/** Ítem resaltado del dock de la v1 según la ruta y la categoría del catálogo. */
function dockActiveV1(route: RouteId, categoria: string | undefined): string | undefined {
  switch (route) {
    case 'landing':
      return 'home';
    case 'map':
      return 'map';
    case 'guides':
    case 'guide':
      return 'guides';
    case 'news':
    case 'newsItem':
      return 'news';
    case 'catalog':
      return categoria === 'vehiculos' ? 'vehicles' : categoria === 'armas' ? 'weapons' : undefined;
    default:
      return undefined;
  }
}

/** Rutas ocultas en la v1: se comportan como inexistentes (vista 404). */
const HIDDEN_ROUTES: ReadonlyArray<readonly [RouteId, boolean]> = [
  ['hub', FEATURES.hub],
  ['progress', FEATURES.progress],
  ['forum', FEATURES.forum],
  ['contribute', FEATURES.contribute],
  ['legacyContribute', FEATURES.contribute],
];
const isHiddenRoute = (route: RouteId): boolean => HIDDEN_ROUTES.some(([id, on]) => id === route && !on);

// ---- Navegación (dock único): los módulos inactivos no aparecen ----------------------------
function useDock() {
  const { isActive, catalogActive } = useModuleGate();
  return useMemo(
    () =>
      DOCK_ITEMS.filter((item) => {
        if (item.id === 'map') return isActive('mapa');
        if (item.id === 'catalog') return catalogActive;
        if (item.id === 'forum') return isActive('foro');
        if (item.id === 'vehicles') return catalogActive && isActive('vehiculos');
        if (item.id === 'weapons') return catalogActive && isActive('armas');
        if (item.id === 'guides') return isActive('guias');
        return true;
      }),
    [isActive, catalogActive],
  );
}

// ---- Cabecera: enlaces editoriales, progreso y sesión --------------------------------------
const HEADER_PILL =
  'glass flex min-h-11 items-center rounded-full px-3 text-sm min-[400px]:px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold';

function HeaderEnd() {
  const status = useAuthStore((s) => s.status);
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const summary = useProgressSummary();
  const authenticated = status === 'authenticated';

  return (
    <div className="flex items-center gap-2">
      {FEATURES.progress && (
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
      )}
      {FEATURES.progress && (
        <a
          href="/progreso"
          className={`${HEADER_PILL} gap-2 justify-center min-[400px]:min-w-[8.5rem]`}
          aria-label={`Mi avance ${summary.percent}%. Abrir mi avance`}
        >
          <span className="hidden text-xs font-medium text-vice-text/85 min-[400px]:inline">Mi avance</span>
          <span className="font-display text-vice-orange">{summary.percent}%</span>
        </a>
      )}
      {authenticated ? (
        <button
          type="button"
          onClick={() => void signOut()}
          className={`${HEADER_PILL} gap-2`}
          aria-label="Cerrar sesión"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-vice-orange">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7" />
          </svg>
          <span className="hidden max-w-[9ch] truncate md:inline">{profile?.username ?? user?.email?.split('@')[0] ?? 'Cuenta'}</span>
          <span className="text-vice-orange">Salir</span>
        </button>
      ) : FEATURES.accountsUi ? (
        <a href="/entrar" className={`${HEADER_PILL} min-w-[5.5rem] justify-center`}>
          Entrar
        </a>
      ) : null}
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
          publicar inicia sesión con Google, Discord, Apple o tu correo.
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

const LOCKED: ReadonlySet<RouteId> = new Set<RouteId>(['map', 'catalog']);

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
          <PalmButton as="a" href={FEATURES.hub ? '/hub' : '/'}>
            {FEATURES.hub ? 'Volver al Hub' : 'Ir al inicio'}
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
  const ready = useAuthStore((s) => s.ready);
  const staffConfirmed = useAuthStore((s) => s.status === 'authenticated' && s.isStaff());
  let route: RouteId | 'notfound' = match?.id ?? 'notfound';
  // Ruta reservada: sin rol confirmado es indistinguible de una ruta inexistente (vista 404 estándar).
  if (route === 'staff' && ready && !staffConfirmed) route = 'notfound';
  // v1 «enciclopedia»: Hub, Progreso, Foro y Aportar están ocultos (src/data/v1.ts) y se ven como rutas inexistentes.
  if (route !== 'notfound' && isHiddenRoute(route)) route = 'notfound';

  // Metadatos por ruta (guías, noticias y catálogo los gestionan ellas mismas).
  const meta: PageMeta | null = route === 'notfound' ? null : (STATIC_META[route] ?? null);
  usePageMeta(meta);

  // Redirección de cliente (replaceState): /aportes -> /aportar.
  useEffect(() => {
    if (route === 'legacyContribute' && FEATURES.contribute) navigate('/aportar', { replace: true });
  }, [route]);

  if (route === 'legacyContribute') return null;
  // Antes de resolver la sesión: lienzo neutro, sin texto ni panel (evita parpadeos).
  if (route === 'staff' && !ready) return <div className="min-h-[100dvh] w-full" aria-hidden="true" />;
  if (route === 'login') {
    return (
      <Suspense fallback={<PageFallback />}>
        <LandingAuthPage next={params.get('next')} />
      </Suspense>
    );
  }

  const categoria = match?.params.categoria;
  const itemSlug = match?.params.itemSlug;
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
      page = !catalogActive ? (
        <Unavailable title="Catálogo no disponible" text={MODULE_OFF} />
      ) : categoria && !isActive(categoria) ? (
        <Unavailable title="Módulo no disponible" text={MODULE_OFF} />
      ) : (
        <CatalogPage params={params} categoria={categoria} itemSlug={itemSlug} />
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
          <AportarPage />
        </RequireAccount>
      );
      break;
    case 'legal':
      page = <LegalPage docId={(path.split('/')[2] ?? 'privacidad') as LegalId} />;
      break;
    case 'staff':
      page = <StaffPage />;
      break;
    default:
      page = <Unavailable title="Página no encontrada" text="La ruta que buscas no existe en LeonidApp." />;
  }

  const activeId =
    route === 'notfound'
      ? undefined
      : FEATURES.hub || FEATURES.forum || FEATURES.contribute
        ? DOCK_ACTIVE[route]
        : dockActiveV1(route, categoria);
  // La ficha completa (?vista=ficha) es una página con scroll; el Inspector es un HUD de altura fija.
  const fichaView = route === 'catalog' && itemSlug !== undefined && params.get('vista') === 'ficha';
  const locked = route !== 'notfound' && LOCKED.has(route) && !fichaView;
  // Catálogo: HUD fijo en escritorio y página con scroll natural en móvil (sin footer en ningún caso).
  const lockMode: boolean | 'md' = route === 'catalog' && locked ? 'md' : locked;

  return (
    <ViceShell
      showHeader
      lockScroll={lockMode}
      footer={lockMode === false}
      headerEnd={<HeaderEnd />}
      dock={<BottomDock activeId={activeId} items={dock} />}
    >
      <Suspense fallback={<PageFallback />}>{page}</Suspense>
    </ViceShell>
  );
}
