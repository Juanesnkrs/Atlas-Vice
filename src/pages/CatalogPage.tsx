// P05 - Inspector NUI: Armas / Vehículos / Coleccionables (las guías viven en /guias).
// Rutas (sincronizadas con la URL; sin estado local de navegación):
//   /catalogo                        -> replaceState a /catalogo/armas (primera pestaña activa si no existe)
//   /catalogo/:categoria             -> Inspector con esa categoría (Module.slug activo)
//   /catalogo/:categoria/:itemSlug   -> Inspector con el ítem preseleccionado (sheet móvil abierto)
//   ...?vista=ficha                  -> ficha completa del ítem (misma URL canónica)
//   ?comparar=a,b[,c]  comparador sobre la URL vigente · ?q= búsqueda · ?modulo= / ?entity= heredados
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { AdSlot } from '../components/ui/AdSlot';
import { ApiErrorState } from '../components/ui/ApiErrorState';
import { BottomSheet } from '../components/ui/BottomSheet';
import {
  DescriptionBlock,
  EntityDetailPanel,
  MapPinIcon,
  ProvisionalChip,
  STAT_ACCENTS,
  SpecSheet,
  compareSlugs,
  forumHref,
} from '../components/ui/EntityDetailPanel';
import { PalmButton } from '../components/ui/PalmButton';
import { StatBar } from '../components/ui/StatBar';
import {
  STAT_LABELS,
  descriptionOf,
  seoDescription,
  entitySlug,
  forumCategoryLabel,
  imageAttrs,
  loreRefs,
  mediaSrc,
  metaOf,
  statsOf,
  subtitleOf,
  useEntityDetail,
  useForumData,
  useWorldData,
  type WorldScope,
} from '../data/seed';
import { useAuthStore } from '../store/useAuthStore';
import { useProgressStore } from '../store/useProgressStore';
import {
  OVERLAY_STATE_KEY,
  closeOverlay,
  navigate,
  useLocation,
  usePageMeta,
  type PageMeta,
} from '../store/useRouteStore';
import type { Entity } from '../types/database';

type TabSlug = string;
interface TabDef {
  slug: TabSlug;
  label: string;
  doneLabel: string;
}

/** Etiqueta de «hecho» por categoría conocida; las demás usan «Completado». */
const DONE_LABELS: Readonly<Record<string, string>> = { armas: 'Obtenida', vehiculos: 'Obtenido', coleccionables: 'Completado' };
/** Módulos con pantalla propia (no son pestañas del catálogo). */
const NON_CATALOG: ReadonlySet<string> = new Set(['mapa', 'foro', 'guias']);
/** Respaldo de rótulo mientras no hay módulos cargados (p. ej. una URL de ficha antes de que responda la API). */
const FALLBACK_TAB: TabDef = { slug: 'armas', label: 'Catálogo', doneLabel: 'Completado' };
/** Fichas por tramo de «Cargar más» (S4.1). */
const PAGE_SIZE = 24;
/** Tramo cargado por (categoría, subcategoría, búsqueda): sobrevive a abrir una ficha y volver. */
const loadedMemo = new Map<string, number>();

const normalizeText = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Query string con valores codificados pero comas literales (contrato `?comparar=a,b`). */
const buildQuery = (parts: Record<string, string | undefined>): string => {
  const q = Object.entries(parts)
    .filter((e): e is [string, string] => e[1] !== undefined && e[1] !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/gi, ',')}`)
    .join('&');
  return q ? `?${q}` : '';
};

const truncate = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 3)}...` : t);
const absoluteUrl = (u: string): string => new URL(u, window.location.origin).href;

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

/** Icono limpio por categoria para las fichas que aun no tienen imagen ni silueta propia. */
function CategoryGlyph({ kind, className = '' }: { kind?: string; className?: string }) {
  const gid = useId();
  const wide = kind === 'vehiculos';
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={wide ? '0 0 240 100' : '0 0 100 100'}
      className={`text-[#F67E56] opacity-60 ${className}`}
      fill={`url(#${gid})`}
    >
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">
          <stop offset="0" stopColor="#E1307E" />
          <stop offset="1" stopColor="#F69259" />
        </linearGradient>
      </defs>
      {kind === 'armas' ? (
        <>
          <circle cx="50" cy="50" r="28" fill="none" stroke={`url(#${gid})`} strokeWidth="7" />
          <path d="M47 6h6v26h-6zM47 68h6v26h-6zM6 47h26v6H6zM68 47h26v6H68z" />
          <circle cx="50" cy="50" r="5" />
        </>
      ) : wide ? (
        <VehiclePaths kind="sedan" />
      ) : kind === 'coleccionables' ? (
        <path d="M50 8 L61 38 L93 40 L68 60 L77 92 L50 74 L23 92 L32 60 L7 40 L39 38 Z" />
      ) : (
        <path d="M50 10 L90 50 L50 90 L10 50 Z" />
      )}
    </svg>
  );
}

type Variant = 'thumb' | 'full';
const SIZES: Record<Variant, string> = {
  thumb: '(min-width: 1280px) 200px, (min-width: 768px) 25vw, 45vw',
  full: '(min-width: 768px) 50vw, 100vw',
};

