// =============================================================================
// LeonidApp - Capa de acceso a datos (API Fastify) + utilidades de dominio.
// Todo el contenido viene de la API real: no hay datos de ejemplo ni fixtures. Si la API no responde
// (caída, 429 o sin VITE_API_URL) las vistas muestran un estado de error con «Reintentar».
// Excepción autorizada por el usuario a la regla de carpetas (src/data/seed.ts).
// =============================================================================
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { ApiError, apiFetch, isApiConfigured, useAuthStore } from '../store/useAuthStore';
import { useProgressStore, type ProgressKey } from '../store/useProgressStore';
import type {
  Entity,
  ForumApiResponse,
  ForumCategoria,
  ForumPost,
  ForumThread,
  MapMarker,
  Module,
  MonetizationConfig,
  ForumProfilePreview,
  PublicConfigDTO,
} from '../types/database';

export const HERO_IMAGE = '/assets/hero-gas-station.jpg';
export const DISCORD_URL = 'https://discord.com/';

// ---- Foro: etiqueta visual <-> valor SQL (UNICA constante) ---------------------
export const FORUM_CATEGORIES: ReadonlyArray<{ value: ForumCategoria; label: string }> = [
  { value: 'General', label: 'General' },
  { value: 'Guias/Ayuda', label: 'Guías / Ayuda' },
  { value: 'Secretos', label: 'Secretos' },
  { value: 'Crews', label: 'Crews' },
];
export const forumCategoryLabel = (value: ForumCategoria): string =>
  FORUM_CATEGORIES.find((c) => c.value === value)?.label ?? value;

// ---- Consejos editoriales (texto propio) ----
export const TIPS: readonly string[] = [
  'Marca cada hallazgo al 100% en el mapa: tu avance se guarda aunque no tengas conexión.',
  'Activa solo la capa de Coleccionables para planear una ruta sin ruido visual.',
  'Compara armas y vehículos en el Inspector antes de ir a comprarlos.',
];

// ---- Etiquetas de estadísticas ---------------------------------------------------
export const STAT_LABELS: Record<string, string> = {
  dano: 'Daño',
  cadencia: 'Cadencia',
  precision: 'Precisión',
  alcance: 'Alcance',
  velocidad: 'Velocidad',
  aceleracion: 'Aceleración',
  frenado: 'Frenado',
  manejo: 'Manejo',
  rareza: 'Rareza',
  maniobrabilidad_asfalto: 'Maniobrabilidad en asfalto',
  maniobrabilidad_todoterreno: 'Maniobrabilidad todoterreno',
  fuerza: 'Fuerza',
};

/**
 * Estadísticas para las barras (0-100). Si la entidad trae `metadata_json.stats_juego`
 * (escala 0-10 del juego, fichas importadas de grabaciones), `display` muestra ese valor exacto.
 */
export const statsOf = (e: Entity): Array<{ key: string; label: string; value: number; display?: string }> => {
  const s = e.stats_json;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [];
  const juego = metaOf(e).stats_juego;
  const exact = juego && typeof juego === 'object' && !Array.isArray(juego) ? (juego as Record<string, unknown>) : {};
  return Object.entries(s)
    .filter((kv): kv is [string, number] => typeof kv[1] === 'number')
    .map(([key, value]) => {
      const g = exact[key];
      return { key, label: STAT_LABELS[key] ?? key, value, display: typeof g === 'number' ? g.toFixed(1) : undefined };
    });
};

export const metaOf = (e: Entity): Record<string, unknown> => {
  const m = e.metadata_json;
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
};

// ---- Capas del mapa ------------------------------------------------------------------
export type MapLayerId =
  | 'coleccionables'
  | 'armas'
  | 'vehiculos'
  | 'tiendas'
  | 'eventos'
  | 'misiones'
  | 'regiones'
  | 'ciudades'
  | 'naturaleza'
  | 'poi';

export const MAP_LAYERS: ReadonlyArray<{ id: MapLayerId; label: string; color: string }> = [
  { id: 'coleccionables', label: 'Coleccionables', color: '#FFC857' },
  { id: 'armas', label: 'Armas', color: '#E1307E' },
  { id: 'vehiculos', label: 'Vehículos', color: '#5ED6E0' },
  { id: 'tiendas', label: 'Tiendas', color: '#F69259' },
  { id: 'eventos', label: 'Eventos', color: '#B79CFF' },
  { id: 'misiones', label: 'Misiones y guías', color: '#E14B7B' },
  { id: 'regiones', label: 'Regiones', color: '#9AA8FF' },
  { id: 'ciudades', label: 'Ciudades y barrios', color: '#FF8AD0' },
  { id: 'naturaleza', label: 'Parques y naturaleza', color: '#7BE0A4' },
  { id: 'poi', label: 'Puntos de interés', color: '#FBF1F5' },
];

