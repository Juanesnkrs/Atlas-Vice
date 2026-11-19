// Pintor 2D del mapa de Leonida. Dibuja en un <canvas> la pirámide de teselas WebP de
// `public/map-tiles/` (el área cartográfica del mapa comunitario con sus colores originales, ver DesignSpec §6.4).
// Solo se pintan las teselas visibles del nivel `z` adecuado a la escala; mientras una tesela carga se
// dibuja el recorte de su ancestro ya cargado, así no hay huecos al hacer zoom. MapCanvas mueve el bitmap
// con una transformación CSS en cada frame y solo repinta al cargar teselas, cambiar de nivel o alejarse
// del bitmap en caché.

/** Agua: el mismo azul oscuro de las teselas (fondo mientras llegan). */
export const WATER = '#2C68A6';

export interface TileManifest {
  v: number;
  format: 'webp';
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  /** Rectángulo del mundo (lienzo 0–1000 × 0–700) que cubren las teselas. */
  world: { x0: number; y0: number; x1: number; y1: number };
  /** Tamaño en píxeles del mosaico completo en `maxZoom`. */
  maxZoomSize: { width: number; height: number };
  levels: ReadonlyArray<{ z: number; cols: number; rows: number; width: number; height: number }>;
  attribution: string;
}

let manifestPromise: Promise<TileManifest> | null = null;
/** fetch + caché en memoria (una sola petición por sesión); un fallo no se queda cacheado. `no-cache` revalida
 * siempre: un manifiesto viejo de otra pirámide de teselas dejaría el mapa desencajado. */
export function loadTileManifest(): Promise<TileManifest> {
  if (!manifestPromise) {
    const p = fetch('/map-tiles/manifest.json', { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`manifest: ${r.status}`);
      return r.json() as Promise<TileManifest>;
    });
    p.catch(() => {
      if (manifestPromise === p) manifestPromise = null;
    });
    manifestPromise = p;
  }
  return manifestPromise;
}

const MAX_CACHED_TILES = 220;

interface TileEntry {
  img: HTMLImageElement;
  ready: boolean;
}

/** Caché en memoria de teselas (LRU) con carga bajo demanda. */
export class TileStore {
  private readonly cache = new Map<string, TileEntry>();

  constructor(
    readonly manifest: TileManifest,
    private readonly onLoad: () => void,
  ) {}

  /** Píxeles del mosaico por unidad del mundo en `maxZoom` (resolución nativa). */
  get nativePxPerUnit(): number {
    const m = this.manifest;
    return m.maxZoomSize.width / (m.world.x1 - m.world.x0);
  }

  /** Nivel con resolución suficiente para `pxPerUnit` píxeles de bitmap por unidad del mundo. */
  levelFor(pxPerUnit: number): number {
    const m = this.manifest;
    const z = Math.ceil(m.maxZoom + Math.log2(Math.max(pxPerUnit, 1e-6) / this.nativePxPerUnit) - 0.25);
    return Math.min(m.maxZoom, Math.max(m.minZoom, z));
  }

  /** Devuelve la tesela si ya está lista; si no, la pide (una sola vez) y devuelve null. */
  get(z: number, x: number, y: number, request = true): HTMLImageElement | null {
    const key = `${z}/${x}/${y}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.ready ? hit.img : null;
    }
    if (!request) return null;
    const lv = this.manifest.levels.find((l) => l.z === z);
    if (!lv || x < 0 || y < 0 || x >= lv.cols || y >= lv.rows) return null;
    const entry: TileEntry = { img: new Image(), ready: false };
    entry.img.decoding = 'async';
    entry.img.onload = () => {
      entry.ready = true;
      this.onLoad();
    };
    entry.img.onerror = () => {
      this.cache.delete(key);
    };
    entry.img.src = `/map-tiles/${z}/${x}/${y}.webp?v=${this.manifest.v}`;
    this.cache.set(key, entry);
    if (this.cache.size > MAX_CACHED_TILES) {
      const keep = this.manifest.minZoom + 1;
      for (const [k, e] of this.cache) {
        if (this.cache.size <= MAX_CACHED_TILES) break;
        if (e.ready && Number(k.split('/')[0]) > keep) this.cache.delete(k);
      }
    }
    return null;
  }

  /** Precarga los niveles más bajos: sirven de respaldo mientras llegan las teselas finas. */
  preloadCoarse(): void {
    const m = this.manifest;
    for (const lv of m.levels) {
      if (lv.z > m.minZoom + 1) continue;
      for (let y = 0; y < lv.rows; y++) for (let x = 0; x < lv.cols; x++) this.get(lv.z, x, y);
    }
  }
}

export interface PaintOpts {
  /** Rectángulo del mundo que cubre el bitmap. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Píxeles del bitmap por unidad del mundo. */
  sx: number;
  sy: number;
  /** Nivel de teselas a dibujar. */
  z: number;
}

/** Pinta el océano y las teselas visibles del nivel `o.z` con respaldo de niveles inferiores. */
export function paintTiles(ctx: CanvasRenderingContext2D, store: TileStore | null, o: PaintOpts): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = WATER;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!store) return;
  const m = store.manifest;
  const T = m.tileSize;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const lv = m.levels.find((l) => l.z === o.z);
  if (!lv) return;
  // unidades del mundo por tesela en este nivel
  const ws = T * ((m.world.x1 - m.world.x0) / m.maxZoomSize.width) * Math.pow(2, m.maxZoom - o.z);
  const tx0 = Math.max(0, Math.floor((o.x0 - m.world.x0) / ws));
  const tx1 = Math.min(lv.cols - 1, Math.floor((o.x1 - m.world.x0) / ws));
  const ty0 = Math.max(0, Math.floor((o.y0 - m.world.y0) / ws));
  const ty1 = Math.min(lv.rows - 1, Math.floor((o.y1 - m.world.y0) / ws));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      // destino en píxeles del bitmap, ensanchado 1 px para que no asomen costuras entre teselas
      const dx = Math.floor((m.world.x0 + tx * ws - o.x0) * o.sx);
      const dy = Math.floor((m.world.y0 + ty * ws - o.y0) * o.sy);
      const dw = Math.ceil((m.world.x0 + (tx + 1) * ws - o.x0) * o.sx) - dx + 1;
      const dh = Math.ceil((m.world.y0 + (ty + 1) * ws - o.y0) * o.sy) - dy + 1;
      const img = store.get(o.z, tx, ty);
      if (img) {
        ctx.drawImage(img, dx, dy, dw, dh);
        continue;
      }
      // respaldo: recorte del ancestro más cercano ya cargado (z-1, z-2…)
      for (let d = 1; o.z - d >= m.minZoom; d++) {
        const anc = store.get(o.z - d, tx >> d, ty >> d, d <= 1);
        if (!anc) continue;
        const span = T / Math.pow(2, d);
        ctx.drawImage(anc, (tx - ((tx >> d) << d)) * span, (ty - ((ty >> d) << d)) * span, span, span, dx, dy, dw, dh);
        break;
      }
    }
  }
}