function Artwork({
  src,
  alt,
  kind,
  className,
  variant = 'thumb',
}: {
  src: string | null;
  alt: string;
  kind?: string;
  className?: string;
  variant?: Variant;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <CategoryGlyph kind={kind} className={className} />;
  return (
    <img
      {...imageAttrs(src, variant, SIZES[variant])}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(src)}
    />
  );
}

/** Imagen de un ítem: artwork real, silueta SVG (armas/vehículos) o banner sunset. Listados: variante 800; ficha/visor: principal. */
function ItemVisual({ entity, kind, className = '', variant = 'thumb' }: { entity: Entity; kind?: string; className?: string; variant?: Variant }) {
  if (entity.imagen_url) {
    // Las tarjetas provisionales del pipeline (/media/…, capturaPropiaPendiente) son 16:9 de terceros: se muestran completas.
    // Las imágenes propias (Estudio de Imágenes) ya son 16:9 limpias y rellenan el marco (cover).
    const fit = entity.imagen_url.startsWith('/media/') && entity.capturaPropiaPendiente === true ? 'object-contain' : 'object-cover';
    return <Artwork src={entity.imagen_url} alt={entity.titulo} kind={kind} variant={variant} className={`${fit} ${className}`} />;
  }
  if (metaOf(entity).silueta) {
    return <Silhouette entity={entity} className={className} />;
  }
  return <CategoryGlyph kind={kind} className={className} />;
}

const MAX_COMPARE = 3;

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

const ZOOM_BTN =
  'glass flex h-11 w-11 items-center justify-center rounded-xl hover:brightness-110 focus-visible:outline-2 focus-visible:outline-vice-gold';

/** Visor del Inspector (escritorio): marco con zoom 0.8x-1.8x como `Inspector.dc.html`. */
function Viewer({ entity, kind }: { entity: Entity; kind?: string }) {
  const [zoom, setZoom] = useState(1);
  const step = (d: number) => setZoom((z) => Math.min(1.8, Math.max(0.8, Math.round((z + d) * 10) / 10)));
  const credit = entity.imagen_url ? 'Artwork' : metaOf(entity).silueta ? 'Silueta vectorial ilustrativa' : '';
  return (
    <section aria-label="Visor" className="hidden min-h-0 flex-col items-center gap-3 xl:flex">
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
              kind={kind}
              variant="full"
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

/** Estado vacío de página completa (categoría inexistente). */
function CatalogNotFound({ title, text, href, label }: { title: string; text: string; href: string; label: string }) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center p-6">
      <section className="glass max-w-md rounded-2xl p-8 text-center" aria-labelledby="cat-nf-title" role="status">
        <h1 id="cat-nf-title" className="font-display text-2xl font-bold">
          {title}
        </h1>
        <p className="mt-3 text-vice-text/85">{text}</p>
        <div className="mt-6 flex justify-center">
          <PalmButton as="a" href={href}>
            {label}
          </PalmButton>
        </div>
      </section>
    </div>
  );
}

/**
 * Fila de chips de una sola linea que se recorre de forma evidente en escritorio y tableta (>= 768 px):
 * flechas a los lados (solo si hay mas contenido en esa direccion), borde difuminado, arrastre con el raton y la
 * rueda del raton recorre la fila. En movil los chips van en un bloque que se despliega con el boton «Filtros».
 */
