// =============================================================================
// ATLAS VICE - Datos semilla + capa mínima de acceso a datos.
// Excepción autorizada por el usuario a la regla de carpetas (src/data/seed.ts).
// TODOS los datos de este archivo son DE EJEMPLO (metadata_json.sample = true):
// no representan información oficial del juego. Solo usan columnas del esquema.
// Lectura: API Fastify solo si isApiConfigured; si falla o está vacía -> seed.
// =============================================================================
import { useQuery } from '@tanstack/react-query';
import { apiFetch, isApiConfigured } from '../store/useAuthStore';
import { useProgressStore, type ProgressKey } from '../store/useProgressStore';
import type {
  Entity,
  ForumCategoria,
  ForumPost,
  ForumThread,
  MapMarker,
  Module,
  Profile,
} from '../types/database';

// ---- Utilidades -------------------------------------------------------------
const uid = (n: number): string => `a71a5000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-06-01T12:00:00.000Z';
/** Fecha de ejemplo dentro de junio de 2026 (day 1..30). */
const at = (day: number, hour = 12): string =>
  `2026-06-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

const ART = {
  a: '/assets/complexmusic_1794873298_4032011328293408607_12790857096.jpg',
  c: '/assets/complexmusic_1794873298_4032011329073355805_12790857096.jpg',
  e: '/assets/complexmusic_1794873298_4032011331254611421_12790857096.jpg',
  g: '/assets/rockstargames_1782392540_3927315665585859597_184595688.jpg',
  h: '/assets/rockstargames_1790262334_3993332294647284992_184595688.jpg',
  i: '/assets/rockstargames_1791475498_4003509049827826360_184595688.jpg',
} as const;

export const HERO_IMAGE = '/assets/hero-gas-station.jpg';
export const DISCORD_URL = 'https://discord.com/';
export const SAMPLE_NOTICE = 'Datos de ejemplo: no son información oficial del juego.';

// ---- Foro: etiqueta visual <-> valor SQL (UNICA constante) ---------------------
export const FORUM_CATEGORIES: ReadonlyArray<{ value: ForumCategoria; label: string }> = [
  { value: 'General', label: 'General' },
  { value: 'Guias/Ayuda', label: 'Guías / Ayuda' },
  { value: 'Secretos', label: 'Secretos' },
  { value: 'Crews', label: 'Crews' },
];
export const forumCategoryLabel = (value: ForumCategoria): string =>
  FORUM_CATEGORIES.find((c) => c.value === value)?.label ?? value;

// ---- Perfiles (autores de ejemplo) -------------------------------------------
export const SEED_PROFILES: Profile[] = [
  { id: uid(901), username: 'NeonRider', avatar_url: null, discord_id: null, rol: 'ADMIN', created_at: T0 },
  { id: uid(902), username: 'PalmaDorada', avatar_url: null, discord_id: null, rol: 'USER', created_at: T0 },
  { id: uid(903), username: 'KeysCaptain', avatar_url: null, discord_id: null, rol: 'USER', created_at: T0 },
  { id: uid(904), username: 'LuzDeOcean', avatar_url: null, discord_id: null, rol: 'USER', created_at: T0 },
  { id: uid(905), username: 'TurboMiami', avatar_url: null, discord_id: null, rol: 'USER', created_at: T0 },
];

// ---- Módulos ---------------------------------------------------------------------
export const SEED_MODULES: Module[] = [
  { id: uid(1), slug: 'mapa', nombre: 'Mapa de Leonida', icono: 'map', activo: true, orden: 1, created_at: T0 },
  { id: uid(2), slug: 'armas', nombre: 'Armas', icono: 'crosshair', activo: true, orden: 2, created_at: T0 },
  { id: uid(3), slug: 'vehiculos', nombre: 'Vehículos', icono: 'car', activo: true, orden: 3, created_at: T0 },
  { id: uid(4), slug: 'coleccionables', nombre: 'Coleccionables', icono: 'gem', activo: true, orden: 4, created_at: T0 },
  { id: uid(5), slug: 'guias', nombre: 'Guías y Misiones', icono: 'book', activo: true, orden: 5, created_at: T0 },
  { id: uid(6), slug: 'foro', nombre: 'Foro y Comunidad', icono: 'messages', activo: true, orden: 6, created_at: T0 },
  // Módulo futuro (RF-06): inactivo hasta que un ADMIN lo active. RLS lo oculta al público.
  { id: uid(7), slug: 'radio', nombre: 'Estaciones de Radio', icono: 'radio', activo: false, orden: 7, created_at: T0 },
];

