// Cartografía vectorial de Leonida (lienzo 0-1000 x 0-700, origen arriba a la izquierda, Y hacia abajo).
// La geometría pesada (costas, agua interior, terreno, urbano, relieve y red vial) se vectorizó a partir de los
// materiales de referencia locales de `public/ref Leonida map/` (fuera de git y del build) y se publica como JSON
// estático en `public/map-data/`, cargado bajo demanda. Aquí solo viven las capas ligeras, los rótulos y la calca.
//
// Los marcadores reales de MongoDB están calibrados sobre esta cartografía (ver `MARKER_SPOTS`).

export const MAP_W = 1000;
export const MAP_H = 700;

// ---- Geometría pesada: archivos estáticos cargados bajo demanda ----------------------------------------------------
// La cartografía vectorizada (~1 MB) vive en `public/map-data/*.json` y NO entra en el bundle JS:
//  - base-terrain.json: LOD 0 (costas, agua interior, terreno, urbano, autopistas, puentes, aeropuertos, condados).
//  - detail-layers.json: LOD 1/2 (relieve fino, cultivos, carreteras secundarias y ferrocarril).
// Todas las rutas son `d` de paths en coordenadas del lienzo (0-1000 x 0-700).

export interface TerrainBase {
  v: number;
  land: string;
  lakes: string;
  sand: string;
  industrial: string;
  parks: string;
  wet: string;
  urban: string;
  /** Niveles de relieve de menor a mayor altitud (mitad de los 6 niveles). */
  relief: string[];
  airports: string;
  runways: string;
  highways: string;
  keysRoad: string;
  bridges: string;
  counties: string;
}
export interface TerrainDetail {
  v: number;
  /** Los otros 3 niveles de relieve, intercalados con los de la base. */
  relief: string[];
  farms: string;
  minorRoads: string;
  rail: string;
}

const jsonCache = new Map<string, Promise<unknown>>();
/** fetch + caché en memoria (una sola petición por sesión); un fallo no se queda cacheado. */
function loadJson<T>(url: string): Promise<T> {
  let p = jsonCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    });
    p.catch(() => jsonCache.delete(url));
    jsonCache.set(url, p);
  }
  return p as Promise<T>;
}
export const loadBaseTerrain = (): Promise<TerrainBase> => loadJson<TerrainBase>('/map-data/base-terrain.json');
export const loadDetailLayers = (): Promise<TerrainDetail> => loadJson<TerrainDetail>('/map-data/detail-layers.json');

/** Cuadrícula de referencia cada 100 unidades. */
export const GRID_D = (() => {
  let d = '';
  for (let x = 0; x <= MAP_W; x += 100) d += `M${x} 0V${MAP_H}`;
  for (let y = 0; y <= MAP_H; y += 100) d += `M0 ${y}H${MAP_W}`;
  return d;
})();

// ---- Posiciones de los marcadores reales (slug -> lienzo) ---------------------------------------------------------
/** Coordenadas definitivas de los 10 `MapMarker` base sobre esta cartografía. */
export const MARKER_SPOTS: Readonly<Record<string, { x: number; y: number }>> = {
  'vice-city': { x: 617.6, y: 388.2 },
  'ocean-beach': { x: 708.5, y: 359.3 },
  'leonida-keys': { x: 532.5, y: 619.4 },
  'grassrivers': { x: 499.3, y: 541.3 },
  'port-gellhorn': { x: 343.8, y: 196.2 },
  'ambrosia': { x: 518.5, y: 227.1 },
  'lake-leonida': { x: 561.1, y: 200.3 },
  'mount-kalaga-national-park': { x: 487.6, y: 156.9 },
  'vice-dale-county': { x: 627.9, y: 311.8 },
  'starlet-motel': { x: 391.7, y: 266.4 },
};

