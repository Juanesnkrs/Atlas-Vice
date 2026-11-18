// =============================================================================
// LEONIDAPP - Enrutador con History API (rutas limpias, sin '#'; sin react-router: funciona bajo
// Capacitor y offline). El núcleo (navigate, popstate, interceptación de <a href>, usePageMeta)
// vive en store/useRouteStore.ts; aquí está la tabla ruta -> vista y las guardas.
// Regla de los 3 clics: Landing -> (Invitado) -> Hub -> Mapa / Catálogo / Foro -> ficha.
//
//   /                       P01+P02  Landing storytelling + Auth PKCE
//   /entrar                 P02      Auth (noindex)
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
import { useEffect, useMemo, type ReactNode } from 'react';
import { BottomDock, type DockItem } from './components/layout/BottomDock';
import { ViceShell } from './components/layout/ViceShell';
import { PalmButton } from './components/ui/PalmButton';
import { useModuleGate, useProgressSummary } from './data/seed';
import AdminSubmitPage from './pages/AdminSubmitPage';
import CatalogPage from './pages/CatalogPage';
import DashboardPage from './pages/DashboardPage';
import ForumPage from './pages/ForumPage';
import GuidesPage from './pages/GuidesPage';
import LandingAuthPage from './pages/LandingAuthPage';
import MapPage from './pages/MapPage';
import NewsPage from './pages/NewsPage';
import { isApiConfigured, useAuthStore } from './store/useAuthStore';
import { useProgressStore } from './store/useProgressStore';
import { installRouter, matchRoute, navigate, useLocation, usePageMeta, type PageMeta } from './store/useRouteStore';

installRouter();

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
  // La landing fija su propio title/description/JSON-LD; aquí solo se restablece robots/canonical.
  landing: { title: '', robots: 'index,follow', canonicalPath: '/' },
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

const DOCK_ACTIVE: Partial<Record<RouteId, string>> = {
  hub: 'hub',
  progress: 'progress',
  map: 'map',
  catalog: 'catalog',
  entity: 'catalog',
  forum: 'forum',
  contribute: 'contribute',
  guides: 'hub',
  guide: 'hub',
  news: 'hub',
  newsItem: 'hub',
};

// ---- Navegación (dock): los módulos inactivos no aparecen -------------------------------
function useDock(): { mobile: DockItem[]; desktop: DockItem[] } {
  const { isActive, catalogActive } = useModuleGate();
  return useMemo(() => {
    const map: DockItem = { id: 'map', label: 'Mapa', iconId: 'map', href: '/mapa' };
    const catalog: DockItem = { id: 'catalog', label: 'Catálogo', iconId: 'catalog', href: '/catalogo' };
    const forum: DockItem = { id: 'forum', label: 'Foro', iconId: 'forum', href: '/foro' };
    const showMap = isActive('mapa');
    const showForum = isActive('foro');
    return {
      mobile: [
        { id: 'hub', label: 'Hub', iconId: 'hub', href: '/hub' },
        ...(showMap ? [map] : []),
        ...(catalogActive ? [catalog] : []),
        ...(showForum ? [forum] : []),
        { id: 'progress', label: 'Progreso', iconId: 'progress', href: '/progreso' },
      ],
      desktop: [
        ...(showMap ? [map] : []),
        ...(catalogActive ? [catalog] : []),
        ...(showForum ? [forum] : []),
        { id: 'contribute', label: 'Aportar', iconId: 'contribute', href: '/aportar' },
      ],
    };
  }, [isActive, catalogActive]);
}

// ---- Cabecera: progreso, estado de sincronización y sesión -----------------------
function HeaderEnd() {
  const status = useAuthStore((s) => s.status);
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const syncStatus = useProgressStore((s) => s.syncStatus);
  const syncError = useProgressStore((s) => s.syncError);
  const summary = useProgressSummary();

  const authenticated = status === 'authenticated';
  let syncLabel = 'Local';
  if (!isApiConfigured) syncLabel = 'Offline (sin API)';
  else if (syncStatus === 'syncing') syncLabel = 'Sincronizando…';
  else if (syncStatus === 'error') syncLabel = 'Error de sincronización';
  else if (authenticated) syncLabel = 'Sincronizado';
  const syncTone = syncStatus === 'error' ? 'text-vice-gold' : 'text-vice-text/70';

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        role="status"
        title={syncError ?? undefined}
        className={`hidden whitespace-nowrap px-2 lg:inline ${syncTone}`}
      >
        {syncLabel}
      </span>
      <a
        href="/progreso"
        className="glass flex min-h-11 items-center gap-2 rounded-full px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
        aria-label={`Progreso total ${summary.percent}%. Abrir mi avance`}
      >
        <span className="hidden sm:inline">Progreso</span>
        <span className="font-display text-vice-orange">{summary.percent}%</span>
      </a>
      {authenticated ? (
        <button
          type="button"
          onClick={() => void signOut()}
          className="glass flex min-h-11 items-center rounded-full px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
          aria-label="Cerrar sesión"
        >
          <span className="hidden max-w-[10ch] truncate sm:inline">
            {profile?.username ?? user?.email?.split('@')[0] ?? 'Cuenta'}
          </span>
          <span className="sm:ml-2 text-vice-orange">Salir</span>
        </button>
      ) : (
        <a
          href="/entrar"
          className="glass flex min-h-11 items-center rounded-full px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
        >
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
      <div className="flex h-full items-center justify-center p-6" role="status">
        Verificando sesión…
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center p-6">
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
    <div className="flex h-full items-center justify-center p-6">
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
  const status = useAuthStore((s) => s.status);
  const guestMode = useAuthStore((s) => s.guestMode);
  const { isActive, catalogActive } = useModuleGate();
  const dock = useDock();

  const match = matchRoute(ROUTES, path);
  const route: RouteId | 'notfound' = match?.id ?? 'notfound';
  const returning = status === 'authenticated' || guestMode;

  // Metadatos por ruta (landing, guías, noticias y fichas los gestionan ellas mismas).
  const comparing = route === 'catalog' && params.has('comparar');
  const baseMeta = route === 'notfound' ? null : (STATIC_META[route] ?? null);
  const meta: PageMeta | null =
    comparing && baseMeta ? { ...baseMeta, robots: NOINDEX, canonicalPath: '/catalogo' } : baseMeta;
  usePageMeta(meta);

  // Redirecciones de cliente (replaceState): /aportes -> /aportar; visitante recurrente en "/" -> Hub.
  useEffect(() => {
    if (route === 'legacyContribute') navigate('/aportar', { replace: true });
    else if (route === 'landing' && returning) navigate('/hub', { replace: true });
  }, [route, returning]);

  if (route === 'legacyContribute') return null;
  if (route === 'landing') return returning ? null : <LandingAuthPage next={params.get('next')} />;
  if (route === 'login') return <LandingAuthPage next={params.get('next')} />;

  const modulo = match?.params.modulo ?? '';
  const slug = match?.params.slug ?? '';

  let page: ReactNode;
  switch (route) {
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

  return (
    <ViceShell
      showHeader
      lockScroll={route !== 'notfound' && LOCKED.has(route)}
      headerEnd={<HeaderEnd />}
      dock={<BottomDock activeId={activeId} items={dock.mobile} desktopItems={dock.desktop} />}
    >
      {page}
    </ViceShell>
  );
}