const MOD = { armas: uid(2), vehiculos: uid(3), coleccionables: uid(4), guias: uid(5) } as const;

// ---- Entidades -------------------------------------------------------------------
type Meta = Record<string, string | number | boolean | string[]>;

const ent = (
  n: number,
  module_id: string,
  titulo: string,
  subtitulo: string,
  categoria: string,
  stats_json: Record<string, number>,
  metadata_json: Meta,
  imagen_url: string | null = null,
): Entity => ({
  id: uid(n),
  module_id,
  titulo,
  subtitulo,
  categoria,
  imagen_url,
  stats_json,
  metadata_json: { ...metadata_json, sample: true },
  created_at: T0,
});

export const SEED_ENTITIES: Entity[] = [
  // Armas (10-16)
  ent(10, MOD.armas, 'Pistola Compacta C9', 'Arma corta de uso diario', 'Pistolas',
    { dano: 38, cadencia: 62, precision: 70, alcance: 35 },
    { ubicacion: 'Ocean Beach', precio: 1200, municion: '9 mm', silueta: 'pistol' }),
  ent(11, MOD.armas, 'Revólver Magnum R44', 'Gran potencia, recarga lenta', 'Pistolas',
    { dano: 82, cadencia: 25, precision: 66, alcance: 48 },
    { ubicacion: 'Vice Beach', precio: 3400, municion: '.44', silueta: 'pistol' }),
  ent(12, MOD.armas, 'Subfusil Ráfaga S7', 'Cadencia alta a corta distancia', 'Subfusiles',
    { dano: 42, cadencia: 90, precision: 48, alcance: 30 },
    { ubicacion: 'Downtown', precio: 2800, municion: '9 mm', silueta: 'smg' }),
  ent(13, MOD.armas, 'Fusil de Asalto Leonida AR', 'Versátil en todo rango', 'Rifles de Asalto',
    { dano: 64, cadencia: 74, precision: 68, alcance: 72 },
    { ubicacion: 'Port Gellhorn', precio: 5200, municion: '5.56', silueta: 'rifle' }),
  ent(14, MOD.armas, 'Carabina Táctica CT-3', 'Ligera y estable', 'Rifles de Asalto',
    { dano: 58, cadencia: 70, precision: 78, alcance: 66 },
    { ubicacion: 'Grassrivers', precio: 4600, municion: '5.56', silueta: 'rifle' }),
  ent(15, MOD.armas, 'Escopeta Corredera P-12', 'Devastadora de cerca', 'Escopetas',
    { dano: 92, cadencia: 28, precision: 30, alcance: 18 },
    { ubicacion: 'Grassrivers', precio: 3100, municion: 'Calibre 12', silueta: 'shotgun' }),
  ent(16, MOD.armas, 'Rifle de Precisión Halcón', 'Disparo único a larga distancia', 'Francotiradores',
    { dano: 95, cadencia: 15, precision: 96, alcance: 98 },
    { ubicacion: 'Ambrosia', precio: 7800, municion: '.308', silueta: 'sniper' }),

  // Vehículos (20-25)
  ent(20, MOD.vehiculos, 'Deportivo Cometa GT', 'Coupé de alto rendimiento', 'Deportivos',
    { velocidad: 92, aceleracion: 88, frenado: 70, manejo: 84 },
    { ubicacion: 'Vice Beach', precio: 148000, plazas: 2, silueta: 'sports' }),
  ent(21, MOD.vehiculos, 'Muscle Bruto V8', 'Par motor y humo', 'Muscle',
    { velocidad: 80, aceleracion: 78, frenado: 52, manejo: 50 },
    { ubicacion: 'Grassrivers', precio: 72000, plazas: 2, silueta: 'muscle' }),
  ent(22, MOD.vehiculos, 'SUV Cayo Explorer', 'Robusto para caminos de tierra', 'SUV',
    { velocidad: 62, aceleracion: 55, frenado: 64, manejo: 60 },
    { ubicacion: 'Grassrivers', precio: 54000, plazas: 5, silueta: 'suv' }),
  ent(23, MOD.vehiculos, 'Sedán Costero LX', 'Cómodo y discreto', 'Sedanes',
    { velocidad: 60, aceleracion: 58, frenado: 68, manejo: 66 },
    { ubicacion: 'Downtown', precio: 38000, plazas: 4, silueta: 'sedan' }),
  ent(24, MOD.vehiculos, 'Moto Relámpago 600', 'Ágil entre el tráfico', 'Motos',
    { velocidad: 86, aceleracion: 92, frenado: 60, manejo: 72 },
    { ubicacion: 'Ocean Beach', precio: 26000, plazas: 2, silueta: 'bike' }),
  ent(25, MOD.vehiculos, 'Lancha Marea Veloz', 'Perfecta para los Cayos', 'Náuticos',
    { velocidad: 78, aceleracion: 66, frenado: 40, manejo: 58 },
    { ubicacion: 'Leonida Keys', precio: 64000, plazas: 4, silueta: 'boat' }),

  // Coleccionables (30-35) - artwork real de public/assets
  ent(30, MOD.coleccionables, 'Paquetes Ocultos', 'Cápsulas escondidas por toda la isla', 'Paquetes Ocultos',
    { rareza: 40 }, { region: 'Varias', total: 3, ubicacion: 'Varias regiones' }, ART.a),
  ent(31, MOD.coleccionables, 'Reliquias de la Costa', 'Piezas antiguas halladas en el litoral', 'Reliquias',
    { rareza: 70 }, { region: 'Vice Beach', total: 2, ubicacion: 'Vice Beach y Ocean Beach' }, ART.g),
  ent(32, MOD.coleccionables, 'Graffitis de Downtown', 'Obras de arte urbano por descubrir', 'Graffitis',
    { rareza: 35 }, { region: 'Downtown', total: 1, ubicacion: 'Downtown' }, ART.c),
  ent(33, MOD.coleccionables, 'Placas de Matrícula Raras', 'Series limitadas de matrículas', 'Reliquias',
    { rareza: 82 }, { region: 'Port Gellhorn', total: 1, ubicacion: 'Port Gellhorn' }, ART.h),
  ent(34, MOD.coleccionables, 'Cápsulas del Pantano', 'Escondidas entre la vegetación', 'Paquetes Ocultos',
    { rareza: 58 }, { region: 'Grassrivers', total: 1, ubicacion: 'Grassrivers' }, ART.e),
  ent(35, MOD.coleccionables, 'Postales de los Cayos', 'Imágenes de colección del archipiélago', 'Graffitis',
    { rareza: 46 }, { region: 'Leonida Keys', total: 1, ubicacion: 'Leonida Keys' }, ART.i),

  // Guías (40-43)
  ent(40, MOD.guias, 'Primer día en Leonida', 'Cómo empezar sin perderse', 'Consejos', {}, {
    spoiler: false,
    pasos: ['Explora la costa cercana al inicio.', 'Activa el mapa y revisa las capas.', 'Marca todo hallazgo para llevar tu avance.'],
  }),
  ent(41, MOD.guias, 'Ruta de la Tienda de Armas', 'Recorrido por tiendas de la costa', 'Tiendas', {}, {
    spoiler: false,
    pasos: ['Empieza en Ocean Beach.', 'Sigue la costa hasta Vice Beach.', 'Compara precios en el Inspector.'],
  }),
  ent(42, MOD.guias, 'Evento aleatorio en carretera', 'Cómo reconocerlo y qué esperar', 'Eventos', {}, {
    spoiler: false,
    pasos: ['Circula por la autopista de Grassrivers.', 'Detente al ver el vehículo averiado.', 'Interactúa con el conductor.'],
  }),
  ent(43, MOD.guias, 'Misión de ejemplo: Gasolinera', 'Resumen con avisos de spoiler', 'Misión Principal', {}, {
    spoiler: true,
    pasos: ['Llega a la gasolinera antes del atardecer.', 'Observa la zona antes de actuar.', 'Sal por la vía lateral.'],
  }),
];

