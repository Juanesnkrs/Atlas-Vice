// Cartografía vectorial de Leonida (lienzo 0-1000 x 0-700, origen arriba a la izquierda, Y hacia abajo).
// La geometría pesada (costas, agua interior, terreno, urbano, relieve y red vial) se vectorizó a partir de los
// materiales de referencia locales de `public/ref Leonida map/` (fuera de git y del build) y se publica como JSON
// estático en `public/map-data/`, cargado bajo demanda. Aquí solo viven las capas ligeras, los rótulos y la calca.
//
// Los marcadores reales de MongoDB están calibrados sobre esta cartografía (ver `MARKER_SPOTS`).

export const MAP_W = 1000;
export const MAP_H = 700;
/** Contorno de la isla de Leonida (con sus cayos) dentro del lienzo: base del encuadre, de los límites de paneo y de la rejilla. */
export const ISLAND_BBOX = { x0: 265, y0: 22, x1: 731, y1: 696 } as const;

// ---- Geometría pesada: archivos estáticos cargados bajo demanda ----------------------------------------------------
// La cartografía vectorizada (~1 MB) vive en `public/map-data/*.json` y NO entra en el bundle JS:
//  - base-terrain.json: LOD 0 (costas, agua interior, terreno, urbano, autopistas, puentes, aeropuertos, condados).
//  - detail-layers.json: LOD 1/2 (relieve fino, cultivos, carreteras secundarias y ferrocarril).
// Todas las rutas son `d` de paths en coordenadas del lienzo (0-1000 x 0-700).

/** Escudo de ruta: [número, tipo (i = interestatal, u = US, s = estatal), x, y]. */
export type RouteShield = readonly [string, 'i' | 'u' | 's', number, number];

