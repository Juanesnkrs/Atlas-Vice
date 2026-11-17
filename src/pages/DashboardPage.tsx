// P03 - Dashboard de Progreso (Hub): avance 100%, rutas sugeridas, novedades
import { useEffect, useRef } from 'react';
import { StatBar, type StatAccent } from '../components/ui/StatBar';
import { TipCard } from '../components/ui/TipCard';
import {
  SAMPLE_NOTICE,
  SEED_NEWS,
  SEED_ROUTES,
  SEED_TIPS,
  useProgressSummary,
  useWorldData,
} from '../data/seed';
import { isSupabaseConfigured, useAuthStore } from '../store/useAuthStore';
import { useProgressStore } from '../store/useProgressStore';

const ACCENTS: Record<string, StatAccent> = {
  markers: 'magenta',
  armas: 'gold',
  vehiculos: 'cyan',
  coleccionables: 'lilac',
};

const QUICK = [
  { href: '#/mapa', title: 'Mapa de Leonida', text: 'Pines, capas y check 100%.' },
  { href: '#/catalogo', title: 'Catálogo', text: 'Armas, vehículos y coleccionables.' },
  { href: '#/foro', title: 'Foro', text: 'Hilos, votos y spoilers.' },
  { href: '#/aportes', title: 'Aportar', text: 'Envía hallazgos (requiere cuenta).' },
] as const;

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

export default function DashboardPage({ section }: { section: 'hub' | 'progress' }) {
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
  }, [section]);

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

      {(error || loading || !isSupabaseConfigured) && (
        <p role="status" className="glass mt-3 rounded-xl px-4 py-2 text-sm">
          {error
            ? `No se pudo leer Supabase (${error}). Mostrando datos de ejemplo.`
            : loading
              ? 'Cargando datos desde Supabase…'
              : 'Sin Supabase configurado: mostrando datos de ejemplo y trabajando sin conexión.'}
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
                <a href="#/entrar" className="inline-flex min-h-11 items-center text-vice-orange underline">
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
                  href={r.nextId ? `#/mapa?marker=${r.nextId}` : '#/mapa'}
                  className="mt-3 inline-flex min-h-11 items-center rounded-full bg-vice-accent px-5 font-bold text-vice-ink focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  {r.nextId ? 'Ir al siguiente punto' : 'Ruta completa · ver mapa'}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* Novedades */}
        <section aria-labelledby="novedades-title" className="glass rounded-2xl p-5">
          <h2 id="novedades-title" className="font-display text-xl font-bold">
            Novedades
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {SEED_NEWS.map((n) => (
              <li key={n.id} className="border-l-2 border-vice-magenta pl-3">
                <p className="text-xs text-vice-orange">{n.fecha}</p>
                <h3 className="font-semibold">{n.titulo}</h3>
                <p className="text-sm text-vice-text/80">{n.texto}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Accesos */}
        <nav aria-label="Accesos rápidos" className="grid gap-3 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-4">
          {QUICK.map((q) => (
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