// ---- Marcadores del lienzo táctico (coordenadas del lienzo 1000 x 700) -----------
const mk = (
  n: number,
  entity: number | null,
  region: string,
  titulo: string,
  descripcion: string,
  x: number,
  y: number,
  media_url: string | null = null,
): MapMarker => ({
  id: uid(n),
  entity_id: entity === null ? null : uid(entity),
  region,
  titulo,
  descripcion,
  coord_x: x,
  coord_y: y,
  media_url,
  created_at: T0,
});

export const SEED_MARKERS: MapMarker[] = [
  mk(100, 30, 'Vice Beach', 'Paquete oculto junto al muelle', 'Cápsula escondida bajo el pasamanos del muelle.', 765.25, 318.5, ART.a),
  mk(101, 30, 'Downtown', 'Paquete oculto en la azotea', 'Accesible desde la escalera de incendios.', 618, 352.75),
  mk(102, 30, 'Grassrivers', 'Paquete oculto en el embarcadero', 'Cerca del embarcadero de madera.', 262.5, 178),
  mk(103, 31, 'Vice Beach', 'Reliquia de la costa', 'Pieza antigua semienterrada en la arena.', 800, 280.25, ART.g),
  mk(104, 32, 'Downtown', 'Graffiti en el callejón', 'Mural visible desde el callejón trasero.', 590.5, 385, ART.c),
  mk(105, 33, 'Port Gellhorn', 'Placa rara en el astillero', 'Sobre la baranda de un contenedor.', 520, 140.5, ART.h),
  mk(106, 34, 'Grassrivers', 'Cápsula del pantano', 'Entre las raíces de un manglar.', 215.75, 225, ART.e),
  mk(107, 35, 'Leonida Keys', 'Postal de los Cayos', 'En el faro del cayo más pequeño.', 330, 610, ART.i),
  mk(108, 31, 'Ocean Beach', 'Reliquia de Ocean Beach', 'Bajo el paseo marítimo.', 695.5, 480),
  mk(109, 10, 'Ocean Beach', 'Tienda de armas Ocean', 'Venta de la Pistola Compacta C9.', 705, 455.5),
  mk(110, 11, 'Vice Beach', 'Armería de Vice Beach', 'Venta del Revólver Magnum R44.', 745.25, 360),
  mk(111, 13, 'Port Gellhorn', 'Depósito de ejemplo', 'Punto de venta del Fusil Leonida AR.', 548, 118),
  mk(112, 16, 'Ambrosia', 'Torre de vigilancia', 'Ubicación de ejemplo del rifle de precisión.', 810, 170.5),
  mk(113, 20, 'Vice Beach', 'Concesionario Cometa', 'Exposición del Deportivo Cometa GT.', 780.5, 340),
  mk(114, 21, 'Grassrivers', 'Taller del pantano', 'Aparece el Muscle Bruto V8 en el taller.', 240, 268.25),
  mk(115, 25, 'Leonida Keys', 'Marina de los Cayos', 'Amarre de la Lancha Marea Veloz.', 410, 575),
  mk(116, 41, 'Ocean Beach', 'Inicio de la ruta de tiendas', 'Primer punto de la guía de tiendas.', 690, 500.5),
  mk(117, 42, 'Grassrivers', 'Evento de carretera', 'Zona donde puede aparecer el evento de ejemplo.', 330, 210),
  mk(118, 40, 'Vice Beach', 'Punto de partida de ejemplo', 'Primer paso de la guía de inicio.', 735, 300),
  mk(119, null, 'Downtown', 'Mirador del centro', 'Punto de interés sin entidad asociada.', 640.25, 330),
];

