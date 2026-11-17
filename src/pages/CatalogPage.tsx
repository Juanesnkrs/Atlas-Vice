// P05 - Inspector NUI: Armas / Vehículos / Coleccionables / Guías
import { useEffect, useMemo, useState } from 'react';
import { SunsetBanner } from '../components/layout/ViceShell';
import { StatBar, type StatAccent } from '../components/ui/StatBar';
import {
  SAMPLE_NOTICE,
  forumCategoryLabel,
  metaOf,
  statsOf,
  useForumData,
  useWorldData,
} from '../data/seed';
import { useProgressStore } from '../store/useProgressStore';
import type { Entity } from '../types/database';

type TabSlug = 'armas' | 'vehiculos' | 'coleccionables' | 'guias';

const TABS: ReadonlyArray<{ slug: TabSlug; label: string; heading: string; doneLabel: string }> = [
  { slug: 'armas', label: 'Armas', heading: 'ARMERÍA', doneLabel: 'Obtenida' },
  { slug: 'vehiculos', label: 'Vehículos', heading: 'GARAJE', doneLabel: 'Obtenido' },
  { slug: 'coleccionables', label: 'Coleccionables', heading: 'COLECCIONABLES', doneLabel: 'Completado' },
  { slug: 'guias', label: 'Guías', heading: 'GUÍAS Y MISIONES', doneLabel: '' },
];

const ACCENTS: StatAccent[] = ['magenta', 'gold', 'cyan', 'lilac'];

// ---- Siluetas SVG de armas y vehículos -----------------------------------------
const WEAPON_PATHS: Record<string, string> = {
  pistol: 'M30 30 H150 V50 H98 L92 62 H78 L70 92 H46 L54 50 H30 Z',
  smg: 'M14 38 H120 V30 H150 V40 H184 V50 H120 V58 H100 L96 94 H78 L82 58 H60 L48 76 H28 L36 52 H14 Z',
  rifle: 'M6 44 H74 V36 H150 V44 H194 V54 H150 V60 H104 L98 92 H80 L84 60 H62 L48 80 H26 L38 56 H6 Z',
  shotgun: 'M4 46 H120 V40 H196 V50 H132 V56 H104 L96 92 H78 L82 56 H56 L44 78 H22 L32 56 H4 Z',
  sniper: 'M4 52 H64 V38 H112 V30 H140 V38 H196 V46 H140 V56 H100 L94 90 H78 L82 56 H60 L46 78 H24 L34 58 H4 Z',
};

function VehiclePaths({ kind }: { kind: string }) {
  switch (kind) {
    case 'sports':
      return (
        <>
          <path d="M14 66 C16 52 44 44 80 40 C100 30 136 30 156 44 C190 48 226 56 228 68 V74 H14 Z" />
          <circle cx="60" cy="74" r="14" />
          <circle cx="182" cy="74" r="14" />
        </>
      );
    case 'muscle':
      return (
        <>
          <path d="M10 68 V52 C40 46 60 36 92 34 H140 C170 36 196 50 232 54 V74 H10 Z" />
          <circle cx="58" cy="74" r="15" />
          <circle cx="184" cy="74" r="15" />
        </>
      );
    case 'suv':
      return (
        <>
          <path d="M12 74 V46 C20 36 40 32 70 30 H170 C196 34 220 44 230 56 V74 Z" />
          <circle cx="62" cy="76" r="16" />
          <circle cx="182" cy="76" r="16" />
        </>
      );
    case 'sedan':
      return (
        <>
          <path d="M10 72 V54 C30 50 56 46 80 34 H150 C176 40 200 48 232 56 V72 Z" />
          <circle cx="60" cy="74" r="14" />
          <circle cx="184" cy="74" r="14" />
        </>
      );
    case 'bike':
      return (
        <>
          <path d="M70 70 L100 40 H130 L150 56 L170 40 H182 L160 70 H110 Z" />
          <circle cx="58" cy="72" r="18" fill="none" stroke="currentColor" strokeWidth="6" />
          <circle cx="182" cy="72" r="18" fill="none" stroke="currentColor" strokeWidth="6" />
        </>
      );
    default: // boat
      return (
        <>
          <path d="M10 56 H230 C220 76 196 84 170 84 H60 C36 84 18 74 10 56 Z" />
          <path d="M80 56 L100 34 H150 L170 56 Z" />
        </>
      );
  }
}