export function markerLayer(
  marker: MapMarker,
  entities: ReadonlyMap<string, Entity>,
  modules: ReadonlyMap<string, Module>,
): MapLayerId {
  const entity = marker.entity_id ? entities.get(marker.entity_id) : undefined;
  if (!entity) return 'poi';
  const slug = modules.get(entity.module_id)?.slug;
  if (slug === 'coleccionables') return 'coleccionables';
  if (slug === 'armas') return 'armas';
  if (slug === 'vehiculos') return 'vehiculos';
  if (slug === 'mapa') {
    if (entity.categoria === 'Regiones') return 'regiones';
    if (entity.categoria === 'Ciudades y Barrios') return 'ciudades';
    if (entity.categoria === 'Parques y Naturaleza') return 'naturaleza';
    return 'poi';
  }
  if (slug === 'guias') {
    if (entity.categoria === 'Tiendas') return 'tiendas';
    if (entity.categoria === 'Eventos') return 'eventos';
    return 'misiones';
  }
  return 'poi';
}

// ---- Capa de acceso a datos (solo API real; sin datos inventados) ------------------------
export interface WorldData {
  modules: Module[];
  entities: Entity[];
  markers: MapMarker[];
  /** Total de fichas por `Module.slug` (de las entidades cargadas o de la consulta de totales). */
  counts: Record<string, number>;
}

export interface ForumData {
  /** En modo preview `contenido` llega vacio y `posts` es []. */
  threads: ForumThread[];
  posts: ForumPost[];
  profiles: ForumProfilePreview[];
  /** true cuando la API respondio en formato preview (sin sesion). */
  preview?: boolean;
}

/** Recorta un ForumData a formato preview: sin contenido ni respuestas, max 50, recientes primero. */
function toPreview(f: ForumData): ForumData {
  const replies = new Map<string, number>();
  for (const p of f.posts) replies.set(p.thread_id, (replies.get(p.thread_id) ?? 0) + 1);
  const threads = [...f.threads]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50)
    .map((t) => ({ ...t, contenido: '', replies_count: t.replies_count ?? replies.get(t.id) ?? 0 }));
  return { ...f, threads, posts: [], preview: true };
}

/** Tiempo relativo corto: "hace 5 min", "hace 2 h", "hace 3 d" (o "5 min ago" en ingles). */
export function relativeTime(iso: string, lang: 'es' | 'en' = 'es'): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  const [n, unit] = mins < 60 ? [mins, 'min'] : mins < 1440 ? [Math.floor(mins / 60), 'h'] : [Math.floor(mins / 1440), 'd'];
  if (mins < 1) return lang === 'es' ? 'ahora' : 'now';
  return lang === 'es' ? `hace ${n} ${unit}` : `${n} ${unit} ago`;
}

/** Mensaje claro (español neutro) para un fallo de la API: sin servidor, 429, 5xx o red caída. */
export function describeApiError(err?: unknown): string {
  if (!isApiConfigured) return 'La aplicación no está conectada a un servidor, así que no hay datos para mostrar.';
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Hay demasiadas solicitudes en este momento. Espera unos segundos e inténtalo de nuevo.';
    if (err.status === 0) return 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
    if (err.status >= 500) return 'El servidor no pudo responder. Inténtalo de nuevo en unos minutos.';
  }
  return 'Ocurrió un problema al cargar los datos. Inténtalo de nuevo.';
}

const EMPTY_MODULES: Module[] = [];
const EMPTY_MARKERS: MapMarker[] = [];
const EMPTY_ENTITIES: Entity[] = [];
const EMPTY_FORUM: ForumData = { threads: [], posts: [], profiles: [] };
const PAGE_SIZE = 500;

