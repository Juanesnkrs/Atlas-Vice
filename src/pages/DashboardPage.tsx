// P03 - Dashboard de Progreso (Hub `/hub` y `/progreso`): avance 100%, rutas sugeridas y novedades.
// Sigue la pestaña Progreso de Mobile.dc.html; las novedades salen solo de la API de noticias oficiales.
import { useEffect, useRef } from 'react';
import { StatBar, type StatAccent } from '../components/ui/StatBar';
import { TipCard } from '../components/ui/TipCard';
import {
  NEWS_SOURCES,
  SAMPLE_NOTICE,
  SEED_ROUTES,
  SEED_TIPS,
  useModuleGate,
  useOfficialNews,
  useProgressSummary,
  usePublicConfig,
  useWorldData,
} from '../data/seed';
import { isApiConfigured, useAuthStore } from '../store/useAuthStore';
import { useProgressStore } from '../store/useProgressStore';
import { CROPS, CropImg } from './HomePage';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold';

const ACCENTS: Record<string, StatAccent> = {
  markers: 'magenta',
  armas: 'gold',
  vehiculos: 'cyan',
  coleccionables: 'lilac',
};

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(NEWS_SOURCES.map((s) => [s.value, s.label]));

/** `module`: slug del módulo que debe estar activo para mostrar el acceso (los inactivos no se muestran). */
const QUICK: ReadonlyArray<{ href: string; title: string; text: string; crop: keyof typeof CROPS; module?: string }> = [
  { href: '/guias', title: 'Guías', text: 'Pasos verificables y rutas.', crop: 'guias', module: 'guias' },
  { href: '/noticias', title: 'Noticias oficiales', text: 'Rockstar Games y Take-Two.', crop: 'noticias' },
  { href: '/aportar', title: 'Aportar', text: 'Envía hallazgos con tu cuenta.', crop: 'coleccionables' },
  { href: '/mapa', title: 'Mapa de Leonida', text: 'Pines, capas y check 100%.', crop: 'mapa', module: 'mapa' },
  { href: '/catalogo', title: 'Catálogo', text: 'Armas, vehículos y coleccionables.', crop: 'vehiculos', module: 'catalogo' },
  { href: '/foro', title: 'Foro', text: 'Hilos, votos y spoilers.', crop: 'armas', module: 'foro' },
];

function Ring({ percent }: { percent: number }) {
  const r = 50;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-[120px] shrink-0">
      <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label={`Avance total ${percent} por ciento`}>
        <defs>
          <linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#E1307E" />
            <stop offset="1" stopColor="#F69259" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="url(#ringG)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(c * percent) / 100} ${c}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center font-display text-[30px] font-bold">
        {percent}%
      </div>
    </div>
  );
}

