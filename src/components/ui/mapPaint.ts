// Pintor 2D del mapa estático de Leonida. Dibuja en un <canvas> las capas pesadas (océano, terreno,
// límites, aeropuertos y toda la red vial/ferroviaria) a partir de la geometría diferida de
// `public/map-data/*.json`. Solo se vuelve a pintar al cargar datos, al cruzar un umbral de LOD o
// cuando el zoom/desplazamiento se aleja del bitmap en caché; mientras tanto MapCanvas mueve el
// bitmap con una transformación CSS (translate3d + scale) en cada frame de requestAnimationFrame.
//
// Formato de las rutas (`encWorld` del script de vectorización): coordenadas del lienzo en décimas
// de unidad; el primer punto de cada anillo/línea es absoluto y el resto son incrementos; `|` separa
// anillos/líneas. Las curvas se suavizan al pintar (cuadráticas entre puntos medios).
import type { TerrainBase, TerrainDetail } from '../../data/leonidaMap';
import { ISLAND_BBOX } from '../../data/leonidaMap';

// Paleta: un agua, una tierra, un acento ámbar; el resto, tono sobre tono.
export const WATER = '#10234A';
const LAND = '#94649A';
const SAND = '#E8C9A0';
const JADE = '#43B58C';
const OCRE = '#C9A56A';
const RELIEF = '#5E3A72';
const URBAN = '#CBBFD9';
const AMBER = '#F2B35E';
const CASING = '#1A0F2A';
const CORAL = '#E14B7B';

export function decodeRings(s: string): Float32Array[] {
  if (!s) return [];
  const out: Float32Array[] = [];
  for (const ring of s.split('|')) {
    if (!ring) continue;
    const a = ring.split(' ');
    const n = a.length >> 1;
    if (n < 2) continue;
    const pts = new Float32Array(n * 2);
    let x = Number(a[0]);
    let y = Number(a[1]);
    pts[0] = x / 10;
    pts[1] = y / 10;
    for (let i = 1; i < n; i++) {
      x += Number(a[i * 2]);
      y += Number(a[i * 2 + 1]);
      pts[i * 2] = x / 10;
      pts[i * 2 + 1] = y / 10;
    }
    out.push(pts);
  }
  return out;
}

/** Path2D con curvas cuadráticas entre puntos medios (cerrado = polígono; abierto = polilínea). */
function toPath(rings: Float32Array[], closed: boolean): Path2D {
  const p = new Path2D();
  for (const r of rings) {
    const n = r.length >> 1;
    if (closed && n >= 3) {
      p.moveTo((r[(n - 1) * 2]! + r[0]!) / 2, (r[(n - 1) * 2 + 1]! + r[1]!) / 2);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        p.quadraticCurveTo(r[i * 2]!, r[i * 2 + 1]!, (r[i * 2]! + r[j * 2]!) / 2, (r[i * 2 + 1]! + r[j * 2 + 1]!) / 2);
      }
      p.closePath();
    } else if (n === 2) {
      p.moveTo(r[0]!, r[1]!);
      p.lineTo(r[2]!, r[3]!);
    } else if (n > 2) {
      p.moveTo(r[0]!, r[1]!);
      for (let i = 1; i < n - 1; i++) p.quadraticCurveTo(r[i * 2]!, r[i * 2 + 1]!, (r[i * 2]! + r[(i + 1) * 2]!) / 2, (r[i * 2 + 1]! + r[(i + 1) * 2 + 1]!) / 2);
      p.lineTo(r[(n - 1) * 2]!, r[(n - 1) * 2 + 1]!);
    }
  }
  return p;
}
const poly = (s: string): Path2D => toPath(decodeRings(s), true);
const line = (s: string): Path2D => toPath(decodeRings(s), false);