/** Etiquetas de región del lienzo (cosmético; no es una columna del esquema). */
export const MAP_REGIONS: ReadonlyArray<{ name: string; x: number; y: number }> = [
  { name: 'Grassrivers', x: 250, y: 215 },
  { name: 'Port Gellhorn', x: 520, y: 175 },
  { name: 'Ambrosia', x: 800, y: 205 },
  { name: 'Vice Beach', x: 765, y: 330 },
  { name: 'Downtown', x: 610, y: 375 },
  { name: 'Ocean Beach', x: 700, y: 520 },
  { name: 'Leonida Keys', x: 370, y: 650 },
];

// ---- Foro --------------------------------------------------------------------------
const th = (
  n: number,
  user: number,
  categoria: ForumCategoria,
  titulo: string,
  contenido: string,
  upvotes: number,
  day: number,
  opts: { spoiler?: boolean; pinned?: boolean; entity?: number; marker?: number } = {},
): ForumThread => ({
  id: uid(n),
  user_id: uid(user),
  entity_id: opts.entity ? uid(opts.entity) : null,
  marker_id: opts.marker ? uid(opts.marker) : null,
  categoria,
  titulo,
  contenido,
  is_spoiler: opts.spoiler ?? false,
  is_pinned: opts.pinned ?? false,
  upvotes_count: upvotes,
  created_at: at(day),
});

