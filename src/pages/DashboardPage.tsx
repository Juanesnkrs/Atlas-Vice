// P03 - Dashboard de Progreso (Hub): avance 100%, rutas sugeridas, novedades
import { useEffect, useRef, useState } from 'react';
import { StatBar, type StatAccent } from '../components/ui/StatBar';
import { TipCard } from '../components/ui/TipCard';
import {
  SAMPLE_NOTICE,
  NEWS_SOURCES,
  SEED_ROUTES,
  SEED_TIPS,
  useOfficialNews,
  usePublicConfig,
  useProgressSummary,
  useModuleGate,
  useWorldData,
  type NewsSource,
} from '../data/seed';
import { isApiConfigured, useAuthStore } from '../store/useAuthStore';
import { useProgressStore } from '../store/useProgressStore';

const ACCENTS: Record<string, StatAccent> = {
  markers: 'magenta',
  armas: 'gold',
  vehiculos: 'cyan',
  coleccionables: 'lilac',
};

/** `module`: slug del módulo que debe estar activo para mostrar el acceso (los inactivos no se muestran). */
const QUICK: ReadonlyArray<{ href: string; title: string; text: string; module?: string }> = [
  { href: '/mapa', title: 'Mapa de Leonida', text: 'Pines, capas y check 100%.', module: 'mapa' },
  { href: '/catalogo', title: 'Catálogo', text: 'Armas, vehículos y coleccionables.', module: 'catalogo' },
  { href: '/guias', title: 'Guías', text: 'Pasos verificables y rutas.', module: 'guias' },
  { href: '/foro', title: 'Foro', text: 'Hilos, votos y spoilers.', module: 'foro' },
  { href: '/noticias', title: 'Noticias oficiales', text: 'Rockstar Games y Take-Two.' },
  { href: '/aportar', title: 'Aportar', text: 'Envía hallazgos (requiere cuenta).' },
];

function Ring({ percent }: { percent: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label={`Avance total ${percent}%`}>
      <defs>
        <linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E1307E" />
          <stop offset="1" stopColor="#F69259" />
        </linearGradient>
      </defs>
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="12" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke="url(#ringG)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(c * percent) / 100} ${c}`}
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="78" textAnchor="middle" fontSize="30" fontWeight="700" fill="#FBF1F5" fontFamily="Jost, sans-serif">
        {percent}%
      </text>
    </svg>
  );
}

const SOURCE_LABEL: Record<NewsSource, string> = {
  'rockstar-newswire': 'Rockstar Newswire',
  'rockstar-youtube': 'Rockstar YouTube',
  'take-two-ir': 'Take-Two IR',
};

