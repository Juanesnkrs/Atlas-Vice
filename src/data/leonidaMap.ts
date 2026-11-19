// Cartografía vectorial ORIGINAL de Leonida (lienzo 0-1000 x 0-700, origen arriba a la izquierda).
// Todo se genera aquí mismo a partir de puntos de control propios: litoral con desplazamiento de
// punto medio determinista (semilla fija) suavizado con Catmull-Rom -> Bézier cúbico. Sin imágenes,
// sin datos de terceros y sin dependencias. Es una representación esquemática, no una réplica de
// ningún mapa oficial.
//
// Alineación con los marcadores reales (MongoDB): Port Gellhorn ~(130,330), Ambrosia ~(470,340),
// Lake Leonida ~(490,250), Mount Kalaga ~(500,80), Grassrivers ~(300,500), Vice City ~(780,470),
// Vice-Dale County ~(800,430), Ocean Beach ~(840,500), Leonida Keys ~(700,645).

export const MAP_W = 1000;
export const MAP_H = 700;

type P = [number, number];

/** PRNG determinista (mulberry32): el mapa es idéntico en cada carga y en cada dispositivo. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Desplazamiento de punto medio perpendicular: da textura fractal a un litoral o a un río. */
function displace(pts: P[], closed: boolean, amp: number, rnd: () => number, iters = 3): P[] {
  let cur = pts;
  let a = amp;
  for (let it = 0; it < iters; it++) {
    const out: P[] = [];
    const n = cur.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p = cur[i]!;
      const q = cur[(i + 1) % n]!;
      out.push(p);
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      const off = (rnd() - 0.5) * 2 * len * a;
      out.push([(p[0] + q[0]) / 2 + (-dy / len) * off, (p[1] + q[1]) / 2 + (dx / len) * off]);
    }
    if (!closed) out.push(cur[n - 1]!);
    cur = out;
    a *= 0.55;
  }
  return cur;
}