export interface BasePaths {
  land: Path2D;
  lakes: Path2D;
  sand: Path2D;
  industrial: Path2D;
  parks: Path2D;
  wet: Path2D;
  urban: Path2D;
  relief: Path2D[];
  airports: Path2D;
  runways: Path2D;
  counties: Path2D;
  highways: Path2D;
  bridges: Path2D;
}
export interface DetailPaths {
  relief: Path2D[];
  farms: Path2D;
  roads: Path2D;
  streets: Path2D;
  alleys: Path2D;
  dirt: Path2D;
  rail: Path2D;
  metro: Path2D;
  mover: Path2D;
  stationsMetro: ReadonlyArray<readonly [number, number]>;
  stationsMover: ReadonlyArray<readonly [number, number]>;
}

export function buildBasePaths(b: TerrainBase): BasePaths {
  return {
    land: poly(b.land),
    lakes: poly(b.lakes),
    sand: poly(b.sand),
    industrial: poly(b.industrial),
    parks: poly(b.parks),
    wet: poly(b.wet),
    urban: poly(b.urban),
    relief: b.relief.map(poly),
    airports: poly(b.airports),
    runways: line(b.runways),
    counties: poly(b.counties),
    highways: line(b.highways),
    bridges: line(b.bridges),
  };
}
export function buildDetailPaths(d: TerrainDetail): DetailPaths {
  return {
    relief: d.relief.map(poly),
    farms: poly(d.farms),
    roads: line(d.roads),
    streets: line(d.streets),
    alleys: line(d.alleys),
    dirt: line(d.dirt),
    rail: line(d.rail),
    metro: line(d.metro),
    mover: line(d.mover),
    stationsMetro: d.stationsMetro,
    stationsMover: d.stationsMover,
  };
}

export interface PaintOpts {
  /** Rectángulo del mundo que cubre el bitmap. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Píxeles CSS por unidad del mundo con los que se pinta (la escala del mapa en ese momento). */
  s: number;
  /** Píxeles del bitmap por unidad del mundo (s * dpr). */
  sx: number;
  sy: number;
  /** 0 = encuadre general, 1 = barrios, 2 = manzanas y detalle fino. */
  lod: 0 | 1 | 2;
}

/** Trama de líneas paralelas recortada al Path2D activo (cultivos y manzanas urbanas). */
function hatch(ctx: CanvasRenderingContext2D, o: PaintOpts, spacing: number, angleDeg: number, color: string, lwPx: number): void {
  const cx = (o.x0 + o.x1) / 2;
  const cy = (o.y0 + o.y1) / 2;
  const d = Math.hypot(o.x1 - o.x0, o.y1 - o.y0) / 2;
  const n = Math.min(900, Math.ceil((2 * d) / spacing));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.strokeStyle = color;
  ctx.lineWidth = lwPx / o.s;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = -d + i * spacing;
    ctx.moveTo(-d, t);
    ctx.lineTo(d, t);
  }
  ctx.stroke();
  ctx.restore();
}