function ChipScroller({
  id,
  label,
  mobileOpen,
  itemsKey,
  activeKey,
  children,
}: {
  id: string;
  label: string;
  mobileOpen: boolean;
  /** Cambia cuando cambia el conjunto de chips (recalcula flechas y difuminado). */
  itemsKey: string;
  /** Chip activo: al cambiar, se desplaza para quedar a la vista. */
  activeKey: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const drag = useRef({ down: false, moved: false, startX: 0, startLeft: 0 });

  const update = (): void => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useLayoutEffect(() => {
    update();
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (ev: WheelEvent): void => {
      // La rueda vertical recorre la fila mientras haya donde ir; al llegar al borde la pagina vuelve a hacer scroll.
      if (el.scrollWidth <= el.clientWidth + 2 || Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
      const atStart = el.scrollLeft <= 0 && ev.deltaY < 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && ev.deltaY > 0;
      if (atStart || atEnd) return;
      ev.preventDefault();
      el.scrollLeft += ev.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  // El chip activo siempre queda a la vista (p. ej. tras elegir una categoria lejana o al cambiar de pestana).
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeKey, itemsKey]);

  const page = (dir: 1 | -1): void => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  };
  const fade = (l: boolean, r: boolean): string | undefined =>
    l || r ? `linear-gradient(to right, ${l ? 'transparent 0, #000 48px' : '#000 0'}, ${r ? '#000 calc(100% - 48px), transparent 100%' : '#000 100%'})` : undefined;
  const arrow =
    'glass absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-vice-text hover:brightness-125 focus-visible:outline-2 focus-visible:outline-vice-gold md:flex';

  return (
    <div className="relative md:min-w-0">
      {canLeft && (
        <button type="button" aria-label="Ver categorías anteriores" onClick={() => page(-1)} className={`${arrow} left-0`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      )}
      <div
        id={id}
        ref={ref}
        role="group"
        aria-label={label}
        onScroll={update}
        onPointerDown={(ev) => {
          if (ev.pointerType !== 'mouse' || ev.button !== 0 || !ref.current) return;
          drag.current = { down: true, moved: false, startX: ev.clientX, startLeft: ref.current.scrollLeft };
        }}
        onPointerMove={(ev) => {
          const d = drag.current;
          const el = ref.current;
          if (!d.down || !el) return;
          const dx = ev.clientX - d.startX;
          if (!d.moved && Math.abs(dx) > 4) {
            d.moved = true;
            el.setPointerCapture(ev.pointerId);
          }
          if (d.moved) el.scrollLeft = d.startLeft - dx;
        }}
        onPointerUp={() => {
          drag.current.down = false;
        }}
        onPointerCancel={() => {
          drag.current.down = false;
        }}
        // Si hubo arrastre, el clic que sigue al soltar no debe activar un chip.
        onClickCapture={(ev) => {
          if (drag.current.moved) {
            ev.preventDefault();
            ev.stopPropagation();
            drag.current.moved = false;
          }
        }}
        style={{ maskImage: fade(canLeft, canRight), WebkitMaskImage: fade(canLeft, canRight) }}
        className={`scrollbar-none ${mobileOpen ? 'flex flex-wrap' : 'hidden'} gap-1 md:flex md:flex-nowrap md:cursor-grab md:overflow-x-auto md:overscroll-x-contain md:select-none md:active:cursor-grabbing`}
      >
        {children}
      </div>
      {canRight && (
        <button type="button" aria-label="Ver más categorías" onClick={() => page(1)} className={`${arrow} right-0`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

interface CatalogInspectorProps {
  params: URLSearchParams;
  /** `Module.slug` de la URL (`/catalogo/:categoria`); undefined en `/catalogo`. */
  categoria: string | undefined;
  /** `Entity.slug` de la URL (`/catalogo/:categoria/:itemSlug`). */
  itemSlug: string | undefined;
}

/** Guías (para «Guías que la mencionan» en la ficha): solo el módulo `guias`, sin marcadores. */
const GUIDES_ONLY: WorldScope = { entities: ['guias'], markers: false };

function CatalogInspector({ params, categoria: categoriaRaw, itemSlug }: CatalogInspectorProps) {
  const { path } = useLocation();
  // Las categorías son slugs en minúsculas: /catalogo/ARMAS se normaliza con replaceState.
  const categoria = categoriaRaw?.toLowerCase();
  // /catalogo/mapa no es una categoría del catálogo: el mapa vive en /mapa (?pin=<slug> para un pin concreto).
  const mapRedirect =
    categoria === 'mapa' ? (itemSlug ? `/mapa?pin=${encodeURIComponent(itemSlug)}` : '/mapa') : null;
  useEffect(() => {
    if (mapRedirect) navigate(mapRedirect, { replace: true });
    else if (categoriaRaw !== undefined && categoriaRaw !== categoria) {
      navigate(`/catalogo/${categoria}${itemSlug ? `/${itemSlug}` : ''}${window.location.search}`, { replace: true, keepScroll: true });
    }
  }, [mapRedirect, categoriaRaw, categoria, itemSlug]);

  // Solo se piden las fichas del módulo activo (el catálogo completo solo para enlaces heredados ?comparar= / ?entity=).
  const legacyAll = !categoria && (params.get('comparar') !== null || params.get('entity') !== null);
  const scopeSlug = categoria ?? params.get('modulo') ?? 'armas';
  const {
    data,
    error,
    unavailable,
    loading: worldLoading,
    retry,
  } = useWorldData({
    entities: legacyAll ? 'all' : mapRedirect || categoria === 'guias' ? [] : [scopeSlug],
    markers: true,
  });
  const { data: forum } = useForumData();
  const items = useProgressStore((s) => s.items);
  const toggle = useProgressStore((s) => s.toggle);
  const guest = useAuthStore((s) => s.status !== 'authenticated');
  const isDesktop = useIsDesktop();

  const modulesById = useMemo(() => new Map(data.modules.map((m) => [m.id, m])), [data.modules]);
  // Pestañas derivadas de GET /api/modules: solo módulos activos de catálogo con fichas (sin pestañas vacías).
  const tabs = useMemo<TabDef[]>(
    () =>
      data.modules
        .filter((m) => m.activo && !NON_CATALOG.has(m.slug) && (data.counts[m.slug] ?? 1) > 0)
        .slice()
        .sort((a, b) => a.orden - b.orden)
        .map((m) => ({ slug: m.slug, label: m.nombre, doneLabel: DONE_LABELS[m.slug] ?? 'Completado' })),
    [data.modules, data.counts],
  );
  const loaded = data.modules.length > 0;
  const defaultTab = tabs[0];

  const [cat, setCat] = useState<string>('Todas');
  // Movil: los chips de subcategoria van tras un boton «Filtros».
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Buscador por URL: ?q=texto (SearchAction de ssrLite). Filtra por titulo, subtitulo, categoria y alias.
  const qParam = params.get('q') ?? '';
  const [search, setSearch] = useState(qParam);
  const searchId = useId();
  // URL -> caja (navegación externa); caja -> URL con replaceState (sin apilar historial ni recargar la ruta).
  useEffect(() => setSearch(qParam), [qParam]);
  const onSearch = (value: string) => {
    loadedMemo.delete(`${tab ?? ''}|${cat}|${normalizeText(value)}`);
    setSearch(value);
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
  const qValue = search.trim() ? search : undefined;
  const matchesQuery = (e: Entity): boolean => {
    if (!q) return true;
    const alias = metaOf(e).alias;
    const aliases = Array.isArray(alias) ? alias.map(String) : alias ? [String(alias)] : [];
    return [e.titulo, e.subtitulo ?? '', e.categoria, ...aliases].some((f) => normalizeText(f).includes(q));
  };

  // Comparador por URL: ?comparar=slugA,slugB[,slugC] (2-3 entidades del mismo módulo), sobre la URL vigente.
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

  // Categoría activa: la de la URL; en /catalogo (p. ej. ?comparar=) la del módulo comparado o la primera pestaña.
  const compareTab = compare?.moduleId ? modulesById.get(compare.moduleId)?.slug : undefined;
  const tab: TabSlug | null = categoria
    ? (tabs.find((t) => t.slug === categoria)?.slug ?? null)
    : (tabs.find((t) => t.slug === compareTab)?.slug ?? defaultTab?.slug ?? null);
  const categoryMissing = loaded && categoria !== undefined && categoria !== 'guias' && tab === null;
  const tabDef = tabs.find((t) => t.slug === (tab ?? categoria)) ?? FALLBACK_TAB;
  const moduleDef = tab ? data.modules.find((m) => m.slug === tab) : undefined;
  const catPath = `/catalogo/${tab ?? categoria ?? ''}`;

  const tabEntities = tab ? data.entities.filter((e) => modulesById.get(e.module_id)?.slug === tab && matchesQuery(e)) : [];
  const categories = ['Todas', ...Array.from(new Set(tabEntities.map((e) => e.categoria)))];
  const list = cat === 'Todas' ? tabEntities : tabEntities.filter((e) => e.categoria === cat);
  // «Cargar más» (S4.1): tramos de PAGE_SIZE por (categoría, subcategoría, búsqueda). Un deep link a una ficha
  // lejana amplía el tramo hasta incluirla; el tramo vive en memoria y sobrevive a abrir una ficha y volver.
  const pageKey = `${tab ?? ''}|${cat}|${q}`;
  const [, bumpLoaded] = useReducer((n: number) => n + 1, 0);
  const itemIdx = itemSlug ? list.findIndex((e) => entitySlug(e) === itemSlug) : -1;
  const limit = Math.max(
    loadedMemo.get(pageKey) ?? PAGE_SIZE,
    itemIdx >= 0 ? Math.ceil((itemIdx + 1) / PAGE_SIZE) * PAGE_SIZE : 0,
  );
  const shown = list.length > limit ? list.slice(0, limit) : list;
  const loadMore = (): void => {
    loadedMemo.set(pageKey, limit + PAGE_SIZE);
    bumpLoaded();
  };
  // Un cambio de categoría (pestaña) restablece el filtro de subcategoría.
  useEffect(() => setCat('Todas'), [tab]);


  // Ítem de la URL (caché del mundo primero, luego API por slug).
  const urlItem = useEntityDetail(tab ?? '', itemSlug ?? '', Boolean(itemSlug && tab));
  const itemEntity = itemSlug && tab ? urlItem.entity : null;
  const itemMissing =
    loaded && itemSlug !== undefined && tab !== null && !urlItem.loading && !urlItem.error && itemEntity === null;
  const failed = unavailable || urlItem.error;
  const entitiesPending = worldLoading && data.entities.length === 0;
  const moduleTotal = moduleDef ? data.entities.filter((e) => e.module_id === moduleDef.id).length : 0;
  // Categoría válida pero sin fichas (p. ej. coleccionables): estado vacío limpio, no indexable.
  const emptyState = !failed && !entitiesPending && loaded && tab !== null && tabEntities.length === 0 && itemEntity === null;
  const ficha = params.get('vista') === 'ficha' && itemEntity !== null;
  // Sin ítem en la URL, escritorio/tablet muestran el primero de la lista (la URL no cambia).
  const selected = itemSlug ? itemEntity : isDesktop ? (list[0] ?? null) : null;
  const itemHref = (e: Entity) => `/catalogo/${tab ?? ''}/${entitySlug(e)}`;
  const compareTarget = selected
    ? data.entities.find((e) => e.module_id === selected.module_id && e.id !== selected.id)
    : undefined;

  // /catalogo sin categoría: replaceState a la categoría por defecto (o la de ?modulo=). Con ?comparar= / ?entity= no.
  const entityParam = params.get('entity');
  const moduloParam = params.get('modulo');
  useEffect(() => {
    if (categoria || !loaded || entityParam || compareParam !== null) return;
    const wanted = tabs.find((t) => t.slug === moduloParam) ?? defaultTab;
    if (wanted) navigate(`/catalogo/${wanted.slug}${buildQuery({ q: qValue })}`, { replace: true, keepScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria, loaded, entityParam, compareParam, moduloParam, defaultTab?.slug]);

  // Las guías viven en /guias.
  useEffect(() => {
    if (categoria === 'guias') navigate(itemSlug ? `/guias/${itemSlug}` : '/guias', { replace: true });
  }, [categoria, itemSlug]);

  // Redirección heredada: ?entity=<uuid> -> URL limpia del ítem (replaceState).
  useEffect(() => {
    if (!entityParam || !loaded) return;
    const e = data.entities.find((x) => x.id === entityParam);
    const modSlug = e ? modulesById.get(e.module_id)?.slug : undefined;
    if (e && modSlug) {
      navigate(modSlug === 'guias' ? `/guias/${entitySlug(e)}` : `/catalogo/${modSlug}/${entitySlug(e)}`, {
        replace: true,
        keepScroll: true,
      });
    } else navigate('/catalogo', { replace: true, keepScroll: true });
  }, [entityParam, loaded, data.entities, modulesById]);

  // Memoria de scroll del grid por (categoría, subcategoría): cambiar de ítem no lo mueve y volver a una categoría lo restaura.
  const gridRef = useRef<HTMLUListElement>(null);
  const scrollMemo = useRef(new Map<string, number>());
  const gridKey = `${tab ?? ''}|${cat}`;
  const gridKeyRef = useRef(gridKey);
  gridKeyRef.current = gridKey;
  const hasGrid = list.length > 0 && !ficha;
  useLayoutEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = scrollMemo.current.get(gridKey) ?? 0;
  }, [gridKey, hasGrid]);
  // Deep link: deja visible la tarjeta del ítem (block: nearest no mueve nada si ya se ve).
  const itemId = itemEntity?.id;
  useEffect(() => {
    if (!itemId) return;
    gridRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [itemId, hasGrid]);

  // ---- Navegación (todo pasa por la URL) -----------------------------------------------------
  const selectItem = (e: Entity) => {
    // Desde la lista (sin ítem en la URL) la entrada queda marcada: cerrar el sheet hace history.back().
    navigate(`${itemHref(e)}${buildQuery({ q: qValue })}`, {
      keepScroll: true,
      state: itemSlug ? undefined : { [OVERLAY_STATE_KEY]: true },
    });
  };
  const selectTab = (slug: string) => navigate(`/catalogo/${slug}${buildQuery({ q: qValue })}`, { keepScroll: true });
  const selectSub = (c: string) => {
    loadedMemo.delete(`${tab ?? ''}|${c}|${q}`);
    setCat(c);
    if (itemSlug) navigate(`${catPath}${buildQuery({ q: qValue })}`, { replace: true, keepScroll: true });
  };
  const closeSheet = () => closeOverlay(`${catPath}${buildQuery({ q: qValue })}`);

  const viewQuery = (extra: Record<string, string | undefined> = {}) =>
    buildQuery({ q: qValue, vista: ficha ? 'ficha' : undefined, ...extra });
  const comparePath = categoria ? path : catPath;
  const compareHrefFor = (a: Entity, b: Entity) => `${path}${viewQuery({ comparar: compareSlugs(a, b) })}`;
  const openCompare = (href: string) => navigate(href, { keepScroll: true, state: { [OVERLAY_STATE_KEY]: true } });
  const setCompareSlugs = (slugs: string[]) =>
    navigate(`${path}${viewQuery({ comparar: slugs.join(',') })}`, { replace: true, keepScroll: true });
  const closeCompare = () => closeOverlay(`${comparePath}${viewQuery()}`);

  const linkedMarkers = selected ? data.markers.filter((m) => m.entity_id === selected.id) : [];
  const threads = selected
    ? forum.threads.filter(
        (t) => t.entity_id === selected.id || linkedMarkers.some((m) => m.id === t.marker_id),
      )
    : [];
  const done = (e: Entity): boolean => items[`entity:${e.id}`]?.completado === true;

  // ---- Metadatos dinámicos (title, description, canonical, og:*, JSON-LD, robots) ---------------
  const meta = useMemo<PageMeta>(() => {
    const noindex = 'noindex,nofollow' as const;
    if (failed) return { title: 'Catálogo de Leonida', robots: noindex };
    if (categoryMissing) return { title: 'Categoría no encontrada', robots: noindex };
    if (itemMissing) return { title: 'Ficha no encontrada', robots: noindex };
    if (!moduleDef || !tab) {
      return {
        title: 'Catálogo de Leonida',
        description: 'Inspector del catálogo: armas, vehículos, coleccionables y guías de Leonida con estadísticas y comparador.',
      };
    }
    const origin = window.location.origin;
    const robots = compare !== null || (moduleTotal === 0 && !entitiesPending && !itemEntity) ? noindex : undefined;
    const crumbList = (rest: Array<[string, string]>) => ({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: ([['Inicio', '/'], ['Catalogo', '/catalogo'], ...rest] as Array<[string, string]>).map(
        ([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: origin + p }),
      ),
    });
    if (itemEntity) {
      const itemPath = `/catalogo/${tab}/${entitySlug(itemEntity)}`;
      const description = seoDescription(
        itemEntity,
        `${itemEntity.titulo}: ${itemEntity.categoria} de ${moduleDef.nombre} en el catalogo de LeonidApp.`,
      );
      const image = itemEntity.imagen_url ? absoluteUrl(mediaSrc(itemEntity.imagen_url)) : undefined;
      return {
        title: itemEntity.titulo,
        description,
        robots,
        canonicalPath: itemPath,
        image,
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            name: itemEntity.titulo,
            description,
            ...(image ? { image: [image] } : {}),
            genre: itemEntity.categoria,
            url: origin + itemPath,
            isPartOf: { '@type': 'CollectionPage', name: moduleDef.nombre, url: `${origin}/catalogo/${tab}` },
          },
          crumbList([
            [moduleDef.nombre, `/catalogo/${tab}`],
            [itemEntity.titulo, itemPath],
          ]),
        ],
      };
    }
    const count = moduleTotal;
    const description = truncate(
      `${moduleDef.nombre} de Leonida: ${count} ${count === 1 ? 'ficha' : 'fichas'} con estadisticas y detalles en el catalogo de LeonidApp.`,
      160,
    );
    return {
      title: `${moduleDef.nombre} de Leonida`,
      description,
      robots,
      canonicalPath: `/catalogo/${tab}`,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: moduleDef.nombre,
          description,
          url: `${origin}/catalogo/${tab}`,
          numberOfItems: count,
          isPartOf: { '@type': 'WebSite', name: 'LeonidApp', url: `${origin}/` },
        },
        crumbList([[moduleDef.nombre, `/catalogo/${tab}`]]),
      ],
    };
  }, [failed, categoryMissing, itemMissing, moduleDef, tab, itemEntity, compare, moduleTotal, entitiesPending]);
  usePageMeta(meta);

  const detail = selected && (
    <EntityDetailPanel
      entity={selected}
      doneLabel={tabDef.doneLabel}
      done={done(selected)}
      onToggle={() => toggle({ entityId: selected.id })}
      markers={linkedMarkers}
      doneMarkers={linkedMarkers.filter((m) => items[`marker:${m.id}`]?.completado).length}
      threads={threads}
      compareTarget={compareTarget}
      compareHref={compareTarget ? compareHrefFor(selected, compareTarget) : ''}
      onCompare={() => compareTarget && openCompare(compareHrefFor(selected, compareTarget))}
      fichaHref={`${itemHref(selected)}?vista=ficha`}
      guest={guest}
      heading={isDesktop}
      pinned={isDesktop}
    />
  );

  const notice = error && !failed ? 'No se pudo actualizar desde el servidor.' : null;

  const compareSheet = (
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
  );

  if (mapRedirect) return null;

  if (failed) {
    return (
      <div className="flex h-full min-h-0 flex-col px-3 pt-1 md:px-8">
        <ApiErrorState
          title="No pudimos cargar el catálogo"
          message={urlItem.error ? urlItem.errorMessage : (error ?? '')}
          onRetry={() => {
            retry();
            urlItem.retry();
          }}
        />
      </div>
    );
  }

  if (categoryMissing) {
    return (
      <CatalogNotFound
        title="Esta categoría aún no está disponible"
        text="Todavía no tiene contenido publicado. Mientras tanto, puedes explorar el resto del catálogo."
        href={defaultTab ? `/catalogo/${defaultTab.slug}` : '/'}
        label={defaultTab ? `Ir a ${defaultTab.label}` : 'Ir al inicio'}
      />
    );
  }

  if (ficha && itemEntity && tab) {
    return (
      <>
        <EntityDetail
          entity={itemEntity}
          modulo={tab}
          itemPath={itemHref(itemEntity)}
          compareHrefFor={compareHrefFor}
          onCompare={openCompare}
        />
        {compareSheet}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 pt-1 md:h-full md:min-h-0 md:px-8">
      {/* Cabecera y pestañas */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="font-display text-xl font-bold uppercase tracking-wide text-vice-gold md:text-2xl">
          {tabDef.label}
          {cat !== 'Todas' && <span className="text-vice-orange"> // {cat}</span>}
        </h1>
        <div role="tablist" aria-label="Categorías del catálogo" className="scrollbar-none flex max-w-full gap-2 overflow-x-auto max-md:pr-6 max-md:[mask-image:linear-gradient(to_right,#000_90%,transparent)]">
          {tabs.map((t) => (
            <button
              key={t.slug}
              type="button"
              role="tab"
              aria-selected={tab === t.slug}
              onClick={() => selectTab(t.slug)}
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
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="cat-filtros"
          onClick={() => setFiltersOpen((o) => !o)}
          className="glass flex min-h-11 items-center justify-between gap-3 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold md:hidden"
        >
          <span>Filtros</span>
          <span className="text-xs text-vice-orange">{cat === 'Todas' ? 'Todas' : `Activo: ${cat}`}</span>
        </button>
      )}

      {categories.length > 2 && (
        <ChipScroller id="cat-filtros" label="Filtrar por categoría" mobileOpen={filtersOpen} itemsKey={categories.join('|')} activeKey={cat}>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={cat === c}
              onClick={() => selectSub(c)}
              className={`min-h-11 whitespace-nowrap rounded-full border px-4 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold md:min-h-9 ${
                cat === c ? 'border-vice-orange bg-white/15' : 'border-white/15 hover:bg-white/10'
              }`}
            >
              {c}
            </button>
          ))}
        </ChipScroller>
      )}

      {categories.length <= 2 && entitiesPending && (
        // Reserva el alto de la fila de subcategorías mientras llegan las fichas (CLS = 0).
        <div aria-hidden="true" className="hidden h-9 shrink-0 md:block" />
      )}

      {itemMissing && !isDesktop && (
        <p role="status" className="glass rounded-xl p-3 text-center text-sm">
          No encontramos esta ficha.{' '}
          <a href={catPath} className="font-semibold text-vice-orange underline">
            Ver {tabDef.label.toLowerCase()}
          </a>
        </p>
      )}

      {emptyState ? (
        <section
          aria-label="Selección"
          role="status"
          className="glass flex min-h-[40dvh] items-center justify-center rounded-2xl p-6 text-center md:min-h-0 md:flex-1"
        >
          <div>
            <p className="font-display text-xl font-bold">
              {q ? `Sin resultados para «${search.trim()}»` : 'Próximamente'}
            </p>
            <p className="mt-2 text-sm text-vice-text/80">
              {q ? 'Prueba con otro nombre, categoría o alias.' : `Estamos preparando las fichas de ${tabDef.label.toLowerCase()}. Vuelve pronto.`}
            </p>
            {q && (
              <button
                type="button"
                onClick={() => onSearch('')}
                className="mt-4 min-h-11 rounded-full border border-vice-orange/40 px-5 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        </section>
      ) : (
      <div className="flex flex-col md:min-h-0 md:flex-1 md:grid md:grid-cols-[minmax(240px,1fr)_minmax(300px,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-5 xl:grid-cols-[minmax(260px,360px)_minmax(0,1fr)_minmax(300px,360px)]">
        {/* Rejilla de selección */}
        <section aria-label="Selección" className="glass flex flex-col rounded-2xl p-3 md:min-h-0 md:flex-1 md:p-4">
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-vice-text/90">{tabDef.label}</h2>
            <span className="text-xs text-vice-text/80">{list.length} en total</span>
          </div>
          {list.length === 0 ? (
            <p role="status" className="p-4 text-vice-text/70">
              {entitiesPending ? 'Cargando…' : 'No hay fichas para mostrar.'}
            </p>
          ) : (
            <ul
              ref={gridRef}
              onScroll={(ev) => scrollMemo.current.set(gridKeyRef.current, ev.currentTarget.scrollTop)}
              className="grid grid-cols-2 content-start gap-x-3 gap-y-4 pb-1 md:min-h-0 md:flex-1 md:grid-cols-2 md:gap-x-3 md:gap-y-3 md:overflow-y-auto lg:grid-cols-3 xl:gap-x-2.5"
            >
              {shown.map((e) => {
                const sel = selected?.id === e.id;
                return (
                  <li key={e.id} className="min-w-0">
                    <button
                      type="button"
                      aria-pressed={sel}
                      aria-label={`${e.titulo}${done(e) ? ', completado' : ''}`}
                      title={e.titulo}
                      onClick={() => selectItem(e)}
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
                          kind={tab ?? undefined}
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
                      <span className="line-clamp-2 px-0.5 text-sm font-semibold leading-tight xl:text-[11px]">{e.titulo}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list.length > 0 && (
            // Altura reservada (min-h-11): el contador y el botón no mueven el contenido (CLS = 0).
            <div className="mt-3 flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 px-1">
              <span role="status" className="text-xs text-vice-text/80">
                Mostrando {shown.length} de {list.length}
              </span>
              {shown.length < list.length && (
                <button
                  type="button"
                  onClick={loadMore}
                  className="min-h-11 rounded-full border border-vice-orange/40 bg-white/10 px-5 text-sm font-bold hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  Cargar más
                </button>
              )}
            </div>
          )}
        </section>

        {isDesktop &&
          (selected ? (
            <>
              <Viewer key={selected.id} entity={selected} kind={tab ?? undefined} />
              <aside aria-label="Detalle" className="glass min-h-0 rounded-2xl p-5">
                {detail}
              </aside>
            </>
          ) : (
            <p role={itemMissing ? 'status' : undefined} className="col-span-2 self-center text-center text-vice-text/70">
              {itemMissing ? (
                <>
                  No encontramos esta ficha.{' '}
                  <a href={catPath} className="font-semibold text-vice-orange underline">
                    Ver {tabDef.label.toLowerCase()}
                  </a>
                </>
              ) : (
                'Sin fichas en esta categoría.'
              )}
            </p>
          ))}
      </div>
      )}

      {notice && (
        <p role="status" className="shrink-0 pb-1 text-[11px] text-vice-text/60">
          {notice}
        </p>
      )}

      {/* Móvil: el sheet se abre solo con un ítem en la URL (selección desde el grid o deep link). */}
      <BottomSheet open={!isDesktop && itemEntity !== null && compare === null} onClose={closeSheet} title={itemEntity?.titulo}>
        {detail}
      </BottomSheet>

      {compareSheet}
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
          No se puede comparar: indica al menos 2 fichas válidas de la misma categoría (por ejemplo, desde la ficha o el Inspector).
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
          {discarded === 1 ? 'Se omitió 1 ficha' : `Se omitieron ${discarded} fichas`} no válidas o de otra categoría.
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
          Añadir una tercera ficha
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

// ---- Ficha completa: /catalogo/:categoria/:itemSlug?vista=ficha (página editorial con scroll) --------
// La URL canónica del ítem es el Inspector; la ficha es su vista ampliada (stats, guías, relacionados y
// publicidad "after-content") y conserva la misma URL canónica.
interface EntityFichaProps {
  entity: Entity;
  modulo: string;
  /** Ruta canónica del ítem (Inspector). */
  itemPath: string;
  /** URL del comparador sobre la ficha vigente. */
  compareHrefFor: (a: Entity, b: Entity) => string;
  onCompare: (href: string) => void;
}

function EntityDetail({ entity, modulo, itemPath, compareHrefFor, onCompare }: EntityFichaProps) {
  const { data } = useWorldData({ entities: [modulo], markers: true });
  const { data: guideData } = useWorldData(GUIDES_ONLY);
  const { data: forum } = useForumData();
  const guest = useAuthStore((s) => s.status !== 'authenticated');
  const items = useProgressStore((s) => s.items);
  const toggle = useProgressStore((s) => s.toggle);

  const moduleDef = data.modules.find((m) => m.slug === modulo);
  const tabDef: { label: string; doneLabel: string } | undefined = NON_CATALOG.has(modulo) ? undefined : { label: modulo, doneLabel: DONE_LABELS[modulo] ?? 'Completado' };

  const stats = statsOf(entity);
  const description = descriptionOf(entity);
  const subtitle = subtitleOf(entity);
  const trackable = tabDef !== undefined;
  const done = items[`entity:${entity.id}`]?.completado === true;
  const markers = data.markers.filter((m) => m.entity_id === entity.id);
  const threads = forum.threads
    .filter((t) => t.entity_id === entity.id || markers.some((m) => m.id === t.marker_id))
    .slice(0, 5);
  const guidesModule = data.modules.find((m) => m.slug === 'guias');
  const guides = guideData.entities.filter(
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
    <article className="mx-auto w-full max-w-4xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-2 md:px-8">
      <nav aria-label="Migas de pan" className="text-xs text-vice-text/80">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <a href="/catalogo" className="inline-flex min-h-11 items-center underline">
              Catálogo
            </a>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <a href={`/catalogo/${modulo}`} className="inline-flex min-h-11 items-center underline">
              {moduleDef?.nombre ?? tabDef?.label ?? modulo}
            </a>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page">{entity.titulo}</li>
        </ol>
      </nav>

      <header className="mt-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{entity.categoria}</p>
        <h1 className="font-display text-3xl font-bold">{entity.titulo}</h1>
        {subtitle && <p className="text-vice-text/85">{subtitle}</p>}
        <a href={itemPath} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-vice-orange underline">
          Volver al Inspector
        </a>
      </header>

      <DescriptionBlock paragraphs={description} className="mt-3 max-w-prose" />

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <section aria-label="Imagen" className="glass relative flex h-56 items-center justify-center overflow-hidden rounded-2xl md:h-72">
          <ItemVisual
            entity={entity}
            kind={modulo}
            variant="full"
            className={entity.imagen_url ? 'absolute inset-0 h-full w-full' : 'relative h-4/5 w-4/5 drop-shadow-[0_10px_30px_rgba(225,48,126,0.5)]'}
          />
          {entity.imagen_url && entity.capturaPropiaPendiente === true && <ProvisionalChip className="absolute bottom-2 left-2" />}
        </section>

        <section aria-label="Estadísticas y ficha técnica" className="glass flex flex-col gap-3 rounded-2xl p-5">
          {stats.length > 0 ? (
            stats.map((s, i) => <StatBar key={s.key} label={s.label} value={s.value} valueLabel={s.display} accent={STAT_ACCENTS[i % STAT_ACCENTS.length]} />)
          ) : (
            <p className="text-sm text-vice-text/70">Sin estadísticas numéricas.</p>
          )}
          <SpecSheet entity={entity} />
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
                    href={compareHrefFor(entity, s)}
                    onClick={(ev) => {
                      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
                      ev.preventDefault();
                      onCompare(compareHrefFor(entity, s));
                    }}
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
    </article>
  );
}

export default function CatalogPage({
  params,
  categoria,
  itemSlug,
}: {
  params: URLSearchParams;
  /** `:categoria` de /catalogo/:categoria[/:itemSlug]. */
  categoria?: string;
  /** `:itemSlug` de /catalogo/:categoria/:itemSlug. */
  itemSlug?: string;
}) {
  return <CatalogInspector params={params} categoria={categoria} itemSlug={itemSlug} />;
}