/** Catmull-Rom -> Bézier cúbico (tensión 0.5). */
function smooth(pts: P[], closed: boolean): string {
  const n = pts.length;
  const at = (i: number): P => (closed ? pts[((i % n) + n) % n]! : pts[Math.min(n - 1, Math.max(0, i))]!);
  let d = `M${r1(pts[0]![0])} ${r1(pts[0]![1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** Contorno irregular alrededor de una elipse (islas, lagos, curvas de nivel). */
function blobPts(cx: number, cy: number, rx: number, ry: number, seed: number, n = 14, noise = 0.18): P[] {
  const rnd = prng(seed);
  const pts: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 2 * noise;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
const blob = (cx: number, cy: number, rx: number, ry: number, seed: number, n?: number, noise?: number): string =>
  smooth(blobPts(cx, cy, rx, ry, seed, n, noise), true);

// ---- Masa continental ---------------------------------------------------------------------
const MAINLAND_CTRL: P[] = [
  [112, 208], [150, 138], [230, 86], [330, 56], [440, 40], [560, 36], [680, 44], [780, 70],
  [850, 122], [880, 192], [872, 262], [892, 332], [918, 402], [928, 472], [912, 532], [880, 576],
  [830, 600], [770, 588], [700, 578], [640, 592], [570, 586], [500, 602], [430, 592], [365, 612],
  [300, 620], [232, 602], [172, 562], [124, 504], [90, 432], [78, 362], [82, 290],
];
const MAINLAND = displace(MAINLAND_CTRL, true, 0.14, prng(7), 3);
export const LAND_MAIN_D = smooth(MAINLAND, true);

// ---- Cayos de Leonida (cadena de islas sobre el sur) -----------------------------------------
interface Isle {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
const KEYS: Isle[] = [
  { cx: 812, cy: 617, rx: 17, ry: 7 },
  { cx: 760, cy: 633, rx: 15, ry: 6 },
  { cx: 700, cy: 645, rx: 30, ry: 10 },
  { cx: 646, cy: 651, rx: 14, ry: 6 },
  { cx: 600, cy: 642, rx: 18, ry: 7 },
  { cx: 556, cy: 628, rx: 13, ry: 5 },
  { cx: 520, cy: 646, rx: 9, ry: 4 },
];
const BARRIER: Isle[] = [
  { cx: 958, cy: 440, rx: 8, ry: 46 },
  { cx: 952, cy: 540, rx: 7, ry: 26 },
];
const ISLET_D = [...KEYS, ...BARRIER].map((k, i) => blob(k.cx, k.cy, k.rx, k.ry, 100 + i, 12, 0.16));
const LAND_ALL_D = [LAND_MAIN_D, ...ISLET_D].join('');

// ---- Hidrografía ------------------------------------------------------------------------------
export const LAKE_D = blob(490, 250, 56, 38, 21, 16, 0.12);
const riverPath = (ctrl: P[], seed: number): string => smooth(displace(ctrl, false, 0.1, prng(seed), 3), false);
export const RIVERS_D = [
  riverPath([[455, 282], [425, 340], [388, 410], [340, 480], [312, 548], [296, 612]], 31),
  riverPath([[528, 270], [570, 330], [620, 372], [660, 408]], 32),
  riverPath([[470, 215], [452, 160], [470, 105]], 33),
].join('');

// ---- Regiones (relleno tenue recortado a tierra firme) -----------------------------------------
export interface MapRegionShape {
  name: string;
  d: string;
  fill: string;
}
export const REGION_SHAPES: ReadonlyArray<MapRegionShape> = [
  { name: 'Port Gellhorn', d: blob(150, 330, 100, 120, 41, 14, 0.1), fill: 'rgba(225,75,123,0.16)' },
  { name: 'Grassrivers', d: blob(290, 505, 160, 100, 42, 14, 0.1), fill: 'rgba(94,214,224,0.13)' },
  { name: 'Ambrosia', d: blob(470, 345, 150, 125, 43, 14, 0.1), fill: 'rgba(246,146,89,0.15)' },
  { name: 'Mount Kalaga', d: blob(500, 95, 210, 80, 44, 14, 0.1), fill: 'rgba(183,156,255,0.17)' },
  { name: 'Vice-Dale County', d: blob(790, 440, 125, 110, 45, 14, 0.1), fill: 'rgba(225,48,126,0.2)' },
];
/** Marisma de Grassrivers: trazos cortos de vegetación acuática. */
export const SWAMP_D = (() => {
  const rnd = prng(55);
  let d = '';
  for (let i = 0; i < 120; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd());
    const x = 290 + Math.cos(a) * 150 * rr;
    const y = 520 + Math.sin(a) * 85 * rr;
    d += `M${r1(x - 4)} ${r1(y)}h8M${r1(x - 2)} ${r1(y + 3)}h4`;
  }
  return d;
})();

// ---- Curvas de nivel ------------------------------------------------------------------------------
interface Hill {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rings: number;
  seed: number;
}
const HILLS: Hill[] = [
  { cx: 500, cy: 96, rx: 38, ry: 13, rings: 6, seed: 61 },
  { cx: 330, cy: 205, rx: 24, ry: 14, rings: 3, seed: 62 },
  { cx: 840, cy: 160, rx: 20, ry: 12, rings: 3, seed: 63 },
  { cx: 640, cy: 215, rx: 18, ry: 10, rings: 2, seed: 64 },
];
const contours = (major: boolean): string =>
  HILLS.flatMap((h) =>
    Array.from({ length: h.rings }, (_, i) => i)
      .filter((i) => (i % 3 === 2) === major)
      .map((i) => {
        const k = 1 + i * 0.95;
        return blob(h.cx, h.cy, h.rx * k, h.ry * k, h.seed * 10 + i, 18, 0.16);
      }),
  ).join('');
export const CONTOURS_MINOR_D = contours(false);
export const CONTOURS_MAJOR_D = contours(true);

// ---- Red vial y puentes ------------------------------------------------------------------------------
const road = (ctrl: P[], seed: number, amp = 0.05): string => smooth(displace(ctrl, false, amp, prng(seed), 2), false);
export const HIGHWAYS_D = [
  road([[96, 336], [210, 346], [320, 330], [400, 346], [470, 342], [560, 380], [650, 420], [730, 452], [780, 470], [840, 500]], 71),
  road([[470, 342], [590, 280], [606, 188], [548, 116], [500, 84]], 72),
  road([[470, 342], [400, 422], [334, 470], [300, 502], [280, 574]], 73),
  road([[800, 432], [858, 470], [884, 400], [880, 322], [866, 232], [850, 148]], 74),
].join('');

/** Autopista de los Cayos: sale de la costa este y salta de isla en isla. */
const KEYS_ROAD: P[] = [[848, 504], [858, 566], [832, 600], ...KEYS.map((k): P => [k.cx, k.cy])];
export const KEYS_ROAD_D = road(KEYS_ROAD, 75, 0.02);
/** Puentes: tramos sobre el agua entre dos islas consecutivas. */
export const BRIDGES_D = KEYS.slice(0, -1)
  .map((a, i) => {
    const b = KEYS[i + 1]!;
    return `M${r1(a.cx - a.rx)} ${r1(a.cy + (b.cy - a.cy) * 0.2)}L${r1(b.cx + b.rx)} ${r1(b.cy)}`;
  })
  .join('');

export const ROADS_D = [
  road([[130, 332], [152, 290], [180, 230], [230, 200]], 81),
  road([[230, 200], [330, 205], [430, 170], [470, 105]], 82),
  road([[560, 380], [610, 470], [680, 530], [780, 560], [832, 598]], 83),
  road([[300, 502], [380, 540], [470, 560], [560, 548]], 84),
  road([[780, 470], [740, 400], [700, 330], [640, 290]], 85),
].join('');

/** Retícula urbana: calles cortas giradas, recortadas al rectángulo de cada núcleo. */
interface City {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  step: number;
}
const CITIES: City[] = [
  { cx: 772, cy: 468, w: 96, h: 64, rot: -18, step: 9 },
  { cx: 842, cy: 496, w: 54, h: 40, rot: -22, step: 8 },
  { cx: 136, cy: 336, w: 56, h: 52, rot: 8, step: 9 },
  { cx: 470, cy: 342, w: 62, h: 46, rot: 0, step: 10 },
  { cx: 300, cy: 500, w: 40, h: 30, rot: 12, step: 10 },
];
export const STREETS_D = CITIES.map((c) => {
  const a = (c.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const at = (u: number, v: number): string => `${r1(c.cx + u * cos - v * sin)} ${r1(c.cy + u * sin + v * cos)}`;
  let d = '';
  for (let u = -c.w / 2; u <= c.w / 2; u += c.step) d += `M${at(u, -c.h / 2)}L${at(u, c.h / 2)}`;
  for (let v = -c.h / 2; v <= c.h / 2; v += c.step * 1.1) d += `M${at(-c.w / 2, v)}L${at(c.w / 2, v)}`;
  return d;
}).join('');

/** Cuadrícula de referencia cada 100 unidades. */
export const GRID_D = (() => {
  let d = '';
  for (let x = 0; x <= MAP_W; x += 100) d += `M${x} 0V${MAP_H}`;
  for (let y = 0; y <= MAP_H; y += 100) d += `M0 ${y}H${MAP_W}`;
  return d;
})();

// ---- Etiquetas con nivel de detalle ---------------------------------------------------------------------
export type MapLabelKind = 'region' | 'city' | 'water' | 'road';
export interface MapLabel {
  text: string;
  x: number;
  y: number;
  /** 0 = siempre; 1 = a partir del primer nivel de zoom; 2 = a partir del segundo. */
  tier: 0 | 1 | 2;
  kind: MapLabelKind;
  /** Giro en grados alrededor de (x, y): rotula las costas laterales sin salirse del lienzo. */
  rot?: number;
}
export const MAP_LABELS: ReadonlyArray<MapLabel> = [
  { text: 'Mount Kalaga', x: 500, y: 60, tier: 0, kind: 'region' },
  { text: 'Port Gellhorn', x: 168, y: 268, tier: 0, kind: 'region' },
  { text: 'Ambrosia', x: 470, y: 392, tier: 0, kind: 'region' },
  { text: 'Grassrivers', x: 300, y: 548, tier: 0, kind: 'region' },
  { text: 'Vice-Dale County', x: 800, y: 386, tier: 0, kind: 'region' },
  { text: 'Leonida Keys', x: 700, y: 676, tier: 0, kind: 'region' },
  { text: 'Vice City', x: 756, y: 516, tier: 1, kind: 'city' },
  { text: 'Ocean Beach', x: 852, y: 536, tier: 1, kind: 'city' },
  { text: 'Golfo Occidental', x: 34, y: 360, tier: 0, kind: 'water', rot: -90 },
  { text: 'Océano Atlántico', x: 972, y: 230, tier: 0, kind: 'water', rot: 90 },
  { text: 'Lago Leonida', x: 490, y: 306, tier: 2, kind: 'water' },
  { text: 'Canal de los Cayos', x: 640, y: 616, tier: 2, kind: 'water' },
  { text: 'Autopista Transpeninsular', x: 330, y: 318, tier: 2, kind: 'road' },
  { text: 'Autopista de los Cayos', x: 840, y: 580, tier: 2, kind: 'road' },
];

// ---- Paquete para el render --------------------------------------------------------------------------------
export const LEONIDA_MAP = {
  landMainD: LAND_MAIN_D,
  landAllD: LAND_ALL_D,
  isletsD: ISLET_D.join(''),
  lakeD: LAKE_D,
  riversD: RIVERS_D,
  regions: REGION_SHAPES,
  swampD: SWAMP_D,
  contoursMinorD: CONTOURS_MINOR_D,
  contoursMajorD: CONTOURS_MAJOR_D,
  highwaysD: HIGHWAYS_D,
  keysRoadD: KEYS_ROAD_D,
  bridgesD: BRIDGES_D,
  roadsD: ROADS_D,
  streetsD: STREETS_D,
  gridD: GRID_D,
  labels: MAP_LABELS,
} as const;
