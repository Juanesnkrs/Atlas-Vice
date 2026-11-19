// P05 - Inspector NUI: Armas / Vehículos / Coleccionables (las guías viven en /guias)
import { useEffect, useId, useMemo, useState } from 'react';
import { SunsetBanner } from '../components/layout/ViceShell';
import { AdSlot } from '../components/ui/AdSlot';
import { BottomSheet } from '../components/ui/BottomSheet';
import { PalmButton } from '../components/ui/PalmButton';
import { StatBar, type StatAccent } from '../components/ui/StatBar';
import {
  SAMPLE_NOTICE,
  STAT_LABELS,
  entityHref,
  entitySlug,
  forumCategoryLabel,
  loreRefs,
  metaOf,
  statsOf,
  useEntityDetail,
  useForumData,
  useWorldData,
} from '../data/seed';
import { useAuthStore } from '../store/useAuthStore';
import { useProgressStore } from '../store/useProgressStore';
import { navigate, usePageMeta } from '../store/useRouteStore';
import type { Entity, ForumThread, MapMarker } from '../types/database';

type TabSlug = 'armas' | 'vehiculos' | 'coleccionables';

const TABS: ReadonlyArray<{ slug: TabSlug; label: string; heading: string; doneLabel: string }> = [
  { slug: 'armas', label: 'Armas', heading: 'ARMERÍA', doneLabel: 'Obtenida' },
  { slug: 'vehiculos', label: 'Vehículos', heading: 'GARAJE', doneLabel: 'Obtenido' },
  { slug: 'coleccionables', label: 'Coleccionables', heading: 'COLECCIONABLES', doneLabel: 'Completado' },
];