export const SEED_THREADS: ForumThread[] = [
  th(500, 901, 'General', 'Bienvenida a la comunidad de ATLAS VICE (datos de ejemplo)',
    'Este hilo es contenido de ejemplo. Usa el foro para compartir rutas, dudas y hallazgos. Respeta las etiquetas de spoiler.',
    57, 1, { pinned: true }),
  th(501, 902, 'Guias/Ayuda', '¿Cuál es la mejor ruta para empezar a coleccionar?',
    'Estoy empezando y quiero ordenar los paquetes ocultos por región. ¿Alguna ruta sugerida desde Vice Beach?',
    34, 12, { entity: 30 }),
  th(502, 903, 'Secretos', 'Posible hallazgo cerca del faro de los Cayos',
    'Contenido de ejemplo marcado como spoiler: creo haber visto algo cerca del faro. ¿Alguien más lo confirmó?',
    88, 14, { spoiler: true, marker: 107 }),
  th(503, 904, 'Crews', 'Busco crew para explorar de noche',
    'Hilo de ejemplo. Horario: noches de fin de semana. Se agradece micrófono y buen humor.',
    12, 20),
  th(504, 905, 'Guias/Ayuda', 'Comparativa: Deportivo Cometa GT vs Muscle Bruto V8',
    'Comparo velocidad, aceleración y manejo con el Inspector. ¿Qué prefieren para carretera?',
    41, 22, { entity: 20 }),
  th(505, 902, 'General', 'Tienda de armas de Ocean Beach: precios de ejemplo',
    '¿Los precios de la Pistola Compacta se parecen a los del catálogo del portal? Dato de ejemplo.',
    9, 29, { marker: 109 }),
];

const po = (
  n: number,
  thread: number,
  user: number,
  parent: number | null,
  contenido: string,
  upvotes: number,
  day: number,
): ForumPost => ({
  id: uid(n),
  thread_id: uid(thread),
  user_id: uid(user),
  parent_post_id: parent === null ? null : uid(parent),
  contenido,
  upvotes_count: upvotes,
  created_at: at(day, 15),
});