export default function DashboardPage({ section }: { section: 'hub' | 'progress' }) {
  const { news, loading: newsLoading, error: newsError } = useOfficialNews('all', 3);
  const cfg = usePublicConfig();
  const { isActive, catalogActive } = useModuleGate();
  const quick = QUICK.filter((q) => (q.module === 'catalogo' ? catalogActive : q.module ? isActive(q.module) : true));
  const summary = useProgressSummary();
  const { data, error } = useWorldData();
  const items = useProgressStore((s) => s.items);
  const hydrated = useProgressStore((s) => s.hydrated);
  const syncStatus = useProgressStore((s) => s.syncStatus);
  const syncError = useProgressStore((s) => s.syncError);
  const lastSyncedAt = useProgressStore((s) => s.lastSyncedAt);
  const syncWithCloud = useProgressStore((s) => s.syncWithCloud);
  const status = useAuthStore((s) => s.status);
  const username = useAuthStore((s) => s.profile?.username);
  const progressRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (section === 'progress') progressRef.current?.scrollIntoView({ block: 'start' });
  }, [section]);

  const markerIds = new Set(data.markers.map((m) => m.id));
  const routes = SEED_ROUTES.map((r) => {
    const ids = r.markerIds.filter((id) => markerIds.has(id));
    const done = ids.filter((id) => items[`marker:${id}`]?.completado).length;
    const nextId = ids.find((id) => !items[`marker:${id}`]?.completado);
    return { ...r, total: ids.length, done, nextId };
  }).filter((r) => r.total > 0);

  const authenticated = status === 'authenticated';
  const markers = summary.categories.find((c) => c.id === 'markers');

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold text-[#FFC09A] md:text-4xl">Mi avance</h1>
      <p className="mt-1 text-sm text-vice-text/90">
        Hola, {username ?? 'invitado'}. Así va tu 100% de Leonida.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Avance total y por categoría */}
        <section id="progreso" ref={progressRef} aria-labelledby="avance-title" className="glass rounded-3xl p-5 md:p-6 lg:col-span-2">
          <h2 id="avance-title" className="font-display text-xl font-bold">
            Avance total
          </h2>
          {!hydrated ? (
            <p role="status" className="mt-4 text-vice-text/80">
              Cargando tu progreso local…
            </p>
          ) : (
            <>
              <div className="mt-4 flex items-center gap-5">
                <Ring percent={summary.percent} />
                <p className="text-[13px] leading-relaxed text-vice-text/90">
                  <span className="font-semibold text-white">
                    {markers?.done ?? 0} de {markers?.total ?? 0}
                  </span>{' '}
                  marcadores completados.
                  <br />
                  {summary.done} de {summary.total} elementos en total.
                </p>
              </div>
              <div className="mt-5 flex flex-col gap-4">
                {summary.categories.map((c) => (
                  <StatBar
                    key={c.id}
                    label={c.label}
                    value={c.total === 0 ? 0 : (c.done / c.total) * 100}
                    valueLabel={`${c.done}/${c.total}`}
                    accent={ACCENTS[c.id] ?? 'magenta'}
                  />
                ))}
              </div>
            </>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm" role="status">
            {authenticated ? (
              <>
                <span>
                  {syncStatus === 'syncing'
                    ? 'Sincronizando…'
                    : syncStatus === 'error'
                      ? `Error de sincronización: ${syncError ?? 'desconocido'}`
                      : lastSyncedAt
                        ? `Sincronizado con tu cuenta · ${new Date(lastSyncedAt).toLocaleString('es')}`
                        : 'Pendiente de sincronizar'}
                </span>
                <button
                  type="button"
                  onClick={() => void syncWithCloud()}
                  disabled={syncStatus === 'syncing'}
                  className={`glass min-h-11 rounded-full px-4 font-semibold disabled:opacity-50 ${FOCUS}`}
                >
                  Reintentar sincronización
                </button>
              </>
            ) : (
              <span>
                Tu progreso se guarda en este dispositivo.{' '}
                <a href="/entrar" className={`inline-flex min-h-11 items-center text-vice-orange underline ${FOCUS}`}>
                  Inicia sesión
                </a>{' '}
                para sincronizarlo.
              </span>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-5">
          <TipCard tips={SEED_TIPS} />
        </div>

        {/* Rutas sugeridas */}
        <section aria-labelledby="rutas-title" className="glass rounded-3xl p-5 md:p-6 lg:col-span-2">
          <h2 id="rutas-title" className="font-display text-xl font-bold">
            Rutas sugeridas
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {routes.map((r) => (
              <li key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h3 className="font-display text-lg font-bold">{r.titulo}</h3>
                <p className="text-sm text-vice-text/80">{r.descripcion}</p>
                <StatBar className="mt-3" label="Completado" value={(r.done / r.total) * 100} valueLabel={`${r.done}/${r.total}`} accent="gold" />
                <a
                  href={r.nextId ? `/mapa?marker=${r.nextId}` : '/mapa'}
                  className={`mt-3 inline-flex min-h-11 items-center rounded-full bg-vice-accent px-5 font-bold text-vice-ink ${FOCUS}`}
                >
                  {r.nextId ? 'Ir al siguiente punto' : 'Ruta completa · ver mapa'}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* Anuncio global (config pública) */}
        {cfg.announcement && (
          <section aria-label="Anuncio" className="glass rounded-3xl p-5 lg:col-span-3">
            <h2 className="font-display text-xl font-bold">Aviso</h2>
            <p className="mt-2 text-sm text-vice-text/90">{cfg.announcement}</p>
          </section>
        )}

        {/* Novedades: solo noticias oficiales (pilar 3) */}
        <section id="noticias" aria-labelledby="novedades-title" className="lg:col-span-3">
          <div className="flex items-end justify-between gap-3">
            <h2 id="novedades-title" className="font-display text-xl font-bold">
              Novedades oficiales
            </h2>
            <a href="/noticias" className={`inline-flex min-h-11 items-center px-2 text-sm font-semibold text-vice-orange underline underline-offset-4 ${FOCUS}`}>
              Ver todas
            </a>
          </div>
          <div aria-live="polite" className="mt-2">
            {newsLoading ? (
              <p role="status" className="text-sm text-vice-text/80">
                Cargando noticias oficiales…
              </p>
            ) : newsError || news.length === 0 ? (
              <p className="glass rounded-2xl p-4 text-sm">
                {newsError ? 'No pudimos cargar las noticias oficiales. ' : 'Aún no hay noticias oficiales. '}
                <a
                  href="https://www.rockstargames.com/newswire"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`font-semibold text-vice-orange underline ${FOCUS}`}
                >
                  Ver Rockstar Newswire
                </a>
              </p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-3">
                {news.map((n) => (
                  <li key={n.id}>
                    <a href={`/noticias/${encodeURIComponent(n.slug)}`} className={`glass flex min-h-11 items-center gap-3 rounded-[18px] p-2.5 hover:border-vice-orange ${FOCUS}`}>
                      <span className="relative block size-16 shrink-0 overflow-hidden rounded-xl bg-vice-night">
                        {n.imageUrl ? (
                          <img src={n.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <CropImg crop={CROPS.noticias} />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 block text-sm font-semibold">{n.title}</span>
                        <span className="block text-xs text-vice-text/80">
                          {SOURCE_LABEL[n.source] ?? n.source} · {new Date(n.publishedAt).toLocaleDateString('es')}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Accesos */}
        <nav aria-label="Accesos rápidos" className="lg:col-span-3">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {quick.map((q) => (
              <li key={q.href}>
                <a href={q.href} className={`group glass flex h-full flex-col overflow-hidden rounded-2xl hover:border-vice-orange ${FOCUS}`}>
                  <span className="relative block aspect-[4/3] w-full overflow-hidden bg-vice-night">
                    <CropImg crop={CROPS[q.crop]} />
                  </span>
                  <span className="flex flex-col px-3 pb-3 pt-2">
                    <span className="font-display text-base font-bold leading-tight">{q.title}</span>
                    <span className="text-xs text-vice-text/80">{q.text}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {(error || data.source === 'seed' || !isApiConfigured) && (
        <p role="status" className="mt-6 text-xs text-vice-text/60">
          {error ? `No se pudo conectar con el servidor (${error}). ` : ''}
          {SAMPLE_NOTICE}
        </p>
      )}
    </div>
  );
}
