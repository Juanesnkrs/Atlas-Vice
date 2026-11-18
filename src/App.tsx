// =============================================================================
// ATLAS VICE - Enrutador hash mínimo + guardas (sin react-router: funciona bajo
// Capacitor y offline). Regla de los 3 clics: Landing -> (Invitado) -> Hub ->
// Mapa / Catálogo / Foro -> ficha. El dock está siempre a un toque.
//
//   #/ , #/entrar  P01+P02  Landing / Auth (Split-Hero)
//   #/hub          P03      Dashboard (Hub)
//   #/progreso     P03      Dashboard, sección de progreso
//   #/mapa         P04      Mapa de Leonida       (lectura libre)
//   #/catalogo     P05      Inspector NUI         (lectura libre)
//   #/foro         P07      Foro                  (lectura libre; escribir = cuenta)
//   #/aportes      P06      Aportes (cuenta) y moderación (solo ADMIN)
// =============================================================================
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BottomDock, type DockItem } from './components/layout/BottomDock';
import { ViceShell } from './components/layout/ViceShell';
import { PalmButton } from './components/ui/PalmButton';
import { useProgressSummary } from './data/seed';
import AdminSubmitPage from './pages/AdminSubmitPage';
import CatalogPage from './pages/CatalogPage';
import DashboardPage from './pages/DashboardPage';
import ForumPage from './pages/ForumPage';
import LandingAuthPage from './pages/LandingAuthPage';
import MapPage from './pages/MapPage';
import { isApiConfigured, useAuthStore } from './store/useAuthStore';
import { useProgressStore } from './store/useProgressStore';

type RouteId = 'landing' | 'hub' | 'progress' | 'map' | 'catalog' | 'forum' | 'contribute';

const PATHS: Record<string, RouteId> = {
  '/': 'landing',
  '/entrar': 'landing',
  '/hub': 'hub',
  '/progreso': 'progress',
  '/mapa': 'map',
  '/catalogo': 'catalog',
  '/foro': 'forum',
  '/aportes': 'contribute',
};

const DOCK_ROUTE: Record<string, string> = {
  hub: '#/hub',
  map: '#/mapa',
  catalog: '#/catalogo',
  forum: '#/foro',
  progress: '#/progreso',
  contribute: '#/aportes',
};

const DESKTOP_DOCK: readonly DockItem[] = [
  { id: 'map', label: 'Mapa', iconId: 'map' },
  { id: 'catalog', label: 'Catálogo', iconId: 'catalog' },
  { id: 'forum', label: 'Foro', iconId: 'forum' },
  { id: 'contribute', label: 'Aportar', iconId: 'contribute' },
];

interface ParsedRoute {
  path: string;
  route: RouteId;
  params: URLSearchParams;
}

function parseHash(): ParsedRoute {
  const raw = window.location.hash.replace(/^#/, '');
  const [pathPart = '', query = ''] = raw.split('?');
  const path = pathPart === '' ? '/' : pathPart;
  return { path, route: PATHS[path] ?? 'landing', params: new URLSearchParams(query) };
}

function useHashRoute(): ParsedRoute {
  const [state, setState] = useState<ParsedRoute>(parseHash);
  useEffect(() => {
    const onChange = () => setState(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return state;
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
        href="#/progreso"
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
          href="#/entrar"
          className="glass flex min-h-11 items-center rounded-full px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
        >
          Entrar
        </a>
      )}
    </div>
  );
}

// ---- Guarda: requiere cuenta (no Invitado) ----------------------------------------
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
          publicar inicia sesión con Email o Discord.
        </p>
        {!isApiConfigured && (
          <p className="mt-3 text-sm text-vice-gold">
            Esta copia funciona sin conexión a la API, por lo que el inicio de sesión no está
            disponible.
          </p>
        )}
        <div className="mt-6 flex justify-center">
          <PalmButton as="a" href={`#/entrar?next=${encodeURIComponent(next)}`}>
            Iniciar sesión
          </PalmButton>
        </div>
      </section>
    </div>
  );
}

const LOCKED: ReadonlySet<RouteId> = new Set<RouteId>(['map', 'catalog', 'forum']);

export default function App() {
  const { path, route, params } = useHashRoute();
  const status = useAuthStore((s) => s.status);
  const guestMode = useAuthStore((s) => s.guestMode);

  // Visitante recurrente (Invitado o con sesión): "#/" lleva directo al Hub.
  useEffect(() => {
    if (path === '/' && (status === 'authenticated' || guestMode)) {
      window.location.replace('#/hub');
    }
  }, [path, status, guestMode]);

  const onSelect = useCallback((id: string) => {
    const target = DOCK_ROUTE[id];
    if (target) window.location.hash = target;
  }, []);

  if (route === 'landing') {
    if (path === '/' && (status === 'authenticated' || guestMode)) return null;
    return <LandingAuthPage next={params.get('next')} />;
  }

  const activeId = route === 'contribute' ? 'contribute' : route;

  let page: ReactNode;
  switch (route) {
    case 'hub':
      page = <DashboardPage section="hub" />;
      break;
    case 'progress':
      page = <DashboardPage section="progress" />;
      break;
    case 'map':
      page = <MapPage params={params} />;
      break;
    case 'catalog':
      page = <CatalogPage params={params} />;
      break;
    case 'forum':
      page = <ForumPage params={params} />;
      break;
    case 'contribute':
      page = (
        <RequireAccount next="/aportes">
          <AdminSubmitPage />
        </RequireAccount>
      );
      break;
  }

  return (
    <ViceShell
      showHeader
      lockScroll={LOCKED.has(route)}
      headerEnd={<HeaderEnd />}
      dock={<BottomDock activeId={activeId} onSelect={onSelect} desktopItems={DESKTOP_DOCK} />}
    >
      {page}
    </ViceShell>
  );
}