/** Lee todas las páginas de GET /api/entities (el servidor limita a 500 por página). */
async function fetchEntityPages(filter: string): Promise<Entity[]> {
  const out: Entity[] = [];
  for (let page = 1; ; page++) {
    const r = await apiFetch<{ items: Entity[]; pages: number } | Entity[]>(
      `/api/entities?${filter}${filter ? '&' : ''}limit=${PAGE_SIZE}&page=${page}&envelope=1`,
    );
    if (Array.isArray(r)) return r;
    out.push(...r.items);
    if (page >= r.pages) return out;
  }
}

async function fetchEntityCount(slug: string): Promise<number> {
  const r = await apiFetch<{ total: number }>(`/api/entities?module=${encodeURIComponent(slug)}&limit=1&envelope=1`);
  return r.total;
}

/** Qué pide una vista a la API: solo lo necesario. Por defecto (FULL_SCOPE) todo el catálogo. */
export interface WorldScope {
  /** `'all'` = todas las fichas; lista = solo esos módulos (`Module.slug`). */
  entities?: 'all' | readonly string[];
  markers?: boolean;
  /** Módulos de los que basta el total (consulta de 1 elemento), sin descargar las fichas. */
  counts?: readonly string[];
  /** Si algún marcador referencia una ficha ausente, completa con el catálogo completo. */
  refs?: boolean;
}

export const FULL_SCOPE: WorldScope = { entities: 'all', markers: true };
/** Solo módulos (puertas de navegación, etc.). */
export const MODULES_SCOPE: WorldScope = { entities: [], markers: false };
/** Mapa: módulos + marcadores + fichas del módulo `mapa` (y las referenciadas si hiciera falta). */
export const MAP_SCOPE: WorldScope = { entities: ['mapa'], markers: true, refs: true };

export interface WorldResult {
  data: WorldData;
  /** Hay una petición en curso. */
  loading: boolean;
  /** Mensaje si alguna petición falló (aunque haya datos previos). */
  error: string | null;
  /** Faltan datos imprescindibles (API caída, 429 o sin servidor): mostrar `ApiErrorState`. */
  unavailable: boolean;
  retry: () => void;
}

export function useWorldData(scope: WorldScope = FULL_SCOPE): WorldResult {
  const wantAll = scope.entities === 'all';
  const slugKey = Array.isArray(scope.entities) ? scope.entities.join(',') : '';
  const slugs = useMemo(() => (slugKey ? slugKey.split(',') : []), [slugKey]);
  const countKey = (scope.counts ?? []).join(',');
  const countSlugs = useMemo(() => (countKey ? countKey.split(',') : []), [countKey]);

  const modulesQ = useQuery({
    queryKey: ['world', 'modules'],
    queryFn: () => apiFetch<Module[]>('/api/modules', { cache: 'no-cache' }),
    enabled: isApiConfigured,
  });
  const markersQ = useQuery({
    queryKey: ['world', 'markers'],
    // no-cache: revalida con el ETag del servidor, así las altas del editor se ven al instante.
    queryFn: () => apiFetch<MapMarker[]>('/api/markers', { cache: 'no-cache' }),
    enabled: isApiConfigured && scope.markers !== false,
  });
  const slugQs = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ['world', 'entities', slug],
      queryFn: () => fetchEntityPages(`module=${encodeURIComponent(slug)}`),
      enabled: isApiConfigured,
    })),
  });
  const countQs = useQueries({
    queries: countSlugs.map((slug) => ({
      queryKey: ['world', 'count', slug],
      queryFn: () => fetchEntityCount(slug),
      enabled: isApiConfigured,
    })),
  });

  const slugStamp = slugQs.map((q) => q.dataUpdatedAt).join(',');
  const localEntities = useMemo(
    () => slugQs.flatMap((q) => q.data ?? EMPTY_ENTITIES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slugStamp],
  );
  const refsMissing =
    scope.refs === true &&
    markersQ.data !== undefined &&
    slugQs.every((q) => q.isSuccess) &&
    (() => {
      const ids = new Set(localEntities.map((e) => e.id));
      return markersQ.data.some((m) => m.entity_id !== null && !ids.has(m.entity_id));
    })();
  const allQ = useQuery({
    queryKey: ['world', 'entities', 'all'],
    queryFn: () => fetchEntityPages(''),
    enabled: isApiConfigured && (wantAll || refsMissing),
  });

  const all = [modulesQ, markersQ, allQ, ...slugQs, ...countQs] as ReadonlyArray<UseQueryResult<unknown>>;
  const failed = all.find((q) => q.isError && q.data === undefined);
  const firstError = all.find((q) => q.isError);
  const unavailable = !isApiConfigured || failed !== undefined;

  const entities = allQ.data ?? localEntities;
  const countStamp = countQs.map((q) => q.data ?? '').join(',');
  const data = useMemo<WorldData>(() => {
    const counts: Record<string, number> = {};
    const modules = modulesQ.data ?? EMPTY_MODULES;
    const slugById = new Map(modules.map((m) => [m.id, m.slug]));
    for (const e of entities) {
      const s = slugById.get(e.module_id);
      if (s) counts[s] = (counts[s] ?? 0) + 1;
    }
    const parts = countStamp.split(',');
    countSlugs.forEach((slug, i) => {
      const n = parts[i];
      if (n !== undefined && n !== '') counts[slug] = Number(n);
    });
    return { modules, entities, markers: markersQ.data ?? EMPTY_MARKERS, counts };
  }, [modulesQ.data, markersQ.data, entities, countStamp, countSlugs]);

  const retry = (): void => {
    for (const q of all) if (q.isError) void q.refetch();
  };
  return {
    data,
    loading: all.some((q) => q.isFetching),
    error: !isApiConfigured || firstError ? describeApiError(firstError?.error) : null,
    unavailable,
    retry,
  };
}