export const SEED_POSTS: ForumPost[] = [
  po(600, 501, 901, null, 'Empieza por la costa y avanza hacia Downtown; así no cruzas dos veces las mismas calles.', 14, 12),
  po(601, 501, 902, 600, 'Gracias, lo pruebo hoy con la capa de Coleccionables activada.', 3, 13),
  po(602, 501, 904, 600, 'Yo marco cada paquete al 100% para ver cuánto me falta por región.', 6, 13),
  po(603, 501, 903, null, 'Los Cayos conviene dejarlos para el final: hace falta lancha.', 9, 14),
  po(604, 502, 901, null, 'Aviso de spoiler: tomen estas teorías con cautela, es contenido de ejemplo.', 21, 15),
  po(605, 502, 905, 604, 'Coincido. Prefiero esperar a que haya más información.', 4, 16),
  po(606, 504, 904, null, 'Para carretera recta, el Deportivo Cometa GT; para terracería, el SUV.', 11, 23),
  po(607, 504, 903, 606, 'Sin duda; y la moto para tráfico urbano.', 2, 24),
  po(608, 503, 902, null, 'Me apunto, aviso por aquí cuando esté conectado.', 3, 21),
];

// ---- Contenido editorial de ejemplo (no es parte del esquema) ----------------------
export const SEED_TIPS: readonly string[] = [
  'Marca cada hallazgo al 100% en el mapa: tu avance se guarda aunque no tengas conexión.',
  'Activa solo la capa de Coleccionables para planear una ruta sin ruido visual.',
  'Compara armas y vehículos en el Inspector antes de ir a comprarlos.',
];

export const SEED_NEWS: ReadonlyArray<{ id: string; titulo: string; fecha: string; texto: string }> = [
  { id: 'n1', titulo: 'Cartografía en actualización', fecha: '2026-06-28', texto: 'El lienzo táctico de Leonida se amplía con nuevas regiones de ejemplo.' },
  { id: 'n2', titulo: 'Nuevo Inspector NUI', fecha: '2026-06-20', texto: 'Compara estadísticas de armas y vehículos con barras claras.' },
  { id: 'n3', titulo: 'Foro con etiquetas de spoiler', fecha: '2026-06-12', texto: 'Los hilos con spoiler se ocultan hasta que decidas verlos.' },
];

export const SEED_ROUTES: ReadonlyArray<{
  id: string;
  titulo: string;
  descripcion: string;
  markerIds: readonly string[];
}> = [
  { id: 'r1', titulo: 'Ruta de la costa este', descripcion: 'Vice Beach y Ocean Beach en un solo recorrido.', markerIds: [uid(100), uid(103), uid(110), uid(113), uid(108), uid(109)] },
  { id: 'r2', titulo: 'Ruta del pantano', descripcion: 'Grassrivers: coleccionables y taller.', markerIds: [uid(102), uid(106), uid(114), uid(117)] },
  { id: 'r3', titulo: 'Ruta de los Cayos', descripcion: 'Archipiélago al sur: postales y marina.', markerIds: [uid(107), uid(115)] },
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
};