function Silhouette({ entity, className = '' }: { entity: Entity; className?: string }) {
  const meta = metaOf(entity);
  const kind = String(meta.silueta ?? '');
  const isWeapon = kind in WEAPON_PATHS;
  return (
    <svg
      role="img"
      aria-label={`Silueta de ${entity.titulo}`}
      viewBox={isWeapon ? '0 0 200 100' : '0 0 240 100'}
      className={className}
      fill="currentColor"
    >
      {isWeapon ? <path d={WEAPON_PATHS[kind]} /> : <VehiclePaths kind={kind} />}
    </svg>
  );
}

function Artwork({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <SunsetBanner className={className} />;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(src)} />;
}

/** Imagen de un ítem: artwork real, silueta SVG (armas/vehículos) o banner sunset. */
function ItemVisual({ entity, className = '' }: { entity: Entity; className?: string }) {
  if (entity.imagen_url) {
    return <Artwork src={entity.imagen_url} alt={entity.titulo} className={`object-cover ${className}`} />;
  }
  if (metaOf(entity).silueta) {
    return <Silhouette entity={entity} className={`text-vice-text/90 ${className}`} />;
  }
  return <SunsetBanner className={className} />;
}

const fmtMeta = (key: string, v: unknown): string => {
  if (key === 'precio' && typeof v === 'number') return `$${v.toLocaleString('es')}`;
  return String(v);
};

const META_LABELS: Record<string, string> = {
  ubicacion: 'Ubicación',
  precio: 'Precio',
  municion: 'Munición',
  plazas: 'Plazas',
  region: 'Región',
};