const normalizeText = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

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
  const gid = useId();
  const kind = String(meta.silueta ?? '');
  const isWeapon = kind in WEAPON_PATHS;
  return (
    <svg
      role="img"
      aria-label={`Silueta de ${entity.titulo}`}
      viewBox={isWeapon ? '0 0 200 100' : '0 0 240 100'}
      className={`text-[#F67E56] ${className}`}
      fill={`url(#${gid})`}
    >
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="200" y2="90">
          <stop offset="0" stopColor="#E1307E" />
          <stop offset="1" stopColor="#F69259" />
        </linearGradient>
      </defs>
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
    return <Silhouette entity={entity} className={className} />;
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

const MAX_COMPARE = 3;

const forumHref = (guest: boolean, path: string): string => (guest ? '/foro' : path);

function useIsDesktop(): boolean {
  const query = '(min-width: 768px)';
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

function MapPinIcon({ off = false }: { off?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

const ACTION =
  'flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl border border-white/20 px-2 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold';

interface DetailPanelProps {
  entity: Entity;
  tab: (typeof TABS)[number];
  done: boolean;
  onToggle: () => void;
  markers: MapMarker[];
  doneMarkers: number;
  threads: ForumThread[];
  compareTarget: Entity | undefined;
  guest: boolean;
  /** Muestra el título (se omite en el BottomSheet, que ya lo lleva en su cabecera). */
  heading: boolean;
  /** Escritorio: el cuerpo hace scroll interno y las acciones quedan siempre visibles. */
  pinned: boolean;
}

/** Ficha resumida del elemento seleccionado: aside en escritorio, BottomSheet en móvil. */
function DetailPanel({ entity, tab, done, onToggle, markers, doneMarkers, threads, compareTarget, guest, heading, pinned }: DetailPanelProps) {
  const meta = metaOf(entity);
  const stats = statsOf(entity);
  return (
    <div className={`flex flex-col gap-3 ${pinned ? "h-full min-h-0" : ""}`}>
      <div className={`flex flex-col gap-3 ${pinned ? "min-h-0 flex-1 overflow-y-auto pr-1" : ""}`}>
        <div>
          <span className="inline-block rounded-xl border border-vice-orange/50 bg-vice-orange/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-vice-gold">
            {entity.categoria}
          </span>
          {heading && <h2 className="mt-2 font-display text-2xl font-bold leading-tight">{entity.titulo}</h2>}
          {entity.subtitulo && <p className={`${heading ? '' : 'mt-2 '}text-sm text-vice-text/80`}>{entity.subtitulo}</p>}
        </div>

        {stats.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-vice-text/90">Estadísticas</h3>
            {stats.map((s, i) => (
              <StatBar key={s.key} label={s.label} value={s.value} valueLabel={s.display} accent={ACCENTS[i % ACCENTS.length]} />
            ))}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-white/5 p-3 text-sm">
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
              {doneMarkers}/{markers.length}
            </dd>
          </div>
        </dl>

        {threads.length > 0 && (
          <ul aria-label="Hilos relacionados" className="flex flex-col text-sm">
            {threads.slice(0, 2).map((t) => (
              <li key={t.id}>
                <a
                  href={forumHref(guest, `/foro?hilo=${t.id}`)}
                  className="block min-h-11 rounded-lg px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  <span className="text-xs text-vice-orange">
                    {forumCategoryLabel(t.categoria)} · ▲ {t.upvotes_count}
                  </span>
                  <span className="block font-semibold">{t.titulo}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-3">
        <button
          type="button"
          aria-pressed={done}
          onClick={onToggle}
          className={`min-h-11 whitespace-nowrap rounded-xl px-4 font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
            done ? 'bg-vice-gold text-vice-ink' : 'bg-white/10 hover:bg-white/20'
          }`}
        >
          {done ? `${tab.doneLabel} al 100% (quitar)` : `Marcar como ${tab.doneLabel.toLowerCase()}`}
        </button>

        {markers[0] ? (
          <PalmButton as="a" href={`/mapa?marker=${markers[0].id}`} fullWidth className="min-h-12! whitespace-nowrap text-base!">
            Ver en el mapa
          </PalmButton>
        ) : (
          <p className="flex items-center gap-2 text-sm text-vice-text/70">
            <MapPinIcon off />
            Sin ubicación en el mapa
          </p>
        )}

        <div className={`grid gap-2 ${compareTarget ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <a href={entityHref(entity, tab.slug)} aria-label={`Ver ficha completa de ${entity.titulo}`} className={ACTION}>
            Ver ficha
          </a>
          {compareTarget && (
            <a
              href={`/catalogo?comparar=${entitySlug(entity)},${entitySlug(compareTarget)}`}
              aria-label={`Comparar ${entity.titulo} con ${compareTarget.titulo}`}
              title={`Comparar con ${compareTarget.titulo}`}
              className={ACTION}
            >
              Comparar
            </a>
          )}
          <a
            href={forumHref(guest, `/foro?entity=${entity.id}`)}
            aria-label={`Discutir ${entity.titulo} en el foro (${threads.length} hilos)`}
            className={ACTION}
          >
            Discutir ({threads.length})
          </a>
        </div>
      </div>
    </div>
  );
}

const ZOOM_BTN =
  'glass flex h-11 w-11 items-center justify-center rounded-xl hover:brightness-110 focus-visible:outline-2 focus-visible:outline-vice-gold';

/** Visor del Inspector (escritorio): marco con zoom 0.8x-1.8x como `Inspector.dc.html`. */
function Viewer({ entity }: { entity: Entity }) {
  const [zoom, setZoom] = useState(1);
  const step = (d: number) => setZoom((z) => Math.min(1.8, Math.max(0.8, Math.round((z + d) * 10) / 10)));
  const credit = entity.imagen_url ? 'Artwork' : metaOf(entity).silueta ? 'Silueta vectorial ilustrativa' : '';
  return (
    <section aria-label="Visor" className="flex min-h-0 flex-col items-center gap-3">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div className="relative aspect-square h-full max-h-[460px] max-w-full overflow-hidden rounded-[28px] border border-vice-orange/35 bg-[linear-gradient(160deg,#4B2262,#1E1030)] shadow-[0_30px_60px_rgba(0,0,0,0.45),0_0_0_6px_rgba(246,126,86,0.14)]">
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-200 motion-reduce:transition-none"
            style={{ transform: `scale(${zoom})` }}
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(circle_at_50%_60%,rgba(225,48,126,0.35),transparent_65%)]"
            />
            <ItemVisual
              entity={entity}
              className={
                entity.imagen_url
                  ? 'absolute inset-0 h-full w-full'
                  : 'relative h-4/5 w-4/5 drop-shadow-[0_10px_30px_rgba(225,48,126,0.5)]'
              }
            />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" aria-label="Alejar" onClick={() => step(-0.2)} className={ZOOM_BTN}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M5 12h14" />
          </svg>
        </button>
        <span className="glass flex h-11 min-w-28 items-center justify-center gap-2 rounded-xl text-xs font-semibold tracking-widest">
          ZOOM <span className="text-vice-gold">x{zoom.toFixed(1)}</span>
        </span>
        <button type="button" aria-label="Acercar" onClick={() => step(0.2)} className={ZOOM_BTN}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button type="button" aria-label="Restablecer zoom" onClick={() => setZoom(1)} className={ZOOM_BTN}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12a8 8 0 108-8H8M8 4L4.5 7.5 8 11" />
          </svg>
        </button>
      </div>
      {credit && <p className="shrink-0 text-xs text-vice-text/80">{credit}</p>}
    </section>
  );
}

function CatalogInspector({ params }: { params: URLSearchParams }) {
  const { data, error } = useWorldData();
  const { data: forum } = useForumData();
  const items = useProgressStore((s) => s.items);
  const toggle = useProgressStore((s) => s.toggle);
  const guest = useAuthStore((s) => s.status !== 'authenticated');
  const isDesktop = useIsDesktop();

  const modulesById = useMemo(() => new Map(data.modules.map((m) => [m.id, m])), [data.modules]);
  const activeSlugs = useMemo(
    () => new Set(data.modules.filter((m) => m.activo).map((m) => m.slug)),
    [data.modules],
  );
  const tabs = TABS.filter((t) => activeSlugs.has(t.slug));

  const [tab, setTab] = useState<TabSlug>('armas');
  const [cat, setCat] = useState<string>('Todas');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Buscador por URL: /catalogo?q=texto (SearchAction de ssrLite). Filtra por titulo, subtitulo, categoria y alias.
  const qParam = params.get('q') ?? '';
  const [search, setSearch] = useState(qParam);
  const searchId = useId();
  // URL -> caja (navegación externa); caja -> URL con replaceState (sin apilar historial ni recargar la ruta).
  useEffect(() => setSearch(qParam), [qParam]);
  const onSearch = (value: string) => {
    setSearch(value);
    setSelectedId(null);
    try {
      const url = new URL(window.location.href);
      if (value.trim()) url.searchParams.set('q', value);
      else url.searchParams.delete('q');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* entorno sin History API: la caja sigue filtrando en memoria */
    }
  };
  const q = normalizeText(search);
  const matchesQuery = (e: Entity): boolean => {
    if (!q) return true;
    const alias = metaOf(e).alias;
    const aliases = Array.isArray(alias) ? alias.map(String) : alias ? [String(alias)] : [];
    return [e.titulo, e.subtitulo ?? '', e.categoria, ...aliases].some((f) => normalizeText(f).includes(q));
  };
  const inTab = (slug: string) => data.entities.filter((e) => modulesById.get(e.module_id)?.slug === slug && matchesQuery(e));
  const tabEntities = inTab(tab);
  const categories = ['Todas', ...Array.from(new Set(tabEntities.map((e) => e.categoria)))];
  const list = cat === 'Todas' ? tabEntities : tabEntities.filter((e) => e.categoria === cat);
  const qTab = q && tabEntities.length === 0 ? tabs.find((t) => inTab(t.slug).length > 0)?.slug : undefined;
  useEffect(() => {
    if (qTab) {
      setTab(qTab);
      setCat('Todas');
    }
  }, [qTab]);
  const selected = list.find((e) => e.id === selectedId) ?? list[0] ?? null;
  const tabDef = TABS.find((t) => t.slug === tab) ?? TABS[0]!;
  const compareTarget = selected
    ? data.entities.find((e) => e.module_id === selected.module_id && e.id !== selected.id)
    : undefined;

  // Redirección heredada: /catalogo?entity=<uuid> -> /catalogo/:modulo/:slug (replaceState).
  const entityParam = params.get('entity');
  useEffect(() => {
    if (!entityParam) return;
    const e = data.entities.find((x) => x.id === entityParam);
    const modSlug = e ? modulesById.get(e.module_id)?.slug : undefined;
    if (e && modSlug) navigate(entityHref(e, modSlug), { replace: true });
  }, [entityParam, data.entities, modulesById]);

  // Comparador por URL: /catalogo?comparar=slugA,slugB[,slugC] (2-3 entidades del mismo módulo).
  const compareParam = params.get('comparar');
  const compare = useMemo(() => {
    if (compareParam === null) return null;
    const slugs = [...new Set(compareParam.split(',').filter(Boolean))];
    const found = slugs
      .map((s) => data.entities.find((e) => entitySlug(e) === s))
      .filter((e): e is Entity => e !== undefined);
    const moduleId = found[0]?.module_id;
    const entities = found.filter((e) => e.module_id === moduleId).slice(0, MAX_COMPARE);
    return { entities, discarded: slugs.length - entities.length, moduleId };
  }, [compareParam, data.entities]);
  const setCompareSlugs = (slugs: string[]) =>
    navigate(`/catalogo?comparar=${slugs.join(',')}`, { replace: true, keepScroll: true });
  const closeCompare = () => navigate('/catalogo', { replace: true, keepScroll: true });

  // /catalogo?modulo=<Module.slug> abre esa pestaña; slug desconocido, inactivo o 'guias' -> primera disponible.
  const moduloParam = params.get('modulo');
  useEffect(() => {
    if (moduloParam === null) return;
    const wanted = TABS.find((t) => t.slug === moduloParam && activeSlugs.has(t.slug)) ?? TABS.find((t) => activeSlugs.has(t.slug));
    if (!wanted) return;
    setTab(wanted.slug);
    setCat('Todas');
    setSelectedId(null);
  }, [moduloParam, activeSlugs]);

  // Si el módulo activo se desactiva, saltar al primer tab disponible.
  useEffect(() => {
    const first = tabs[0];
    if (first && !tabs.some((t) => t.slug === tab)) setTab(first.slug);
  }, [tabs, tab]);

  const linkedMarkers = selected ? data.markers.filter((m) => m.entity_id === selected.id) : [];
  const threads = selected
    ? forum.threads.filter(
        (t) => t.entity_id === selected.id || linkedMarkers.some((m) => m.id === t.marker_id),
      )
    : [];
  const done = (e: Entity): boolean => items[`entity:${e.id}`]?.completado === true;

  const detail = selected && (
    <DetailPanel
      entity={selected}
      tab={tabDef}
      done={done(selected)}
      onToggle={() => toggle({ entityId: selected.id })}
      markers={linkedMarkers}
      doneMarkers={linkedMarkers.filter((m) => items[`marker:${m.id}`]?.completado).length}
      threads={threads}
      compareTarget={compareTarget}
      guest={guest}
      heading={isDesktop}
      pinned={isDesktop}
    />
  );

  const notice = error
    ? data.source === 'seed'
      ? 'No se pudo conectar con el servidor: se muestran datos de ejemplo.'
      : 'No se pudo actualizar desde el servidor.'
    : data.source === 'seed'
      ? SAMPLE_NOTICE
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-3 pt-1 md:px-8">
      {/* Cabecera y pestañas */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="font-display text-xl font-bold uppercase tracking-wide text-vice-gold md:text-2xl">
          {tabDef.heading}
          {cat !== 'Todas' && <span className="text-vice-orange"> // {cat}</span>}
        </h1>
        <div role="tablist" aria-label="Categorías del catálogo" className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              className={`min-h-11 whitespace-nowrap rounded-full border border-vice-orange/30 px-5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                tab === t.slug ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/15'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="search" className="relative">
        <label htmlFor={searchId} className="sr-only">
          Buscar en el catálogo
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(ev) => onSearch(ev.target.value)}
          placeholder="Buscar por nombre, categoría o alias"
          autoComplete="off"
          className="h-11 w-full rounded-full border border-vice-orange/25 bg-[rgba(20,14,36,0.78)] px-4 text-sm text-vice-text backdrop-blur-[14px] placeholder:text-vice-text/60 focus-visible:outline-2 focus-visible:outline-vice-gold md:h-10 md:max-w-sm"
        />
      </div>

      {categories.length > 2 && (
        <div role="group" aria-label="Filtrar por categoría" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cat === c}
              onClick={() => {
                setCat(c);
                setSelectedId(null);
              }}
              className={`min-h-11 whitespace-nowrap rounded-full border px-4 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold md:min-h-9 ${
                cat === c ? 'border-vice-orange bg-white/15' : 'border-white/15 hover:bg-white/10'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(260px,360px)_minmax(0,1fr)_minmax(300px,360px)] md:grid-rows-[minmax(0,1fr)] md:gap-5">
        {/* Rejilla de selección */}
        <section aria-label="Selección" className="glass flex min-h-0 flex-1 flex-col rounded-2xl p-3 md:p-4">
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-vice-text/90">{tabDef.label}</h2>
            <span className="text-xs text-vice-text/80">{list.length} en total</span>
          </div>
          {list.length === 0 ? (
            <p className="p-4 text-vice-text/70">No hay elementos para mostrar.</p>
          ) : (
            <ul className="grid min-h-0 flex-1 grid-cols-3 content-start gap-x-2.5 gap-y-3 overflow-y-auto pb-1">
              {list.map((e) => {
                const sel = selected?.id === e.id;
                return (
                  <li key={e.id} className="min-w-0">
                    <button
                      type="button"
                      aria-pressed={sel}
                      aria-label={`${e.titulo}${done(e) ? ', completado' : ''}`}
                      title={e.titulo}
                      onClick={() => {
                        setSelectedId(e.id);
                        setSheetOpen(true);
                      }}
                      className="flex w-full flex-col gap-1.5 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-vice-gold"
                    >
                      <span
                        className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[14px] bg-[linear-gradient(160deg,#3A1E55,#1E1030)] ${
                          sel
                            ? 'border-2 border-vice-orange shadow-[0_0_0_4px_rgba(246,126,86,0.3)]'
                            : 'border border-vice-orange/30'
                        }`}
                      >
                        <ItemVisual
                          entity={e}
                          className={e.imagen_url ? 'absolute inset-0 h-full w-full' : 'h-3/5 w-4/5'}
                        />
                        {done(e) && (
                          <span
                            aria-hidden="true"
                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-vice-gold text-xs font-bold text-vice-ink"
                          >
                            ✓
                          </span>
                        )}
                      </span>
                      <span className="line-clamp-2 px-0.5 text-[11px] font-semibold leading-tight">{e.titulo}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {isDesktop &&
          (selected ? (
            <>
              <Viewer key={selected.id} entity={selected} />
              <aside aria-label="Detalle" className="glass min-h-0 rounded-2xl p-5">
                {detail}
              </aside>
            </>
          ) : (
            <p className="col-span-2 self-center text-center text-vice-text/70">Sin elementos en esta categoría.</p>
          ))}
      </div>

      {notice && (
        <p role="status" className="shrink-0 pb-1 text-[11px] text-vice-text/60">
          {notice}
        </p>
      )}

      <BottomSheet
        open={sheetOpen && !isDesktop && selected !== null && compare === null}
        onClose={() => setSheetOpen(false)}
        title={selected?.titulo}
      >
        {detail}
      </BottomSheet>

      <BottomSheet
        open={compare !== null}
        onClose={closeCompare}
        title="Comparador"
        closeLabel="Cerrar comparador"
        className="md:w-[min(92vw,760px)]!"
      >
        {compare && (
          <ComparePanel
            entities={compare.entities}
            discarded={compare.discarded}
            candidates={data.entities.filter((e) => e.module_id === compare.moduleId)}
            onChange={setCompareSlugs}
          />
        )}
      </BottomSheet>
    </div>
  );
}

// ---- Comparador NUI: StatBar de 2-3 entidades del mismo módulo, lado a lado ---------------
function ComparePanel({
  entities,
  discarded,
  candidates,
  onChange,
}: {
  entities: Entity[];
  discarded: number;
  candidates: Entity[];
  onChange: (slugs: string[]) => void;
}) {
  const statMaps = entities.map((e) => new Map(statsOf(e).map((s) => [s.key, s.value] as const)));
  const keys: string[] = [];
  for (const m of statMaps) for (const k of m.keys()) if (!keys.includes(k)) keys.push(k);
  const cols = entities.length;
  const slugs = entities.map(entitySlug);
  const replaceAt = (i: number, slug: string) => onChange(slugs.map((s, j) => (j === i ? slug : s)));
  const free = candidates.filter((c) => !slugs.includes(entitySlug(c)));
  const SELECT =
    'min-h-11 w-full rounded-lg border border-white/20 bg-[#1a0a22] px-2 text-xs focus-visible:outline-2 focus-visible:outline-vice-gold';
  if (entities.length < 2) {
    return (
      <div className="pt-2">
        <p role="status" className="text-sm">
          No se puede comparar: indica al menos 2 elementos válidos del mismo módulo (por ejemplo, desde la ficha o el Inspector).
        </p>
        <a href="/catalogo" className="mt-3 inline-flex min-h-11 items-center font-semibold text-vice-orange underline">
          Volver al catálogo
        </a>
      </div>
    );
  }
  return (
    <div className="pt-2">
      <p className="text-xs text-vice-text/70">La mejor cifra de cada fila se resalta. Las no comparables muestran —.</p>
      {discarded > 0 && (
        <p role="status" className="mt-1 text-xs text-vice-orange">
          {discarded === 1 ? 'Se omitió 1 elemento' : `Se omitieron ${discarded} elementos`} no válidos o de otro módulo.
        </p>
      )}
      <div
        role="table"
        aria-label="Comparación de estadísticas"
        className="mt-3 flex flex-col gap-4"
      >
        <div role="row" className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {entities.map((e) => (
            <div role="columnheader" key={e.id} className="min-w-0">
              <div className="h-20 overflow-hidden rounded-xl bg-white/5">
                <ItemVisual entity={e} className={e.imagen_url ? 'h-full w-full' : 'h-full w-full p-2'} />
              </div>
              <p className="mt-1 truncate font-display text-sm font-bold">{e.titulo}</p>
              <select
                aria-label={`Cambiar ${e.titulo}`}
                value={entitySlug(e)}
                onChange={(ev) => replaceAt(entities.indexOf(e), ev.target.value)}
                className={`${SELECT} mt-1`}
              >
                {[e, ...free].map((c) => (
                  <option key={c.id} value={entitySlug(c)}>
                    {c.titulo}
                  </option>
                ))}
              </select>
              {entities.length > 2 && (
                <button
                  type="button"
                  onClick={() => onChange(slugs.filter((s) => s !== entitySlug(e)))}
                  className="mt-1 min-h-11 w-full rounded-lg border border-white/20 px-2 text-xs font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  Quitar
                </button>
              )}
            </div>
          ))}
        </div>
        {keys.map((k) => {
          const values = statMaps.map((m) => m.get(k));
          const best = Math.max(...values.filter((v): v is number => typeof v === 'number'));
          const label = STAT_LABELS[k] ?? k;
          return (
            <div role="row" key={k} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {entities.map((e, i) => {
                const v = values[i];
                return (
                  <div role="cell" key={e.id} className="min-w-0">
                    {typeof v === 'number' ? (
                      <StatBar
                        label={label}
                        value={v}
                        valueLabel={v === best && values.filter((x) => x === best).length < cols ? `${v} · mejor` : String(v)}
                        accent={v === best ? 'magenta' : 'cyan'}
                      />
                    ) : (
                      <div className="text-[11px]">
                        <span>{label}</span>
                        <span className="float-right font-semibold" aria-label="no comparable">
                          —
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {entities.length < MAX_COMPARE && free.length > 0 && (
        <label className="mt-4 block text-xs font-semibold">
          Añadir un tercer elemento
          <select
            value=""
            onChange={(ev) => ev.target.value && onChange([...slugs, ev.target.value])}
            className={`${SELECT} mt-1`}
          >
            <option value="">Elegir…</option>
            {free.map((c) => (
              <option key={c.id} value={entitySlug(c)}>
                {c.titulo}
              </option>
            ))}
          </select>
        </label>
      )}
      {keys.length === 0 && <p className="mt-3 text-sm text-vice-text/70">Estas entidades no tienen estadísticas comparables.</p>}
    </div>
  );
}

// ---- Ficha de entidad: /catalogo/:modulo/:slug (página editorial con scroll) --------------------
const metaDescription = (e: Entity): string => {
  const base = `${e.titulo}${e.subtitulo ? `: ${e.subtitulo}` : ''}. Estadísticas, ubicación en el mapa y hilos de la comunidad en LeonidApp.`;
  return base.length > 160 ? `${base.slice(0, 157)}...` : base;
};

function EntityDetail({ modulo, slug }: { modulo: string; slug: string }) {
  const { entity, loading } = useEntityDetail(modulo, slug);
  const { data } = useWorldData();
  const { data: forum } = useForumData();
  const guest = useAuthStore((s) => s.status !== 'authenticated');
  const items = useProgressStore((s) => s.items);
  const toggle = useProgressStore((s) => s.toggle);

  const moduleDef = data.modules.find((m) => m.slug === modulo);
  const tabDef = TABS.find((t) => t.slug === modulo);

  usePageMeta(
    entity
      ? { title: entity.titulo, description: metaDescription(entity), canonicalPath: `/catalogo/${modulo}/${slug}` }
      : { title: loading ? 'Cargando ficha' : 'Ficha no encontrada', robots: 'noindex,nofollow' },
  );

  // Las guías viven en /guias/:slug.
  useEffect(() => {
    if (modulo === 'guias') navigate(`/guias/${slug}`, { replace: true });
  }, [modulo, slug]);

  if (!entity) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4">
        <p role="status" className="glass rounded-2xl p-6 text-center">
          {loading ? 'Cargando ficha…' : 'No encontramos esta ficha.'}{' '}
          <a href="/catalogo" className="font-semibold text-vice-orange underline">
            Volver al catálogo
          </a>
        </p>
      </div>
    );
  }

  const meta = metaOf(entity);
  const stats = statsOf(entity);
  const trackable = modulo !== 'guias';
  const done = items[`entity:${entity.id}`]?.completado === true;
  const markers = data.markers.filter((m) => m.entity_id === entity.id);
  const threads = forum.threads
    .filter((t) => t.entity_id === entity.id || markers.some((m) => m.id === t.marker_id))
    .slice(0, 5);
  const guidesModule = data.modules.find((m) => m.slug === 'guias');
  const guides = data.entities.filter(
    (g) =>
      g.module_id === guidesModule?.id &&
      g.id !== entity.id &&
      (loreRefs(g).includes(entity.id) || loreRefs(g).some((r) => markers.some((m) => m.id === r))),
  );
  const similar = data.entities
    .filter((e) => e.module_id === entity.module_id && e.id !== entity.id)
    .slice(0, 3);

  const LINK =
    'flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold';

  return (
    <article className="mx-auto w-full max-w-4xl px-4 pb-10 pt-2 md:px-8">
      <nav aria-label="Migas de pan" className="text-xs text-vice-text/80">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <a href="/catalogo" className="inline-flex min-h-11 items-center underline">
              Catálogo
            </a>
          </li>
          <li aria-hidden="true">›</li>
          <li>{moduleDef?.nombre ?? tabDef?.label ?? modulo}</li>
          <li aria-hidden="true">›</li>
          <li aria-current="page">{entity.titulo}</li>
        </ol>
      </nav>

      <header className="mt-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{entity.categoria}</p>
        <h1 className="font-display text-3xl font-bold">{entity.titulo}</h1>
        {entity.subtitulo && <p className="text-vice-text/85">{entity.subtitulo}</p>}
      </header>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <section aria-label="Imagen" className="glass relative flex h-56 items-center justify-center overflow-hidden rounded-2xl md:h-72">
          <ItemVisual
            entity={entity}
            className={entity.imagen_url ? 'absolute inset-0 h-full w-full' : 'relative h-4/5 w-4/5 drop-shadow-[0_10px_30px_rgba(225,48,126,0.5)]'}
          />
        </section>

        <section aria-label="Estadísticas" className="glass flex flex-col gap-3 rounded-2xl p-5">
          {stats.length > 0 ? (
            stats.map((s, i) => <StatBar key={s.key} label={s.label} value={s.value} valueLabel={s.display} accent={ACCENTS[i % ACCENTS.length]} />)
          ) : (
            <p className="text-sm text-vice-text/70">Sin estadísticas numéricas.</p>
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
          </dl>
          {trackable && (
            <button
              type="button"
              aria-pressed={done}
              onClick={() => toggle({ entityId: entity.id })}
              className={`min-h-11 rounded-xl px-4 font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                done ? 'bg-vice-gold text-vice-ink' : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              {done ? `${tabDef?.doneLabel ?? 'Completado'} al 100% (quitar)` : `Marcar como ${(tabDef?.doneLabel ?? 'completado').toLowerCase()}`}
            </button>
          )}
        </section>
      </div>

      {/* Enlazado cruzado: Mapa, Foro, Guías */}
      <section aria-labelledby="rel-title" className="mt-6">
        <h2 id="rel-title" className="font-display text-xl font-bold">
          Relacionado
        </h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {markers[0] ? (
            <a href={`/mapa?marker=${markers[0].id}`} className={`${LINK} bg-vice-accent text-vice-ink`}>
              Ver en el mapa{markers.length > 1 ? ` (${markers.length} puntos)` : ''}
            </a>
          ) : (
            <p className="flex min-h-11 items-center gap-2 px-1 text-sm text-vice-text/70">
              <MapPinIcon off />
              Sin ubicación en el mapa
            </p>
          )}
          <a href={forumHref(guest, `/foro?entity=${entity.id}`)} className={LINK}>
            Abrir hilo sobre {entity.titulo}
          </a>
        </div>
        {threads.length > 0 && (
          <div className="mt-3">
            <h3 className="font-display text-base font-bold">Hilos relacionados</h3>
            <ul className="mt-1 flex flex-col text-sm">
              {threads.map((t) => (
                <li key={t.id}>
                  <a href={forumHref(guest, `/foro?hilo=${t.id}`)} className="block min-h-11 rounded-lg px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold">
                    <span className="text-xs text-vice-orange">{forumCategoryLabel(t.categoria)} · ▲ {t.upvotes_count}</span>
                    <span className="block font-semibold">{t.titulo}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {guides.length > 0 && (
          <div className="mt-3">
            <h3 className="font-display text-base font-bold">Guías que la mencionan</h3>
            <ul className="mt-1 flex flex-col text-sm">
              {guides.map((g) => (
                <li key={g.id}>
                  <a href={`/guias/${entitySlug(g)}`} className="flex min-h-11 items-center rounded-lg px-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold">
                    {g.titulo}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {trackable && similar.length > 0 && (
          <div className="mt-3">
            <h3 className="font-display text-base font-bold">Comparar con otras de {moduleDef?.nombre ?? tabDef?.label ?? modulo}</h3>
            <ul className="mt-1 flex flex-wrap gap-2 text-sm">
              {similar.map((s) => (
                <li key={s.id}>
                  <a
                    href={`/catalogo?comparar=${entitySlug(entity)},${entitySlug(s)}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                  >
                    Comparar con {s.titulo}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <AdSlot position="after-content" className="mt-8" />
      {data.source === 'seed' && <p className="mt-4 text-[11px] text-vice-text/60">{SAMPLE_NOTICE}</p>}
    </article>
  );
}

export default function CatalogPage({
  params,
  detail,
}: {
  params: URLSearchParams;
  /** Si se define, muestra la ficha /catalogo/:modulo/:slug en vez del Inspector. */
  detail?: { modulo: string; slug: string };
}) {
  return detail ? <EntityDetail modulo={detail.modulo} slug={detail.slug} /> : <CatalogInspector params={params} />;
}
