// P03 - Dashboard de Progreso (Hub `/hub` y `/progreso`): avance 100% y novedades.
// Sigue la pestaña Progreso de Mobile.dc.html; las novedades salen solo de la API de noticias oficiales.
import { useEffect, useRef } from 'react';
import { ApiErrorState } from '../components/ui/ApiErrorState';
import { StatBar, type StatAccent } from '../components/ui/StatBar';
import { TipCard } from '../components/ui/TipCard';
import {
  NEWS_SOURCES,
  TIPS,
  describeApiError,
  useModuleGate,
  useOfficialNews,
  useProgressSummary,
  usePublicConfig,
} from '../data/seed';
import { useAuthStore } from '../store/useAuthStore';
import { useProgressStore } from '../store/useProgressStore';
import { CROPS, CropImg } from './HomePage';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold';

const ACCENTS: Record<string, StatAccent> = {
  markers: 'magenta',
  armas: 'gold',
  vehiculos: 'cyan',
  coleccionables: 'lilac',
};

/** Hora relativa corta en español («hace 2 min»). */
function relativeTime(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

const START: ReadonlyArray<{ href: string; label: string; module?: string }> = [
  { href: '/mapa', label: 'Explorar el mapa', module: 'mapa' },
  { href: '/guias', label: 'Abrir guías', module: 'guias' },
  { href: '/foro', label: 'Ver hilos recientes', module: 'foro' },
];

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(NEWS_SOURCES.map((s) => [s.value, s.label]));

/** `module`: slug del módulo que debe estar activo para mostrar el acceso (los inactivos no se muestran). */
const QUICK: ReadonlyArray<{ href: string; title: string; text: string; crop: keyof typeof CROPS; module?: string }> = [
  { href: '/guias', title: 'Guías', text: 'Pasos claros para cada reto.', crop: 'guias', module: 'guias' },
  { href: '/noticias', title: 'Noticias oficiales', text: 'Rockstar Games y Take-Two.', crop: 'noticias' },
  { href: '/aportar', title: 'Aportar', text: 'Comparte lugares y correcciones.', crop: 'coleccionables' },
  { href: '/mapa', title: 'Mapa de Leonida', text: 'Lugares, capas y tu avance.', crop: 'mapa', module: 'mapa' },
  { href: '/catalogo', title: 'Catálogo', text: 'Fichas de armas y vehículos de Leonida.', crop: 'vehiculos', module: 'catalogo' },
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
  const { news, loading: newsLoading, error: newsError, retry: retryNews } = useOfficialNews('all', 3);
  const cfg = usePublicConfig();
  const { isActive, catalogActive } = useModuleGate();
  const quick = QUICK.filter((q) => (q.module === 'catalogo' ? catalogActive : q.module ? isActive(q.module) : true));
  const summary = useProgressSummary();
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

  const authenticated = status === 'authenticated';
  const markers = summary.categories.find((c) => c.id === 'markers');
  const start = START.filter((s) => !s.module || isActive(s.module));
  const visibleCats = summary.categories.filter((c) => c.total > 0);
  const catalogCats = visibleCats.filter((c) => c.id !== 'markers');
  const catalogDone = catalogCats.reduce((a, c) => a + c.done, 0);
  const catalogTotal = catalogCats.reduce((a, c) => a + c.total, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold text-[#FFC09A] md:text-4xl">Mi avance</h1>
      <p className="mt-1 text-sm text-vice-text/90">
        Hola, {username ?? 'invitado'}. Así va tu 100% de Leonida.
      </p>

      {start.length > 0 && (
        <nav aria-label="Para empezar" className="mt-4">
          <ul className="flex flex-col gap-2 sm:flex-row">
            {start.map((s, i) => (
              <li key={s.href} className="sm:flex-1">
                <a
                  href={s.href}
                  className={`flex min-h-12 items-center justify-center rounded-2xl px-4 text-center font-bold ${FOCUS} ${
                    i === 0 ? 'bg-vice-accent text-vice-ink' : 'glass hover:border-vice-orange'
                  }`}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Avance total y por categoría */}
        <section id="progreso" ref={progressRef} aria-labelledby="avance-title" className="glass rounded-3xl p-5 md:p-6 lg:col-span-2">
          <h2 id="avance-title" className="font-display text-xl font-bold">
            Avance total
          </h2>
          {!hydrated ? (
            <p role="status" className="mt-4 text-vice-text/80">
              Cargando tu avance…
            </p>
          ) : summary.unavailable ? (
            <ApiErrorState compact title="No pudimos calcular tu avance" message={summary.error ?? describeApiError()} onRetry={() => {
                summary.retry();
                retryNews();
              }} />
          ) : (
            <>
              <div className="mt-4 flex items-center gap-5">
                <Ring percent={summary.percent} />
                <p className="text-[13px] leading-relaxed text-vice-text/90">
                  <span className="font-semibold text-white">
                    {markers?.done ?? 0} de {markers?.total ?? 0}
                  </span>{' '}
                  lugares del mapa completados.
                  {catalogTotal > 0 && (
                    <>
                      <br />
                      <span className="font-semibold text-white">
                        {catalogDone} de {catalogTotal}
                      </span>{' '}
                      fichas del catálogo ({catalogCats.map((c) => c.label.toLowerCase()).join(', ')}).
                    </>
                  )}
                  <br />
                  <span className="text-vice-text/70">Las guías no suman al porcentaje.</span>
                </p>
              </div>
              <div className="mt-5 flex flex-col gap-4">
                {visibleCats.map((c) => (
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
                    ? 'Guardando…'
                    : syncStatus === 'error'
                      ? `No se pudo guardar tu avance${syncError ? `: ${syncError}` : '.'}`
                      : lastSyncedAt
                        ? `Todo guardado · ${relativeTime(lastSyncedAt)}`
                        : 'Todo guardado'}
                </span>
                {syncStatus === 'error' && (
                  <button
                    type="button"
                    onClick={() => void syncWithCloud()}
                    className={`glass min-h-11 rounded-full px-4 font-semibold ${FOCUS}`}
                  >
                    Reintentar
                  </button>
                )}
              </>
            ) : (
              <span>
                Tu avance se guarda en este dispositivo.{' '}
                <a href="/entrar" className={`inline-flex min-h-11 items-center text-vice-orange underline ${FOCUS}`}>
                  Inicia sesión
                </a>{' '}
                para guardarlo en tu cuenta.
              </span>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-5">
          <TipCard tips={TIPS} />
        </div>

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
          <div aria-live="polite" className={newsLoading ? 'mt-2 min-h-[280px] md:min-h-[88px]' : 'mt-2'}>
            {newsLoading ? (
              <p role="status" className="text-sm text-vice-text/80">
                Cargando noticias oficiales…
              </p>
            ) : newsError || news.length === 0 ? (
              <p className="glass rounded-2xl p-4 text-sm">
                {newsError ? (
                  <>
                    {newsError}{' '}
                    <button type="button" onClick={retryNews} className={`inline-flex min-h-11 items-center font-semibold text-vice-orange underline ${FOCUS}`}>
                      Reintentar
                    </button>{' '}
                  </>
                ) : (
                  'Aún no hay noticias oficiales. '
                )}
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

    </div>
  );
}