export default function CatalogPage({ params }: { params: URLSearchParams }) {
  const { data, loading, error } = useWorldData();
  const { data: forum } = useForumData();
  const items = useProgressStore((s) => s.items);
  const toggle = useProgressStore((s) => s.toggle);

  const modulesById = useMemo(() => new Map(data.modules.map((m) => [m.id, m])), [data.modules]);
  const activeSlugs = useMemo(
    () => new Set(data.modules.filter((m) => m.activo).map((m) => m.slug)),
    [data.modules],
  );
  const tabs = TABS.filter((t) => activeSlugs.has(t.slug));

  const [tab, setTab] = useState<TabSlug>('armas');
  const [cat, setCat] = useState<string>('Todas');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSpoiler, setShowSpoiler] = useState(false);

  const inTab = (slug: TabSlug): Entity[] =>
    data.entities.filter((e) => modulesById.get(e.module_id)?.slug === slug);
  const tabEntities = inTab(tab);
  const categories = ['Todas', ...Array.from(new Set(tabEntities.map((e) => e.categoria)))];
  const list = cat === 'Todas' ? tabEntities : tabEntities.filter((e) => e.categoria === cat);
  const selected = list.find((e) => e.id === selectedId) ?? list[0] ?? null;
  const tabDef = TABS.find((t) => t.slug === tab) ?? TABS[0]!;

  // Deep-link: #/catalogo?entity=ID
  const entityParam = params.get('entity');
  useEffect(() => {
    if (!entityParam) return;
    const e = data.entities.find((x) => x.id === entityParam);
    const slug = e ? (modulesById.get(e.module_id)?.slug as TabSlug | undefined) : undefined;
    if (e && slug) {
      setTab(slug);
      setCat('Todas');
      setSelectedId(e.id);
    }
  }, [entityParam, data.entities, modulesById]);

  // Si el módulo activo se desactiva, saltar al primer tab disponible.
  useEffect(() => {
    const first = tabs[0];
    if (first && !tabs.some((t) => t.slug === tab)) setTab(first.slug);
  }, [tabs, tab]);

  useEffect(() => setShowSpoiler(false), [selected?.id]);

  const linkedMarkers = selected ? data.markers.filter((m) => m.entity_id === selected.id) : [];
  const threads = selected
    ? forum.threads.filter(
        (t) => t.entity_id === selected.id || linkedMarkers.some((m) => m.id === t.marker_id),
      )
    : [];
  const done = (e: Entity): boolean => items[`entity:${e.id}`]?.completado === true;
  const meta = selected ? metaOf(selected) : {};
  const stats = selected ? statsOf(selected) : [];
  const trackable = tab !== 'guias';
  const pasos = Array.isArray(meta.pasos) ? (meta.pasos as string[]) : [];
  const spoilerHidden = tab === 'guias' && meta.spoiler === true && !showSpoiler;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-3 pt-1 md:px-8">
      {/* Cabecera y tabs */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="font-display text-xl font-bold tracking-wide md:text-2xl">
          {tabDef.heading}
          <span className="text-vice-orange"> // {cat.toUpperCase()}</span>
        </h1>
        <div role="tablist" aria-label="Categorías del catálogo" className="flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.slug}
              type="button"
              role="tab"
              aria-selected={tab === t.slug}
              onClick={() => {
                setTab(t.slug);
                setCat('Todas');
                setSelectedId(null);
              }}
              className={`min-h-11 whitespace-nowrap rounded-full px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                tab === t.slug ? 'bg-vice-accent text-vice-ink' : 'glass hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label="Filtrar por categoría" className="flex gap-1 overflow-x-auto">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={cat === c}
            onClick={() => {
              setCat(c);
              setSelectedId(null);
            }}
            className={`min-h-11 whitespace-nowrap rounded-full border px-4 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
              cat === c ? 'border-vice-orange bg-white/15' : 'border-white/15 hover:bg-white/10'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {(loading || error) && (
        <p role="status" className="text-xs text-vice-text/80">
          {loading ? 'Cargando desde Supabase… ' : ''}
          {error ? `Supabase no disponible (${error}); usando el seed.` : ''}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 md:grid md:grid-cols-[minmax(250px,320px)_1fr_minmax(280px,340px)] md:gap-5">
        {/* Visor + estadísticas (arriba y fijo en móvil) */}
        <div className="order-1 flex shrink-0 flex-col gap-3 max-md:max-h-[44dvh] max-md:overflow-y-auto md:contents">
          <section
            aria-label="Visor"
            className="glass relative flex h-36 items-center justify-center overflow-hidden rounded-2xl md:order-2 md:h-auto"
          >
            {selected ? (
              <>
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[radial-gradient(circle_at_50%_60%,rgba(225,48,126,0.35),transparent_65%)]"
                />
                <ItemVisual
                  entity={selected}
                  className={
                    selected.imagen_url
                      ? 'absolute inset-0 h-full w-full'
                      : 'relative h-4/5 w-4/5 max-w-[640px] drop-shadow-[0_10px_30px_rgba(225,48,126,0.5)]'
                  }
                />
                <p className="absolute bottom-3 left-4 right-4 truncate rounded-lg bg-[#1a0a22]/70 px-3 py-1 font-display text-lg font-bold">
                  {selected.titulo}
                </p>
              </>
            ) : (
              <p className="text-vice-text/70">Sin elementos en esta categoría.</p>
            )}
          </section>

          <aside aria-label="Estadísticas" className="glass flex flex-col gap-3 rounded-2xl p-4 md:order-3 md:overflow-y-auto">
            {selected ? (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{selected.categoria}</p>
                  <h2 className="font-display text-xl font-bold">{selected.titulo}</h2>
                  {selected.subtitulo && <p className="text-sm text-vice-text/80">{selected.subtitulo}</p>}
                </div>

                {stats.length > 0 && (
                  <div className="flex flex-col gap-3">
                    {stats.map((s, i) => (
                      <StatBar key={s.key} label={s.label} value={s.value} accent={ACCENTS[i % ACCENTS.length]} />
                    ))}
                  </div>
                )}

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {Object.entries(meta)
                    .filter(([k]) => k in META_LABELS)
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-vice-text/70">{META_LABELS[k]}</dt>
                        <dd className="font-semibold">{fmtMeta(k, v)}</dd>
                      </div>
                    ))}
                  <div className="contents">
                    <dt className="text-vice-text/70">Puntos en el mapa</dt>
                    <dd className="font-semibold">
                      {linkedMarkers.filter((m) => items[`marker:${m.id}`]?.completado).length}/{linkedMarkers.length}
                    </dd>
                  </div>
                </dl>

                {tab === 'guias' && (
                  <div>
                    <h3 className="font-display text-base font-bold">Pasos</h3>
                    {spoilerHidden ? (
                      <div className="mt-1 rounded-xl border border-vice-gold/40 p-3 text-sm">
                        <p>Contenido con spoiler.</p>
                        <button
                          type="button"
                          onClick={() => setShowSpoiler(true)}
                          className="mt-2 min-h-11 rounded-full bg-white/10 px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
                        >
                          Mostrar spoiler
                        </button>
                      </div>
                    ) : (
                      <ol className="mt-1 list-decimal pl-5 text-sm">
                        {pasos.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                {trackable && (
                  <button
                    type="button"
                    aria-pressed={done(selected)}
                    onClick={() => toggle({ entityId: selected.id })}
                    className={`min-h-11 rounded-xl px-4 font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                      done(selected) ? 'bg-vice-gold text-vice-ink' : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    {done(selected) ? `${tabDef.doneLabel} al 100% (quitar)` : `Marcar como ${tabDef.doneLabel.toLowerCase()}`}
                  </button>
                )}

                {linkedMarkers[0] ? (
                  <a
                    href={`#/mapa?entity=${selected.id}`}
                    className="flex min-h-11 items-center justify-center rounded-xl bg-vice-accent px-4 font-bold text-vice-ink focus-visible:outline-2 focus-visible:outline-vice-gold"
                  >
                    Ver en mapa
                  </a>
                ) : (
                  <span className="flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-4 text-sm text-vice-text/60">
                    Sin ubicación en el mapa
                  </span>
                )}
                <a
                  href={`#/foro?entity=${selected.id}`}
                  className="flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-4 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  Discutir ({threads.length})
                </a>
                {threads.length > 0 && (
                  <ul aria-label="Hilos relacionados" className="flex flex-col text-sm">
                    {threads.slice(0, 3).map((t) => (
                      <li key={t.id}>
                        <a
                          href={`#/foro?thread=${t.id}`}
                          className="block min-h-11 rounded-lg px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                        >
                          <span className="text-xs text-vice-orange">{forumCategoryLabel(t.categoria)} · ▲ {t.upvotes_count}</span>
                          <span className="block font-semibold">{t.titulo}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-vice-text/60">{SAMPLE_NOTICE}</p>
              </>
            ) : (
              <p className="text-vice-text/70">Selecciona un elemento.</p>
            )}
          </aside>
        </div>

        {/* Rejilla (izquierda en escritorio) */}
        <section
          aria-label="Selección"
          className="order-2 min-h-0 flex-1 overflow-y-auto pb-2 md:order-1"
        >
          {list.length === 0 ? (
            <p className="p-4 text-vice-text/70">No hay elementos para mostrar.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {list.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    aria-pressed={selected?.id === e.id}
                    aria-label={`${e.titulo}${done(e) ? ', completado' : ''}`}
                    onClick={() => setSelectedId(e.id)}
                    className={`glass relative flex aspect-square min-h-[44px] w-full flex-col items-center justify-center overflow-hidden rounded-xl p-1 focus-visible:outline-2 focus-visible:outline-vice-gold ${
                      selected?.id === e.id ? 'border-vice-magenta ring-2 ring-vice-magenta' : 'hover:border-vice-orange'
                    }`}
                  >
                    <ItemVisual
                      entity={e}
                      className={e.imagen_url ? 'absolute inset-0 h-full w-full' : 'h-3/5 w-4/5'}
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-[#1a0a22]/75 px-1 text-[11px] font-semibold">
                      {e.titulo}
                    </span>
                    {done(e) && (
                      <span aria-hidden="true" className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-vice-gold text-xs font-bold text-vice-ink">
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