async function fetchForum(): Promise<ForumData> {
  const f = await apiFetch<ForumApiResponse>('/api/forum');
  if (f.preview) {
    return { preview: true, posts: [], threads: f.threads.map((t) => ({ ...t, contenido: '' })), profiles: f.profiles };
  }
  return f;
}

export function useForumData(): {
  data: ForumData;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  isPreview: boolean;
  retry: () => void;
} {
  const qc = useQueryClient();
  const authenticated = useAuthStore((s) => s.status === 'authenticated');
  const q = useQuery({
    queryKey: ['forum'],
    queryFn: fetchForum,
    enabled: isApiConfigured,
    // Sin sondeo mientras la API falla (evita insistir con un 429).
    refetchInterval: (query) => (query.state.status === 'error' ? false : 20_000),
    refetchIntervalInBackground: false,
  });
  // Al iniciar/cerrar sesion la cache cambia de forma (preview <-> completa).
  useEffect(() => {
    if (isApiConfigured) void qc.invalidateQueries({ queryKey: ['forum'] });
  }, [authenticated, qc]);
  const source = q.data ?? EMPTY_FORUM;
  const isPreview = !authenticated || source.preview === true;
  const data = useMemo(() => (isPreview ? toPreview(source) : source), [isPreview, source]);
  return {
    data,
    loading: q.isFetching,
    error: !isApiConfigured || q.error ? describeApiError(q.error) : null,
    unavailable: !isApiConfigured || (q.isError && q.data === undefined),
    isPreview,
    retry: () => void q.refetch(),
  };
}

// ---- Noticias oficiales y configuración pública (API Fastify) -----------------------------
export type NewsSource = 'rockstar-newswire' | 'rockstar-youtube' | 'take-two-ir';

export const NEWS_SOURCES: ReadonlyArray<{ value: NewsSource | 'all'; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'rockstar-newswire', label: 'Rockstar Newswire' },
  { value: 'rockstar-youtube', label: 'Rockstar YouTube' },
  { value: 'take-two-ir', label: 'Take-Two IR' },
];

export interface OfficialNews {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  source: NewsSource;
  imageUrl: string | null;
  publishedAt: string;
  slug: string;
}

export interface PublicConfig {
  maintenance_mode: boolean;
  announcement: string | null;
  feature_flags: Record<string, boolean>;
  enabled_auth_providers: Array<'google' | 'discord' | 'apple' | 'magic-link'>;
  social_links: Array<{ platform: string; url: string }>;
  /** Solo presentes cuando la API responde (GET /api/config/public). */
  monetization?: MonetizationConfig;
  modules?: PublicConfigDTO['modules'];
}

export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  maintenance_mode: false,
  announcement: null,
  feature_flags: {},
  enabled_auth_providers: ['google', 'discord', 'apple', 'magic-link'],
  social_links: [],
};