export default function DashboardPage({
  section,
  highlight = null,
}: {
  section: 'hub' | 'progress' | 'news';
  highlight?: string | null;
}) {
  const [source, setSource] = useState<NewsSource | 'all'>('all');
  const { news, loading: newsLoading, error: newsError } = useOfficialNews(source, 12);
  const cfg = usePublicConfig();
  const { isActive, catalogActive } = useModuleGate();
  const quick = QUICK.filter((q) => (q.module === 'catalogo' ? catalogActive : q.module ? isActive(q.module) : true));
  const newsRef = useRef<HTMLElement>(null);
  const summary = useProgressSummary();
  const { data, loading, error } = useWorldData();
  const items = useProgressStore((s) => s.items);
  const hydrated = useProgressStore((s) => s.hydrated);
  const syncStatus = useProgressStore((s) => s.syncStatus);
  const syncError = useProgressStore((s) => s.syncError);
  const lastSyncedAt = useProgressStore((s) => s.lastSyncedAt);
  const syncWithCloud = useProgressStore((s) => s.syncWithCloud);
  const status = useAuthStore((s) => s.status);
  const progressRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (section === 'progress') progressRef.current?.scrollIntoView({ block: 'start' });
    if (section === 'news') newsRef.current?.scrollIntoView({ block: 'start' });
  }, [section]);

  useEffect(() => {
    if (!highlight || news.length === 0) return;
    document.getElementById(`noticia-${highlight}`)?.scrollIntoView({ block: 'center' });
  }, [highlight, news.length]);

  const markerIds = new Set(data.markers.map((m) => m.id));
  const routes = SEED_ROUTES.map((r) => {
    const ids = r.markerIds.filter((id) => markerIds.has(id));
    const done = ids.filter((id) => items[`marker:${id}`]?.completado).length;
    const nextId = ids.find((id) => !items[`marker:${id}`]?.completado);
    return { ...r, total: ids.length, done, nextId };
  }).filter((r) => r.total > 0);

  const authenticated = status === 'authenticated';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold md:text-4xl">Mi avance</h1>
      <p className="mt-1 text-sm text-vice-text/80">
        {authenticated
          ? 'Tu progreso se sincroniza con tu cuenta.'
          : 'Modo Invitado: tu progreso se guarda en este dispositivo.'}{' '}
        <span className="text-vice-text/60">{SAMPLE_NOTICE}</span>
      </p>

      {(error || loading || !isApiConfigured) && (
        <p role="status" className="glass mt-3 rounded-xl px-4 py-2 text-sm">
          {error
            ? `No se pudo leer la API (${error}). Mostrando datos de ejemplo.`
            : loading
              ? 'Cargando datos desde la API…'
              : 'Sin API configurada: mostrando datos de ejemplo y trabajando sin conexión.'}
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Avance total y por categoría */}
        <section
          id="progreso"
          ref={progressRef}
          aria-labelledby="avance-title"
          className="glass rounded-2xl p-5 lg:col-span-2"
        >
          <h2 id="avance-title" className="font-display text-xl font-bold">
            Avance total
          </h2>
          {!hydrated ? (
            <p role="status" className="mt-4 text-vice-text/80">
              Cargando tu progreso local…
            </p>
          ) : (
            <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
              <Ring percent={summary.percent} />
              <div className="flex w-full flex-col gap-4">
                <p className="text-sm text-vice-text/85">
                  {summary.done} de {summary.total} elementos completados
                </p>
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
            </div>
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
                        ? `Última sincronización: ${new Date(lastSyncedAt).toLocaleString('es')}`
                        : 'Pendiente de sincronizar'}
                </span>
                <button
                  type="button"
                  onClick={() => void syncWithCloud()}
                  disabled={syncStatus === 'syncing'}
                  className="glass min-h-11 rounded-full px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-50"
                >
                  Reintentar sincronización
                </button>
              </>
            ) : (
              <span>
                <a href="/entrar" className="inline-flex min-h-11 items-center text-vice-orange underline">
                  Inicia sesión
                </a>{' '}
                para sincronizar tu avance entre dispositivos.
              </span>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-5">
          <TipCard tips={SEED_TIPS} />
        </div>

        {/* Rutas sugeridas */}
        <section aria-labelledby="rutas-title" className="glass rounded-2xl p-5 lg:col-span-2">
          <h2 id="rutas-title" className="font-display text-xl font-bold">
            Rutas sugeridas
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {routes.map((r) => (
              <li key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="font-display text-lg font-bold">{r.titulo}</h3>
                <p className="text-sm text-vice-text/80">{r.descripcion}</p>
                <StatBar
                  className="mt-3"
                  label="Completado"
                  value={(r.done / r.total) * 100}
                  valueLabel={`${r.done}/${r.total}`}
                  accent="gold"
                />
                <a
                  href={r.nextId ? `/mapa?marker=${r.nextId}` : '/mapa'}
                  className="mt-3 inline-flex min-h-11 items-center rounded-full bg-vice-accent px-5 font-bold text-vice-ink focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  {r.nextId ? 'Ir al siguiente punto' : 'Ruta completa · ver mapa'}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* Anuncio global (config pública) */}
        {cfg.announcement && (
          <section aria-label="Anuncio" className="glass rounded-2xl p-5 lg:col-span-3">
            <h2 className="font-display text-xl font-bold">Aviso</h2>
            <p className="mt-2 text-sm text-vice-text/90">{cfg.announcement}</p>
          </section>
        )}

        {/* Noticias Oficiales: solo desde la API de noticias oficiales */}
        <section
          id="noticias"
          ref={newsRef}
          aria-labelledby="noticias-title"
          className="glass rounded-2xl p-5 lg:col-span-3"
        >
          <h2 id="noticias-title" className="font-display text-xl font-bold">
            Noticias Oficiales
          </h2>
          <div role="group" aria-label="Filtrar por fuente oficial" className="mt-3 flex flex-wrap gap-2">
            {NEWS_SOURCES.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={source === f.value}
                onClick={() => setSource(f.value)}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                  source === f.value ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div aria-live="polite" className="mt-3">
            {newsLoading ? (
              <p role="status" className="text-sm text-vice-text/80">
                Cargando noticias oficiales…
              </p>
            ) : newsError ? (
              <p role="status" className="text-sm text-vice-gold">
                No se pudieron cargar las noticias oficiales ({newsError}).
              </p>
            ) : news.length === 0 ? (
              <p className="text-sm text-vice-text/70">Aún no hay noticias oficiales para esta fuente.</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {news.map((n) => (
                  <li
                    key={n.id}
                    id={`noticia-${n.slug}`}
                    className={`rounded-xl border bg-white/5 p-4 ${
                      highlight === n.slug ? 'border-vice-gold ring-2 ring-vice-gold' : 'border-white/10'
                    }`}
                  >
                    <p className="text-xs text-vice-orange">
                      {SOURCE_LABEL[n.source] ?? n.source} · {new Date(n.publishedAt).toLocaleDateString('es')}
                    </p>
                    <h3 className="mt-1 font-semibold">
                      <a href={`/noticias/${encodeURIComponent(n.slug)}`} className="hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold">
                        {n.title}
                      </a>
                    </h3>
                    {n.summary && <p className="mt-1 line-clamp-3 text-sm text-vice-text/80">{n.summary}</p>}
                    <a
                      href={n.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-vice-orange underline"
                    >
                      Leer en la fuente original
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Accesos */}
        <nav aria-label="Accesos rápidos" className="grid gap-3 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-3">
          {quick.map((q) => (
            <a
              key={q.href}
              href={q.href}
              className="glass flex min-h-[72px] flex-col justify-center rounded-2xl px-5 py-3 hover:border-vice-orange focus-visible:outline-2 focus-visible:outline-vice-gold"
            >
              <span className="font-display text-lg font-bold">{q.title}</span>
              <span className="text-sm text-vice-text/80">{q.text}</span>
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