/** Las rutas son cadenas codificadas (décimas de unidad, primer punto absoluto + incrementos, `|` separa anillos). */
export interface TerrainBase {
  v: number;
  land: string;
  lakes: string;
  sand: string;
  industrial: string;
  /** Reservas y parques (Mount Kalaga). */
  parks: string;
  wet: string;
  urban: string;
  /** Niveles de relieve de menor a mayor altitud (mitad de los 6 niveles). */
  relief: string[];
  airports: string;
  runways: string;
  /** Límites de condado: polilíneas medidas sobre la referencia (discontinuas, cruzan tierra y mar). */
  counties: string;
  /** Cintas de autopista (crema de la referencia) como polígonos rellenos: ancho y enlaces reales. */
  highwayAreas: string;
  /** Tramos de autopista que reconectan huecos de las cintas (bajo escudos/rótulos) y puentes sobre el agua. */
  highways: string;
  bridges: string;
  shields: RouteShield[];
}
export interface TerrainDetail {
  v: number;
  /** Los otros 3 niveles de relieve, intercalados con los de la base. */
  relief: string[];
  farms: string;
  /** Carreteras secundarias, calles urbanas, callejones/muelles y sendas o caminos de tierra. */
  roads: string;
  streets: string;
  alleys: string;
  dirt: string;
  rail: string;
  /** Metrorail y Metromover elevados, con sus estaciones (aproximadas). */
  metro: string;
  mover: string;
  stationsMetro: [number, number][];
  stationsMover: [number, number][];
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

// ---- Posiciones de los marcadores reales (slug -> lienzo) ---------------------------------------------------------
/** Coordenadas definitivas de los 10 `MapMarker` base sobre esta cartografía. */
export const MARKER_SPOTS: Readonly<Record<string, { x: number; y: number }>> = {
  'vice-city': { x: 617.6, y: 388.2 },
  'ocean-beach': { x: 708.5, y: 359.3 },
  'leonida-keys': { x: 532.5, y: 619.4 },
  'grassrivers': { x: 492.9, y: 542.4 },
  'port-gellhorn': { x: 389.0, y: 219.9 },
  'ambrosia': { x: 518.5, y: 227.1 },
  'lake-leonida': { x: 561.1, y: 200.3 },
  'mount-kalaga-national-park': { x: 487.6, y: 156.9 },
  'vice-dale-county': { x: 627.9, y: 311.8 },
  'starlet-motel': { x: 391.7, y: 266.4 },
};

// ---- Etiquetas con nivel de detalle ---------------------------------------------------------------------------------
export type MapLabelKind = 'region' | 'county' | 'city' | 'water' | 'land' | 'poi' | 'border';
export interface MapLabel {
  text: string;
  /** Segunda línea (rótulo doble de los límites de condado, como en la referencia: un condado a cada lado de la línea). */
  sub?: string;
  x: number;
  y: number;
  /** Prioridad: P0 (0) regiones, siempre; P1 (1) ciudades, condados y barrios mayores, desde LOD 1; P2 (2) barrios, cayos, relieve, aeropuertos y límites de condado, desde LOD 2. */
  tier: 0 | 1 | 2;
  kind: MapLabelKind;
  /** Giro en grados alrededor de (x, y): rotula las costas laterales y los límites de condado. */
  rot?: number;
}
/**
 * Catálogo de rótulos de la referencia cartográfica (los blancos de `The final version of Commnunity map.jpeg`, sin los
 * nombres reales entre paréntesis en rojo). Posiciones medidas sobre la referencia y proyectadas al lienzo con la
 * transformación única x = (orig_x - 500) * 0.2 * K + TX, y = (orig_y - 650) * 0.2 * K + TY
 * (K = 0.387112, TX = 249.5966, TY = 13.1738). Los rótulos de condado interiores (P1) se colocan sobre territorio
 * propio de cada condado; los de frontera (P2, kind 'border') están sobre la propia línea, como en la referencia.
 */
export const MAP_LABELS: ReadonlyArray<MapLabel> = [
  { text: 'Mount Kalaga', x: 486.8, y: 150.9, tier: 0, kind: 'region' },
  { text: 'Port Gellhorn', x: 356.7, y: 224.8, tier: 0, kind: 'region' },
  { text: 'Ambrosia', x: 518.4, y: 213, tier: 0, kind: 'region' },
  { text: 'Grassrivers', x: 487.7, y: 542.4, tier: 0, kind: 'region' },
  { text: 'Leonida Keys', x: 471.1, y: 636.4, tier: 0, kind: 'region' },
  { text: 'Vice City', x: 650, y: 357.3, tier: 0, kind: 'region' },
  { text: 'Golfo Occidental', x: 239.8, y: 375.8, tier: 0, kind: 'water', rot: -90 },
  { text: 'Océano Atlántico', x: 766.3, y: 375.8, tier: 0, kind: 'water', rot: 90 },
  { text: 'Grayson', x: 434.5, y: 127.9, tier: 1, kind: 'city' },
  { text: 'Millport', x: 601.1, y: 131.4, tier: 1, kind: 'city' },
  { text: 'North Beaches', x: 663.6, y: 223.2, tier: 1, kind: 'city' },
  { text: 'Waning Sands', x: 637.2, y: 241.9, tier: 1, kind: 'city' },
  { text: 'Belville', x: 584.5, y: 277.7, tier: 1, kind: 'city' },
  { text: 'Vice Beach', x: 733.7, y: 336.5, tier: 1, kind: 'city' },
  { text: 'Ocean Beach', x: 727.7, y: 366.3, tier: 1, kind: 'city' },
  { text: 'Capri', x: 360.9, y: 382.1, tier: 1, kind: 'city' },
  { text: 'Belpoint', x: 301.8, y: 384, tier: 1, kind: 'city' },
  { text: 'Hamlet', x: 544.4, y: 519.5, tier: 1, kind: 'city' },
  { text: 'Watson Bay', x: 422.1, y: 526, tier: 1, kind: 'city' },
  { text: 'Key Lento', x: 555.4, y: 622.9, tier: 1, kind: 'city' },
  { text: 'Southwind', x: 390.1, y: 638.6, tier: 1, kind: 'city' },
  { text: 'Lake Leonida', x: 561.2, y: 203, tier: 1, kind: 'water' },
  { text: 'Bonanza', x: 485.8, y: 63.2, tier: 2, kind: 'city' },
  { text: 'Moreau', x: 486.1, y: 86, tier: 2, kind: 'city' },
  { text: 'Sundown', x: 619.8, y: 216.5, tier: 2, kind: 'city' },
  { text: 'Sundown Beach', x: 652, y: 203.9, tier: 2, kind: 'city' },
  { text: 'Vinewood Beach', x: 667, y: 245.7, tier: 2, kind: 'city' },
  { text: 'Washington Beach', x: 719.8, y: 299.9, tier: 2, kind: 'city' },
  { text: 'Vice Decor District', x: 627.4, y: 305.9, tier: 2, kind: 'city' },
  { text: 'Stockyard', x: 627.1, y: 321.8, tier: 2, kind: 'city' },
  { text: 'La Perle', x: 602.3, y: 331.5, tier: 2, kind: 'city' },
  { text: 'Bayside', x: 623.5, y: 339.9, tier: 2, kind: 'city' },
  { text: 'Crosstown', x: 611.5, y: 347, tier: 2, kind: 'city' },
  { text: 'Downtown', x: 609.3, y: 372.9, tier: 2, kind: 'city' },
  { text: 'Shoreline', x: 631.8, y: 382.5, tier: 2, kind: 'city' },
  { text: 'Vice River', x: 623, y: 415.2, tier: 2, kind: 'city' },
  { text: 'Tequesta', x: 598.1, y: 439.6, tier: 2, kind: 'city' },
  { text: 'Salton', x: 585.6, y: 411.2, tier: 2, kind: 'city' },
  { text: 'Rockridge', x: 591.6, y: 354.7, tier: 2, kind: 'city' },
  { text: 'Little Cuba', x: 591.3, y: 381.8, tier: 2, kind: 'city' },
  { text: 'Tisha-Wocka', x: 531.3, y: 356.5, tier: 2, kind: 'city' },
  { text: 'Balsero', x: 552.5, y: 371.3, tier: 2, kind: 'city' },
  { text: 'Buckskin', x: 475.9, y: 361.4, tier: 2, kind: 'city' },
  { text: 'Bluegrass', x: 536.4, y: 473.2, tier: 2, kind: 'city' },
  { text: 'Southside', x: 565.6, y: 473.2, tier: 2, kind: 'city' },
  { text: 'Pelican Valley', x: 494, y: 492.3, tier: 2, kind: 'city' },
  { text: 'Peregrine Bay', x: 574.8, y: 529.7, tier: 2, kind: 'city' },
  { text: 'Port VC', x: 666, y: 413, tier: 2, kind: 'city' },
  { text: 'Nautilus', x: 676.4, y: 312.8, tier: 2, kind: 'city' },
  { text: 'Bay Harbor', x: 698.4, y: 310.1, tier: 2, kind: 'city' },
  { text: 'Pelican Harbor', x: 677.2, y: 320.2, tier: 2, kind: 'city' },
  { text: 'Bayshore', x: 698.1, y: 322.3, tier: 2, kind: 'city' },
  { text: 'Tequesta Retreat', x: 631.8, y: 429.3, tier: 2, kind: 'city' },
  { text: 'Featherstone Islands', x: 419.9, y: 72.6, tier: 2, kind: 'water' },
  { text: 'Hyde Island', x: 546.8, y: 43.6, tier: 2, kind: 'water' },
  { text: 'Frampton Islands', x: 571.7, y: 67.5, tier: 2, kind: 'water' },
  { text: 'Zephyr Islands', x: 361.2, y: 150.2, tier: 2, kind: 'water' },
  { text: 'Draper Island', x: 342, y: 197.5, tier: 2, kind: 'water' },
  { text: 'Little Hardin Island', x: 656.1, y: 159.8, tier: 2, kind: 'water' },
  { text: 'Sandbars', x: 287.8, y: 260.2, tier: 2, kind: 'water' },
  { text: 'Crude Islands', x: 309.4, y: 302.2, tier: 2, kind: 'water' },
  { text: 'Picnic Islands', x: 637.2, y: 328, tier: 2, kind: 'water' },
  { text: 'Rialto Islands', x: 658.1, y: 338.9, tier: 2, kind: 'water' },
  { text: 'Broad Causeway Island', x: 669, y: 274.5, tier: 2, kind: 'water' },
  { text: 'South Cove', x: 661.5, y: 257.8, tier: 2, kind: 'water' },
  { text: 'Haulover', x: 685.6, y: 269.6, tier: 2, kind: 'water' },
  { text: 'Watson Island', x: 646.8, y: 371.3, tier: 2, kind: 'water' },
  { text: 'Starfish Island', x: 666, y: 373.4, tier: 2, kind: 'water' },
  { text: 'Ferry Island', x: 669.1, y: 391, tier: 2, kind: 'water' },
  { text: 'Catalan Bay', x: 665.1, y: 425.2, tier: 2, kind: 'water' },
  { text: 'Gloriana Key', x: 662.9, y: 450.9, tier: 2, kind: 'water' },
  { text: 'Dalton Island', x: 707.9, y: 438.4, tier: 2, kind: 'water' },
  { text: 'Catalan Key', x: 629.9, y: 462.3, tier: 2, kind: 'water' },
  { text: 'Stiltsville', x: 631.1, y: 515.2, tier: 2, kind: 'water' },
  { text: 'Mariana Island', x: 347.1, y: 539.6, tier: 2, kind: 'water' },
  { text: 'Barracuda Keys', x: 325.1, y: 595.6, tier: 2, kind: 'water' },
  { text: 'Woman Key', x: 342.8, y: 605.6, tier: 2, kind: 'water' },
  { text: 'Marquesas Keys', x: 307.4, y: 626.7, tier: 2, kind: 'water' },
  { text: 'Dudz Island', x: 397.6, y: 576.3, tier: 2, kind: 'water' },
  { text: 'Mayo Key', x: 417.5, y: 624, tier: 2, kind: 'water' },
  { text: 'Bobcat Key', x: 374, y: 442.8, tier: 2, kind: 'water' },
  { text: 'Maroon Key', x: 466.4, y: 646.5, tier: 2, kind: 'water' },
  { text: 'Abismo Key', x: 453.1, y: 664.6, tier: 2, kind: 'water' },
  { text: 'Maple Syrup Hill', x: 428.8, y: 147.7, tier: 2, kind: 'land' },
  { text: 'Mount Waffles', x: 432.1, y: 172.4, tier: 2, kind: 'land' },
  { text: 'Mount Mountain', x: 463.1, y: 183.3, tier: 2, kind: 'land' },
  { text: 'Ambrosia Hill', x: 503.2, y: 170.3, tier: 2, kind: 'land' },
  { text: 'Escher Bridge', x: 532, y: 165.7, tier: 2, kind: 'land' },
  { text: 'Thrillbilly Mud Club', x: 482.7, y: 202.2, tier: 2, kind: 'land' },
  { text: 'Thrillbilly Hill', x: 496.5, y: 207.9, tier: 2, kind: 'land' },
  { text: 'Bridge Ridge', x: 490.5, y: 232.9, tier: 2, kind: 'land' },
  { text: 'Starlet Hill', x: 416.1, y: 251, tier: 2, kind: 'land' },
  { text: 'Kelly Hill', x: 423.2, y: 275.2, tier: 2, kind: 'land' },
  { text: 'Carousel Hill', x: 417.2, y: 285.6, tier: 2, kind: 'land' },
  { text: 'Corkscrew Hill', x: 405.3, y: 302.6, tier: 2, kind: 'land' },
  { text: 'Lollipop Ridge', x: 469.7, y: 264.2, tier: 2, kind: 'land' },
  { text: 'Emerald Springs', x: 469.6, y: 291.9, tier: 2, kind: 'land' },
  { text: 'Buckskin Swamp', x: 485.6, y: 336.7, tier: 2, kind: 'land' },
  { text: 'Breakwater Quarry', x: 452.6, y: 422.4, tier: 2, kind: 'land' },
  { text: 'Leaf Links Golf Club', x: 658.7, y: 291, tier: 2, kind: 'poi' },
  { text: 'Gellhorn Int. Raceway', x: 383.4, y: 313.7, tier: 2, kind: 'poi' },
  { text: 'Vice City Int. Airport', x: 525.8, y: 412.8, tier: 2, kind: 'poi' },
  { text: 'Goose Key Naval Air Station', x: 364.3, y: 640.3, tier: 2, kind: 'poi' },
  { text: 'LTF Airfield', x: 529.1, y: 549.7, tier: 2, kind: 'poi' },
  { text: 'Port Gellhorn Airfield', x: 348, y: 264.6, tier: 2, kind: 'poi' },
  { text: 'Sundown Private Airfield', x: 604.9, y: 218.1, tier: 2, kind: 'poi' },
  { text: 'Corsair Key', x: 591.3, y: 572.1, tier: 2, kind: 'water' },
  { text: 'Lummox County', x: 538.4, y: 96.8, tier: 1, kind: 'county' },
  { text: 'Kelly County', x: 497.3, y: 284.2, tier: 1, kind: 'county' },
  { text: 'Leonard County', x: 560.4, y: 304.6, tier: 1, kind: 'county' },
  { text: 'Mariana County', x: 471.9, y: 483.8, tier: 1, kind: 'county' },
  { text: 'Vice-Dale County', x: 505.1, y: 395.3, tier: 1, kind: 'county' },
  { text: 'Lummox County', x: 455.3, y: 168, tier: 2, kind: 'border', sub: 'Kelly County', rot: -30 },
  { text: 'Lummox County', x: 507.3, y: 161.9, tier: 2, kind: 'border', sub: 'Kelly County', rot: 15 },
  { text: 'Lummox County', x: 555.4, y: 148.7, tier: 2, kind: 'border', sub: 'Leonard County', rot: 15 },
  { text: 'Lummox County', x: 628.4, y: 142, tier: 2, kind: 'border', sub: 'Leonard County', rot: -55 },
  { text: 'Leonard County', x: 542.7, y: 219.4, tier: 2, kind: 'border', sub: 'Kelly County', rot: 70 },
  { text: 'Leonard County', x: 529.2, y: 304.6, tier: 2, kind: 'border', sub: 'Kelly County', rot: 90 },
  { text: 'Leonard County', x: 577.5, y: 337.8, tier: 2, kind: 'border', sub: 'Vice-Dale County', rot: -30 },
  { text: 'Leonard County', x: 668.2, y: 265.3, tier: 2, kind: 'border', sub: 'Vice-Dale County', rot: -30 },
  { text: 'Kelly County', x: 473, y: 368, tier: 2, kind: 'border', sub: 'Vice-Dale County', rot: 15 },
  { text: 'Vice-Dale County', x: 465.3, y: 403.6, tier: 2, kind: 'border', sub: 'Mariana County', rot: 45 },
  { text: 'Vice-Dale County', x: 641.1, y: 500.1, tier: 2, kind: 'border', sub: 'Mariana County', rot: 35 },
  { text: 'Kelly County', x: 337, y: 348.3, tier: 2, kind: 'border', sub: 'Mariana County', rot: 5 },
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
  labels: MAP_LABELS,
} as const;