/** Las noticias NUNCA se inventan: sin API el resultado es una lista vacía. */
export function useOfficialNews(source: NewsSource | 'all' = 'all', limit = 12) {
  const q = useQuery({
    queryKey: ['news', source, limit],
    enabled: isApiConfigured,
    staleTime: 60_000,
    queryFn: () =>
      apiFetch<OfficialNews[]>(`/api/news?limit=${limit}${source === 'all' ? '' : `&source=${source}`}`),
  });
  return {
    news: q.data ?? [],
    loading: isApiConfigured && q.isLoading,
    error: !isApiConfigured || q.error ? describeApiError(q.error) : null,
    retry: () => void q.refetch(),
  };
}

export function usePublicConfig(): PublicConfig {
  const q = useQuery({
    queryKey: ['config', 'public'],
    enabled: isApiConfigured,
    staleTime: 30_000,
    queryFn: () => apiFetch<PublicConfig>('/api/config/public', { cache: 'no-cache' }),
  });
  return q.data ?? DEFAULT_PUBLIC_CONFIG;
}

// ---- Progreso agregado (Hub / header) ---------------------------------------------------
export interface ProgressCategory {
  id: 'markers' | 'armas' | 'vehiculos' | 'coleccionables';
  label: string;
  done: number;
  total: number;
}

export interface ProgressSummary {
  done: number;
  total: number;
  percent: number;
  categories: ProgressCategory[];
  /** Sin totales (API caída, 429 o sin servidor): la vista muestra un estado de error. */
  unavailable: boolean;
  error: string | null;
  retry: () => void;
}

const CATALOG_SLUGS = ['armas', 'vehiculos', 'coleccionables'] as const;

/**
 * Elementos contabilizables: marcadores del mapa (marker_id) + entidades de los
 * módulos armas / vehículos / coleccionables (entity_id). Las guías no cuentan.
 * Los totales salen de consultas de 1 elemento; las fichas solo se descargan si ya hay avance guardado
 * en alguna (para saber a qué categoría pertenece cada ficha completada).
 */
export function useProgressSummary(): ProgressSummary {
  const items = useProgressStore((s) => s.items);
  const hasEntityProgress = useMemo(
    () => Object.entries(items).some(([k, v]) => k.startsWith('entity:') && v.completado === true),
    [items],
  );
  const { data, unavailable, error, retry } = useWorldData({
    entities: hasEntityProgress ? CATALOG_SLUGS : [],
    markers: true,
    counts: CATALOG_SLUGS,
  });
  const slugById = new Map(data.modules.map((m) => [m.id, m.slug]));
  const defs: Array<{ id: ProgressCategory['id']; label: string; slug?: string }> = [
    { id: 'markers', label: 'Marcadores del mapa' },
    { id: 'armas', label: 'Armas', slug: 'armas' },
    { id: 'vehiculos', label: 'Vehículos', slug: 'vehiculos' },
    { id: 'coleccionables', label: 'Coleccionables', slug: 'coleccionables' },
  ];
  const categories = defs.map((d): ProgressCategory => {
    if (d.slug === undefined) {
      const done = data.markers.filter((x) => items[`marker:${x.id}` as ProgressKey]?.completado === true).length;
      return { id: d.id, label: d.label, done, total: data.markers.length };
    }
    const done = data.entities.filter(
      (x) => slugById.get(x.module_id) === d.slug && items[`entity:${x.id}` as ProgressKey]?.completado === true,
    ).length;
    return { id: d.id, label: d.label, done, total: data.counts[d.slug] ?? 0 };
  });
  const done = categories.reduce((a, c) => a + c.done, 0);
  const total = categories.reduce((a, c) => a + c.total, 0);
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), categories, unavailable, error, retry };
}

// ---- Slugs, módulos activos y enlazado cruzado (docs/LeonidApp-Rutas-SEO-Monetizacion.md §2, §5) ----
/** Entidad con `slug` opcional: la API lo trae; si falta se deriva del título. */
export type EntityWithSlug = Entity & { slug?: string };

export const slugify = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

export const entitySlug = (e: Entity): string => (e as EntityWithSlug).slug || slugify(e.titulo);

/** Ruta limpia de una entidad: Inspector con el ítem preseleccionado (o la guía si el módulo es `guias`). */
export const entityHref = (e: Entity, moduleSlug: string): string =>
  moduleSlug === 'guias' ? `/guias/${entitySlug(e)}` : `/catalogo/${moduleSlug}/${entitySlug(e)}`;

export interface GuideStep {
  id: string;
  title: string;
  body: string;
}