// ---- Etiquetas con nivel de detalle ---------------------------------------------------------------------------------
export type MapLabelKind = 'region' | 'county' | 'city' | 'water' | 'road';
export interface MapLabel {
  text: string;
  x: number;
  y: number;
  /** 0 = siempre; 1 = a partir del primer nivel de zoom; 2 = a partir del segundo. */
  tier: 0 | 1 | 2;
  kind: MapLabelKind;
  /** Giro en grados alrededor de (x, y): rotula las costas laterales sin salirse del lienzo. */
  rot?: number;
  /** Desplazamiento vertical en píxeles de pantalla respecto a (x, y): aparta el rótulo de su pin. */
  dy?: number;
}
const at = (slug: string): { x: number; y: number } => MARKER_SPOTS[slug]!;
export const MAP_LABELS: ReadonlyArray<MapLabel> = [
  { text: 'Mount Kalaga', ...at('mount-kalaga-national-park'), tier: 0, kind: 'region', dy: -26 },
  { text: 'Port Gellhorn', ...at('port-gellhorn'), tier: 0, kind: 'region', dy: -26 },
  { text: 'Ambrosia', ...at('ambrosia'), tier: 0, kind: 'region', dy: 28 },
  { text: 'Grassrivers', ...at('grassrivers'), tier: 0, kind: 'region', dy: -26 },
  { text: 'Vice-Dale County', ...at('vice-dale-county'), tier: 1, kind: 'region', dy: -24 },
  { text: 'Leonida Keys', ...at('leonida-keys'), tier: 0, kind: 'region', dy: 28 },
  { text: 'Gellhorn County', x: 384.3, y: 318, tier: 1, kind: 'county' },
  { text: 'Kelly County', x: 442.1, y: 429.5, tier: 1, kind: 'county' },
  { text: 'Leonard County', x: 575, y: 478, tier: 1, kind: 'county' },
  { text: 'Vice City', ...at('vice-city'), tier: 1, kind: 'city', dy: 26 },
  { text: 'Ocean Beach', ...at('ocean-beach'), tier: 1, kind: 'city', dy: 26 },
  { text: 'Golfo Occidental', x: 239.8, y: 375.8, tier: 0, kind: 'water', rot: -90 },
  { text: 'Océano Atlántico', x: 766.3, y: 375.8, tier: 0, kind: 'water', rot: 90 },
  { text: 'Lago Leonida', ...at('lake-leonida'), tier: 2, kind: 'water', dy: 24 },
  { text: 'Canal de los Cayos', x: 499.9, y: 664.8, tier: 2, kind: 'water' },
  { text: 'Autopista de los Cayos', x: 466.9, y: 651.6, tier: 2, kind: 'road' },
  { text: 'Aeropuerto Int. de Vice City', x: 541.2, y: 412.9, tier: 2, kind: 'city' },
  { text: 'Base aérea de Goose Key', x: 367.8, y: 640.1, tier: 2, kind: 'city' },
];

// ---- Calcas de referencia (solo Modo Editor) ---------------------------------------------------------------------------------
/** Imagen de referencia ya colocada sobre el lienzo (x, y, w, h en unidades del mapa). */
export interface MapRefImage {
  id: string;
  label: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fracción del ancho de la imagen que se muestra (recorta la leyenda del mapa comunitario). */
  cropW: number;
}
export const REF_IMAGES: ReadonlyArray<MapRefImage> = [
  {
    id: 'community',
    label: 'Mapa comunitario',
    src: '/ref%20Leonida%20map/The%20final%20version%20of%20Commnunity%20map.jpeg',
    x: 216.48,
    y: -37.15,
    w: 812.94,
    h: 774.22,
    cropW: 0.68,
  },
  {
    id: 'leonida',
    label: 'Leonida',
    src: '/ref%20Leonida%20map/Leonida.jpeg',
    x: 229.82,
    y: -0.76,
    w: 546.32,
    h: 697.39,
    cropW: 1,
  },
];

// ---- Paquete de capas ligeras para el render ----------------------------------------------------------------
export const LEONIDA_MAP = {
  gridD: GRID_D,
  labels: MAP_LABELS,
} as const;