export function paintMap(ctx: CanvasRenderingContext2D, base: BasePaths | null, detail: DetailPaths | null, o: PaintOpts): void {
  const px = (v: number): number => v / o.s; // píxeles CSS -> unidades del mundo (trazos de ancho constante)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(o.sx, 0, 0, o.sy, -o.x0 * o.sx, -o.y0 * o.sy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Océano: un único azul oscuro (cubre también el margen fuera del lienzo del mapa).
  ctx.fillStyle = WATER;
  ctx.fillRect(o.x0 - 1, o.y0 - 1, o.x1 - o.x0 + 2, o.y1 - o.y0 + 2);
  // Rejilla muy tenue cada 100 unidades, acotada al área del mapa (isla + margen).
  const gx0 = Math.floor((ISLAND_BBOX.x0 - 60) / 100) * 100;
  const gx1 = Math.ceil((ISLAND_BBOX.x1 + 60) / 100) * 100;
  const gy0 = Math.floor((ISLAND_BBOX.y0 - 60) / 100) * 100;
  const gy1 = Math.ceil((ISLAND_BBOX.y1 + 60) / 100) * 100;
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = px(1);
  ctx.beginPath();
  for (let x = gx0; x <= gx1; x += 100) {
    ctx.moveTo(x, gy0);
    ctx.lineTo(x, gy1);
  }
  for (let y = gy0; y <= gy1; y += 100) {
    ctx.moveTo(gx0, y);
    ctx.lineTo(gx1, y);
  }
  ctx.stroke();
  if (!base) return;

  // Ondas del mismo azul alrededor de toda la costa y tierra firme con borde cálido.
  ctx.strokeStyle = 'rgba(127,163,217,0.07)';
  ctx.lineWidth = 13;
  ctx.stroke(base.land);
  ctx.strokeStyle = 'rgba(127,163,217,0.14)';
  ctx.lineWidth = 6;
  ctx.stroke(base.land);
  ctx.fillStyle = LAND;
  ctx.fill(base.land, 'evenodd');
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = SAND;
  ctx.lineWidth = px(1.5);
  ctx.stroke(base.land);
  ctx.globalAlpha = 1;

  // ---- Terreno recortado a tierra firme ----
  ctx.save();
  ctx.clip(base.land, 'evenodd');
  const reliefs: { p: Path2D; major: boolean }[] = [];
  base.relief.forEach((p, i) => {
    reliefs.push({ p, major: true });
    const d = detail?.relief[i];
    if (d) reliefs.push({ p: d, major: false });
  });
  ctx.fillStyle = RELIEF;
  ctx.globalAlpha = 0.2;
  for (const r of reliefs) ctx.fill(r.p, 'evenodd');
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = JADE;
  ctx.fill(base.parks, 'evenodd');
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = JADE;
  ctx.lineWidth = px(0.8);
  ctx.stroke(base.parks);
  ctx.globalAlpha = 1;
  if (detail && o.lod >= 1) {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#8DB27A';
    ctx.fill(detail.farms, 'evenodd');
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.clip(detail.farms, 'evenodd');
    hatch(ctx, o, 2.6, 28, 'rgba(190,214,150,0.55)', 0.7);
    ctx.restore();
  }
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = SAND;
  ctx.fill(base.sand, 'evenodd');
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = OCRE;
  ctx.fill(base.industrial, 'evenodd');
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = OCRE;
  ctx.lineWidth = px(0.8);
  ctx.stroke(base.industrial);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#5E9AA0';
  ctx.fill(base.wet, 'evenodd');
  ctx.globalAlpha = 1;
  // Curvas de nivel: las de la base siempre, las del detalle a partir de LOD 1.
  ctx.strokeStyle = 'rgba(255,214,190,0.34)';
  for (const r of reliefs) {
    if (!r.major && o.lod < 1) continue;
    ctx.globalAlpha = r.major ? 1 : 0.7;
    ctx.lineWidth = px(r.major ? 1 : 0.7);
    ctx.stroke(r.p);
  }
  ctx.globalAlpha = 1;
  // Huella urbana gris violácea (+ manzanas en LOD 2) y aeropuertos.
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = URBAN;
  ctx.fill(base.urban, 'evenodd');
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = px(0.6);
  ctx.stroke(base.urban);
  if (o.lod >= 2) {
    ctx.save();
    ctx.clip(base.urban, 'evenodd');
    hatch(ctx, o, 5, -18, 'rgba(60,30,90,0.4)', 0.3);
    hatch(ctx, o, 5, 72, 'rgba(60,30,90,0.4)', 0.3);
    ctx.restore();
  }
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#B3A8C9';
  ctx.fill(base.airports, 'evenodd');
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = px(0.8);
  ctx.stroke(base.airports);
  ctx.strokeStyle = '#FFF1D6';
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'butt';
  ctx.stroke(base.runways);
  ctx.lineCap = 'round';
  // Límites de condado (aproximados): discontinuos y sutiles.
  ctx.strokeStyle = 'rgba(232,201,160,0.55)';
  ctx.lineWidth = px(1.1);
  ctx.setLineDash([px(7), px(5)]);
  ctx.stroke(base.counties);
  ctx.setLineDash([]);
  // Ferrocarril con traviesas sutiles (LOD 1).
  if (detail && o.lod >= 1) {
    ctx.strokeStyle = 'rgba(251,241,245,0.55)';
    ctx.lineWidth = px(1.1);
    ctx.stroke(detail.rail);
    ctx.strokeStyle = 'rgba(251,241,245,0.42)';
    ctx.lineWidth = px(5);
    ctx.lineCap = 'butt';
    ctx.setLineDash([px(1.2), px(4.4)]);
    ctx.stroke(detail.rail);
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
  }
  ctx.restore();

  // Agua interior: lagos, ríos, canales y bahías.
  ctx.fillStyle = WATER;
  ctx.fill(base.lakes, 'evenodd');
  ctx.strokeStyle = 'rgba(127,163,217,0.4)';
  ctx.lineWidth = px(0.9);
  ctx.stroke(base.lakes);

  // ---- Red vial en 5 niveles: sendas, callejones, calles, carreteras y autopistas ----
  const strokeRoad = (p: Path2D, casing: number, fill: number, fillColor: string, casingAlpha = 0.55): void => {
    if (casing > 0) {
      ctx.globalAlpha = casingAlpha;
      ctx.strokeStyle = CASING;
      ctx.lineWidth = px(casing);
      ctx.stroke(p);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = px(fill);
    ctx.stroke(p);
  };
  if (detail) {
    if (o.lod >= 1) {
      ctx.setLineDash([px(4), px(3)]);
      ctx.strokeStyle = '#C9A07A';
      ctx.lineWidth = px(1);
      ctx.stroke(detail.dirt);
      ctx.setLineDash([]);
      strokeRoad(detail.roads, 2.8, 1.2, 'rgba(255,236,222,0.72)');
    }
    if (o.lod >= 2) {
      strokeRoad(detail.streets, 0, 0.9, 'rgba(255,236,222,0.6)');
      strokeRoad(detail.alleys, 0, 0.7, 'rgba(244,238,246,0.5)');
    }
  }
  strokeRoad(base.highways, 5, 2.6, AMBER, 0.85);
  if (o.lod >= 2) {
    ctx.strokeStyle = CORAL;
    ctx.lineWidth = px(0.9);
    ctx.stroke(base.highways);
  }
  // Viaductos y puentes sobre el agua: calzada elevada con borde claro.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = CASING;
  ctx.lineWidth = px(7);
  ctx.stroke(base.bridges);
  ctx.strokeStyle = '#FFF1D6';
  ctx.lineWidth = px(4.6);
  ctx.stroke(base.bridges);
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = px(2.4);
  ctx.stroke(base.bridges);
  if (o.lod >= 2) {
    ctx.strokeStyle = CORAL;
    ctx.lineWidth = px(0.9);
    ctx.stroke(base.bridges);
  }
  ctx.lineCap = 'round';
  // Transporte masivo (LOD 1+): Metrorail y Metromover elevados con estaciones.
  if (detail && o.lod >= 1) {
    strokeRoad(detail.metro, 3.4, 1.7, '#C9A6F0', 0.8);
    strokeRoad(detail.mover, 3, 1.4, '#F28BC3', 0.8);
    const dots = (pts: ReadonlyArray<readonly [number, number]>, r: number, fill: string): void => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = CASING;
      ctx.lineWidth = px(1.2);
      for (const [x, y] of pts) {
        if (x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1) continue;
        ctx.beginPath();
        ctx.arc(x, y, px(r), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };
    dots(detail.stationsMetro, 3.2, '#F4EEF6');
    dots(detail.stationsMover, 2.4, '#FFE3F2');
  }
}