/** Pasos de una guía: `metadata_json.steps` [{id,title,body}]. */
export function guideSteps(e: Entity): GuideStep[] {
  const m = metaOf(e);
  if (Array.isArray(m.steps)) {
    return (m.steps as unknown[]).flatMap((raw, i): GuideStep[] => {
      if (typeof raw === 'string') return [{ id: `s${i + 1}`, title: raw, body: '' }];
      if (raw && typeof raw === 'object') {
        const r = raw as { id?: unknown; title?: unknown; body?: unknown };
        return [
          {
            id: typeof r.id === 'string' && r.id ? r.id : `s${i + 1}`,
            title: typeof r.title === 'string' ? r.title : `Paso ${i + 1}`,
            body: typeof r.body === 'string' ? r.body : '',
          },
        ];
      }
      return [];
    });
  }
  return [];
}

/** UUID de Entity o MapMarker enlazados desde una guía (`metadata_json.lore_refs`). */
export const loreRefs = (e: Entity): string[] => {
  const r = metaOf(e).lore_refs;
  return Array.isArray(r) ? (r as unknown[]).filter((x): x is string => typeof x === 'string') : [];
};

/** Módulos activos: GET /api/config/public incluye también los inactivos; si no responde se usa /api/modules. */
export function useModuleGate(): { isActive: (slug: string) => boolean; catalogActive: boolean } {
  const cfg = usePublicConfig();
  const { data } = useWorldData(MODULES_SCOPE);
  return useMemo(() => {
    const list: Array<{ slug: string; active: boolean }> = cfg.modules
      ? cfg.modules.map((m) => ({ slug: m.slug, active: m.isActive }))
      : data.modules.map((m) => ({ slug: m.slug, active: m.activo }));
    const map = new Map(list.map((m) => [m.slug, m.active]));
    // Un módulo desconocido (aún sin sembrar) no se oculta; uno marcado inactivo sí.
    const isActive = (slug: string): boolean => map.get(slug) !== false;
    const catalogActive = ['armas', 'vehiculos', 'coleccionables', 'guias'].some(isActive);
    return { isActive, catalogActive };
  }, [cfg.modules, data.modules]);
}

/** Entidad por módulo + slug: primero la caché de las listas ya descargadas, luego la API por slug. */
export function useEntityDetail(
  moduleSlug: string,
  slug: string,
  enabled = true,
): { entity: Entity | null; loading: boolean; error: boolean; errorMessage: string; retry: () => void } {
  const qc = useQueryClient();
  const modules = qc.getQueryData<Module[]>(['world', 'modules']);
  const modId = modules?.find((m) => m.slug === moduleSlug)?.id;
  const lists = [
    qc.getQueryData<Entity[]>(['world', 'entities', moduleSlug]),
    qc.getQueryData<Entity[]>(['world', 'entities', 'all']),
  ];
  let local: Entity | null = null;
  if (modId) {
    for (const list of lists) {
      local = list?.find((e) => e.module_id === modId && entitySlug(e) === slug) ?? null;
      if (local) break;
    }
  }
  const q = useQuery({
    queryKey: ['entity', moduleSlug, slug],
    enabled: enabled && isApiConfigured && local === null,
    staleTime: 60_000,
    queryFn: () =>
      apiFetch<Entity>(`/api/modules/${encodeURIComponent(moduleSlug)}/entities/${encodeURIComponent(slug)}`),
    // Un 404 es "no existe", no un fallo de conexión: no se reintenta.
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
  });
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  return {
    entity: local ?? q.data ?? null,
    loading: local === null && q.isLoading,
    error: enabled && local === null && (!isApiConfigured || (q.isError && !notFound)),
    errorMessage: describeApiError(q.error),
    retry: () => void q.refetch(),
  };
}

/** Noticia oficial por slug (solo API; nunca se inventa contenido). */
export function useOfficialNewsItem(slug: string) {
  const q = useQuery({
    queryKey: ['news', 'item', slug],
    enabled: isApiConfigured,
    staleTime: 60_000,
    queryFn: () => apiFetch<OfficialNews>(`/api/news/${encodeURIComponent(slug)}`),
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 1,
  });
  return {
    item: q.data ?? null,
    loading: isApiConfigured && q.isLoading,
    error: !isApiConfigured || q.error ? describeApiError(q.error) : null,
    notFound: q.error instanceof ApiError && q.error.status === 404,
    retry: () => void q.refetch(),
  };
}