export const statsOf = (e: Entity): Array<{ key: string; label: string; value: number }> => {
  const s = e.stats_json;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [];
  return Object.entries(s)
    .filter((kv): kv is [string, number] => typeof kv[1] === 'number')
    .map(([key, value]) => ({ key, label: STAT_LABELS[key] ?? key, value }));
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
  | 'poi';

export const MAP_LAYERS: ReadonlyArray<{ id: MapLayerId; label: string; color: string }> = [
  { id: 'coleccionables', label: 'Coleccionables', color: '#FFC857' },
  { id: 'armas', label: 'Armas', color: '#E1307E' },
  { id: 'vehiculos', label: 'Vehículos', color: '#5ED6E0' },
  { id: 'tiendas', label: 'Tiendas', color: '#F69259' },
  { id: 'eventos', label: 'Eventos', color: '#B79CFF' },
  { id: 'misiones', label: 'Misiones y guías', color: '#E14B7B' },
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
  if (slug === 'guias') {
    if (entity.categoria === 'Tiendas') return 'tiendas';
    if (entity.categoria === 'Eventos') return 'eventos';
    return 'misiones';
  }
  return 'poi';
}

// ---- Capa de acceso a datos -----------------------------------------------------------
export type DataSource = 'seed' | 'api';

export interface WorldData {
  modules: Module[];
  entities: Entity[];
  markers: MapMarker[];
  source: DataSource;
}

export interface ForumData {
  threads: ForumThread[];
  posts: ForumPost[];
  profiles: Profile[];
  source: DataSource;
}

export const SEED_WORLD: WorldData = {
  modules: SEED_MODULES,
  entities: SEED_ENTITIES,
  markers: SEED_MARKERS,
  source: 'seed',
};

export const SEED_FORUM: ForumData = {
  threads: SEED_THREADS,
  posts: SEED_POSTS,
  profiles: SEED_PROFILES,
  source: 'seed',
};

async function fetchWorld(): Promise<WorldData> {
  if (!isApiConfigured) return SEED_WORLD;
  const [modules, entities, markers] = await Promise.all([
    apiFetch<Module[]>('/api/modules'),
    apiFetch<Entity[]>('/api/entities'),
    apiFetch<MapMarker[]>('/api/markers'),
  ]);
  if (entities.length === 0 && markers.length === 0) return SEED_WORLD;
  return { modules, entities, markers, source: 'api' };
}

async function fetchForum(): Promise<ForumData> {
  if (!isApiConfigured) return SEED_FORUM;
  const f = await apiFetch<{ threads: ForumThread[]; posts: ForumPost[]; profiles: Profile[] }>('/api/forum');
  if (f.threads.length === 0) return SEED_FORUM;
  return { ...f, source: 'api' };
}

export interface DataResult<T> {
  data: T;
  /** Cargando desde la API (mientras tanto se muestra el seed). */
  loading: boolean;
  /** Mensaje si la API falló: se mantiene el seed. */
  error: string | null;
}

export function useWorldData(): DataResult<WorldData> {
  const q = useQuery({
    queryKey: ['world'],
    queryFn: fetchWorld,
    enabled: isApiConfigured,
    initialData: SEED_WORLD,
    initialDataUpdatedAt: 0,
  });
  return { data: q.data, loading: q.isFetching, error: q.error ? q.error.message : null };
}

export function useForumData(): DataResult<ForumData> {
  const q = useQuery({
    queryKey: ['forum'],
    queryFn: fetchForum,
    enabled: isApiConfigured,
    initialData: SEED_FORUM,
    initialDataUpdatedAt: 0,
  });
  return { data: q.data, loading: q.isFetching, error: q.error ? q.error.message : null };
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
}

/**
 * Elementos contabilizables: marcadores del mapa (marker_id) + entidades de los
 * módulos armas / vehículos / coleccionables (entity_id). Las guías no cuentan.
 */
export function useProgressSummary(): ProgressSummary {
  const { data } = useWorldData();
  const items = useProgressStore((s) => s.items);
  const slugById = new Map(data.modules.map((m) => [m.id, m.slug]));
  const defs: Array<{ id: ProgressCategory['id']; label: string; slug?: string }> = [
    { id: 'markers', label: 'Marcadores del mapa' },
    { id: 'armas', label: 'Armas', slug: 'armas' },
    { id: 'vehiculos', label: 'Vehículos', slug: 'vehiculos' },
    { id: 'coleccionables', label: 'Coleccionables', slug: 'coleccionables' },
  ];
  const categories = defs.map((d): ProgressCategory => {
    const ids =
      d.slug === undefined
        ? data.markers.map((x) => x.id)
        : data.entities.filter((x) => slugById.get(x.module_id) === d.slug).map((x) => x.id);
    const done = ids.filter(
      (id) => items[(d.slug === undefined ? `marker:${id}` : `entity:${id}`) as ProgressKey]?.completado === true,
    ).length;
    return { id: d.id, label: d.label, done, total: ids.length };
  });
  const done = categories.reduce((a, c) => a + c.done, 0);
  const total = categories.reduce((a, c) => a + c.total, 0);
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), categories };
}
