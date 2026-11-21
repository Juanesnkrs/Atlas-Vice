// Motor del mapa de Leonida (P04): teselas en <canvas> + capa interactiva SVG propia + requestAnimationFrame.
// - La transformación {x, y, scale} vive en una ref y se aplica por DOM en cada frame: arrastrar,
//   hacer zoom, la inercia y los vuelos NO provocan renders de React.
// - React solo se renderiza cuando cambia el nivel de zoom (clustering) o el viewport sale del
//   rectángulo ya pintado (culling), es decir, de forma esporádica.
// - Trazos con vector-effect: non-scaling-stroke y rótulos/pines a tamaño constante en pantalla
//   mediante la variable CSS --k (= 1 / escala).
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { ISLAND_BBOX, MAP_H, MAP_W } from '../../data/leonidaMap';
import { loadTileManifest, paintTiles, TileStore, WATER, type TileManifest } from './mapPaint';

export interface MapPin {
  id: string;
  x: number;
  y: number;
  color: string;
  done: boolean;
  label: string;
}

export interface MapInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface MapCanvasHandle {
  /** Centra el mundo (x, y). `zoom` es relativo al encuadre completo (1 = isla entera). `lift` desplaza el centro hacia arriba (px). */
  flyTo(x: number, y: number, opts?: { zoom?: number; lift?: number }): void;
  zoomBy(factor: number): void;
  reset(): void;
  toWorld(clientX: number, clientY: number): { x: number; y: number } | null;
}

/** Calca de referencia: imagen colocada en unidades del mapa. */
export interface MapRefOverlay {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cropW: number;
  opacity: number;
  onError?: () => void;
}
/** Trazador SVG: puntos en coordenadas del mapa. */
export interface MapTracer {
  points: ReadonlyArray<readonly [number, number]>;
  closed: boolean;
}

export interface MapCanvasProps {
  ref?: Ref<MapCanvasHandle>;
  /** Calca de referencia bajo los pines (solo Modo Editor). */
  refOverlay?: MapRefOverlay | null;
  /** Vista previa en vivo del trazador SVG. */
  tracer?: MapTracer | null;
  pins: ReadonlyArray<MapPin>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Clic en el fondo (no arrastre) con coordenadas del mundo, redondeadas a 2 decimales. */
  onBackgroundClick?: (world: { x: number; y: number }) => void;
  /** Mira del editor. */
  crosshair?: { x: number; y: number } | null;
  /** Modo editor: el pin `pinId` se puede arrastrar y al soltarlo se llama a `onMove`. */
  /** Trazador activo: el clic va siempre al lienzo (añade vértices) y nunca selecciona ni abre pines. */
  captureClicks?: boolean;
  editable?: {
    pinId: string | null;
    /** Si devuelve (una promesa de) false, el pin vuelve a su posición original. */
    onMove: (id: string, x: number, y: number) => void | boolean | Promise<boolean>;
  };
  /** Zona del contenedor tapada por la interfaz (px); el encuadre usa el espacio libre. */
  insets?: MapInsets;
  ariaLabel: string;
  className?: string;
}

// ---- Constantes del motor ---------------------------------------------------------------------------
const FIT_MARGIN_PX = 14;
/** Aire alrededor de la isla al encuadrar (unidades del mapa). */
const FIT_PAD_UNITS = 16;
const BBOX_W = ISLAND_BBOX.x1 - ISLAND_BBOX.x0;
const BBOX_H = ISLAND_BBOX.y1 - ISLAND_BBOX.y0;
const BBOX_CX = (ISLAND_BBOX.x0 + ISLAND_BBOX.x1) / 2;
const BBOX_CY = (ISLAND_BBOX.y0 + ISLAND_BBOX.y1) / 2;
/** DPR máximo del bitmap: más bajo en táctil para evitar picos de rasterización. */
const DPR_MAX_DESKTOP = 2;
const DPR_MAX_TOUCH = 2.5;
/** Margen de sobre-dibujo del bitmap (fracción del viewport por lado). */
const BG_MARGIN_DESKTOP = 0.22;
const BG_MARGIN_TOUCH = 0.15;
const MAX_REL_ZOOM = 14;
const MIN_REL_ZOOM = 0.9;
const WORLD_PAD = 80;
const CELL_PX = 40;
const NO_CLUSTER_LEVEL = 6;
const DRAG_THRESHOLD_PX = 5;

interface Transform {
  x: number;
  y: number;
  s: number;
}
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface ViewState {
  level: number;
  rect: Rect;
}
interface Fly {
  t0: number;
  dur: number;
  s0: number;
  s1: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  sx: number;
  sy: number;
}

type Item =
  | { kind: 'pin'; pin: MapPin }
  | { kind: 'cluster'; key: string; x: number; y: number; count: number };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;
const pxPos = (x: number, y: number): string => `translate(${x}px, ${y}px) scale(var(--k))`;

/** Agrupa por rejilla (celda ~CELL_PX en pantalla, escalonada a medias octavas) tras el culling. */
function buildItems(pins: ReadonlyArray<MapPin>, view: ViewState, selectedId: string | null, fit: number): Item[] {
  const { rect, level } = view;
  const inRect = (p: MapPin): boolean => p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1;
  const vis = pins.filter((p) => p.id === selectedId || inRect(p));
  const items: Item[] = [];
  if (level >= NO_CLUSTER_LEVEL) {
    for (const p of vis) items.push({ kind: 'pin', pin: p });
  } else {
    const cell = CELL_PX / (fit * Math.pow(2, level / 2));
    const buckets = new Map<string, MapPin[]>();
    for (const p of vis) {
      if (p.id === selectedId) {
        items.push({ kind: 'pin', pin: p });
        continue;
      }
      const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
      const b = buckets.get(k);
      if (b) b.push(p);
      else buckets.set(k, [p]);
    }
    for (const [k, b] of buckets) {
      if (b.length === 1) items.push({ kind: 'pin', pin: b[0]! });
      else {
        const x = b.reduce((a, p) => a + p.x, 0) / b.length;
        const y = b.reduce((a, p) => a + p.y, 0) / b.length;
        items.push({ kind: 'cluster', key: `c:${level}:${k}`, x, y, count: b.length });
      }
    }
  }
  // El seleccionado se pinta el último (encima del resto).
  const isSel = (i: Item): number => Number(i.kind === 'pin' && i.pin.id === selectedId);
  return items.sort((a, b) => isSel(a) - isSel(b));
}

// ---- Capas estáticas (React.memo: no se re-renderizan jamás) -------------------------------------------------
const CSS = `
[data-capture="1"] .lm-pin{pointer-events:none}
.lm-pin{cursor:pointer;outline:none}
.lm-pin:focus-visible .lm-ring,[data-sel="1"] .lm-ring{stroke:#FFC857;opacity:1}
.lm-ring{fill:none;stroke:transparent;stroke-width:2.5;opacity:0}
@keyframes lm-pulse{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(2.4)}}
.lm-pulse{transform-origin:0 0;animation:lm-pulse 1.4s ease-out infinite}
@media (prefers-reduced-motion:reduce){.lm-pulse{animation:none}}
`;

const NS = { vectorEffect: 'non-scaling-stroke' } as const;

/** Calca de referencia (Modo Editor): imagen local alineada al lienzo, bajo los pines. */
const RefOverlay = memo(function RefOverlay({ data: r }: { data: MapRefOverlay }) {
  const cw = r.w * r.cropW;
  return (
    <g style={{ pointerEvents: 'none' }} opacity={r.opacity}>
      <svg x={r.x} y={r.y} width={cw} height={r.h} viewBox={`0 0 ${r.cropW} 1`} preserveAspectRatio="none" overflow="hidden">
        <image href={r.src} x={0} y={0} width={1} height={1} preserveAspectRatio="none" onError={r.onError} />
      </svg>
    </g>
  );
});

/** Trazo en curso del trazador SVG: puntos, línea de vista previa y cierre opcional. */
const TracerOverlay = memo(function TracerOverlay({ tracer }: { tracer: MapTracer }) {
  const { points, closed } = tracer;
  if (points.length === 0) return null;
  const d = `M${points.map((p) => `${p[0]} ${p[1]}`).join('L')}${closed && points.length > 2 ? 'Z' : ''}`;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {closed && points.length > 2 && <path d={d} fill="rgba(94,214,224,0.18)" stroke="none" />}
      <path d={d} fill="none" stroke="#1A0A22" strokeOpacity={0.8} strokeWidth={4} strokeLinejoin="round" {...NS} />
      <path d={d} fill="none" stroke="#5ED6E0" strokeWidth={1.8} strokeLinejoin="round" {...NS} />
      {points.map((p, i) => (
        <g key={i} style={{ transform: pxPos(p[0], p[1]) }}>
          <circle r={3.6} fill={i === 0 ? '#FFC857' : '#5ED6E0'} stroke="#1A0A22" strokeWidth={1.2} />
        </g>
      ))}
    </g>
  );
});

// ---- Componente ---------------------------------------------------------------------------------------------------
export function MapCanvas({ ref, refOverlay, tracer, captureClicks, pins, selectedId, onSelect, onBackgroundClick, crosshair, editable, insets, ariaLabel, className = '' }: MapCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);

  const cur = useRef<Transform>({ x: 0, y: 0, s: 1 });
  const size = useRef({ w: 0, h: 0 });
  const fit = useRef(1);
  const touched = useRef(false);
  const viewRef = useRef<ViewState | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [fitState, setFitState] = useState(1);

  // Pirámide de teselas: el manifiesto se pide al entrar; las teselas, bajo demanda.
  const tileStore = useRef<TileStore | null>(null);
  const [manifest, setManifest] = useState<TileManifest | null>(null);
  useEffect(() => {
    let live = true;
    loadTileManifest()
      .then((m) => live && setManifest(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Props leídas desde el bucle de animación sin re-crear callbacks.
  const insetsRef = useRef<Required<MapInsets>>({ top: 0, right: 0, bottom: 0, left: 0 });
  insetsRef.current = { top: insets?.top ?? 0, right: insets?.right ?? 0, bottom: insets?.bottom ?? 0, left: insets?.left ?? 0 };
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const onBgRef = useRef(onBackgroundClick);
  onBgRef.current = onBackgroundClick;

  const anim = useRef({ raf: 0, last: 0, vx: 0, vy: 0, zoom: null as { s: number; sx: number; sy: number } | null, fly: null as Fly | null });
  const reduced = useRef(false);

  const freeArea = useCallback(() => {
    const i = insetsRef.current;
    const { w, h } = size.current;
    const fw = Math.max(40, w - i.left - i.right);
    const fh = Math.max(40, h - i.top - i.bottom);
    return { cx: i.left + fw / 2, cy: i.top + fh / 2, fw, fh };
  }, []);

  const bounds = useCallback(
    (s: number) => {
      const { w, h } = size.current;
      const f = freeArea();
      const cw = BBOX_W * s;
      const ch = BBOX_H * s;
      const pad = WORLD_PAD * s;
      // t = posición en pantalla del origen del mundo; la isla ocupa [bx0*s + t, bx1*s + t]
      const range = (view: number, content: number, centre: number, w0: number, wc: number): [number, number] =>
        content + 2 * pad <= view ? [centre - wc * s, centre - wc * s] : [view - (w0 * s + content) - pad, pad - w0 * s];
      const [x0, x1] = range(w, cw, f.cx, ISLAND_BBOX.x0, BBOX_CX);
      const [y0, y1] = range(h, ch, f.cy, ISLAND_BBOX.y0, BBOX_CY);
      return { x0, x1, y0, y1 };
    },
    [freeArea],
  );

  const clampT = useCallback(
    (t: Transform) => {
      const f = fit.current;
      t.s = clamp(t.s, f * MIN_REL_ZOOM, f * MAX_REL_ZOOM);
      const b = bounds(t.s);
      t.x = clamp(t.x, b.x0, b.x1);
      t.y = clamp(t.y, b.y0, b.y1);
    },
    [bounds],
  );

  // ---- Teselas en <canvas>: bitmap en caché movido por CSS; se repinta solo si hace falta ----------------------------------
  const bgRef = useRef<HTMLCanvasElement>(null);
  const bgState = useRef<{ x0: number; y0: number; x1: number; y1: number; s: number; z: number } | null>(null);
  const bgTimer = useRef(0);
  const bgRaf = useRef(0);

  const isTouch = (): boolean => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const bitmapDpr = (cssW: number, cssH: number): number =>
    Math.min(isTouch() ? DPR_MAX_TOUCH : DPR_MAX_DESKTOP, window.devicePixelRatio || 1, 6144 / cssW, 6144 / cssH);

  const placeBg = useCallback(() => {
    const cv = bgRef.current;
    const st = bgState.current;
    if (!cv || !st) return;
    const { x, y, s } = cur.current;
    cv.style.transform = `translate3d(${x + st.x0 * s}px, ${y + st.y0 * s}px, 0) scale(${s / st.s})`;
  }, []);

  const renderBg = useCallback(() => {
    const cv = bgRef.current;
    if (!cv || size.current.w === 0) return;
    const { x, y, s } = cur.current;
    const { w, h } = size.current;
    const margin = isTouch() ? BG_MARGIN_TOUCH : BG_MARGIN_DESKTOP;
    const mx = (w * margin) / s;
    const my = (h * margin) / s;
    const R = { x0: -x / s - mx, y0: -y / s - my, x1: (w - x) / s + mx, y1: (h - y) / s + my };
    const cssW = (R.x1 - R.x0) * s;
    const cssH = (R.y1 - R.y0) * s;
    const dpr = bitmapDpr(cssW, cssH);
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    cv.style.width = `${cssW}px`;
    cv.style.height = `${cssH}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const store = tileStore.current;
    const sx = pw / (R.x1 - R.x0);
    const z = store ? store.levelFor(sx) : 0;
    paintTiles(ctx, store, { ...R, sx, sy: ph / (R.y1 - R.y0), z });
    bgState.current = { ...R, s, z };
    placeBg();
  }, [placeBg]);

  const flushBg = useCallback(() => {
    clearTimeout(bgTimer.current);
    if (bgRaf.current) return;
    bgRaf.current = requestAnimationFrame(() => {
      bgRaf.current = 0;
      renderBg();
    });
  }, [renderBg]);
  const settleBg = useCallback(() => {
    clearTimeout(bgTimer.current);
    bgTimer.current = window.setTimeout(flushBg, 160);
  }, [flushBg]);

  /** Escribe la transformación en el DOM y, solo si cambia el nivel/rect, avisa a React. */
  const apply = useCallback(() => {
    const g = worldRef.current;
    const svg = svgRef.current;
    if (!g || !svg || size.current.w === 0) return;
    const { x, y, s } = cur.current;
    g.setAttribute('transform', `translate(${x} ${y}) scale(${s})`);
    svg.style.setProperty('--k', String(1 / s));
    const rel = s / fit.current;
    placeBg();

    const level = Math.floor(Math.log2(Math.max(rel, 0.01)) * 2);
    const { w, h } = size.current;
    const vr: Rect = { x0: -x / s, y0: -y / s, x1: (w - x) / s, y1: (h - y) / s };
    const store = tileStore.current;
    if (store) {
      const st = bgState.current;
      if (!st) flushBg();
      else if (vr.x0 < st.x0 || vr.y0 < st.y0 || vr.x1 > st.x1 || vr.y1 > st.y1) flushBg();
      else if (Math.abs(s / st.s - 1) > 0.04) {
        // otro nivel de teselas o escala muy distinta: se repinta al parar el gesto
        const bw = (st.x1 - st.x0) * s;
        if (store.levelFor(s * bitmapDpr(bw, (st.y1 - st.y0) * s)) !== st.z || Math.abs(s / st.s - 1) > 0.25) settleBg();
      }
    }
    const v = viewRef.current;
    const inside = v && v.level === level && vr.x0 >= v.rect.x0 && vr.y0 >= v.rect.y0 && vr.x1 <= v.rect.x1 && vr.y1 <= v.rect.y1;
    if (!inside) {
      const mx = (vr.x1 - vr.x0) * 0.6;
      const my = (vr.y1 - vr.y0) * 0.6;
      const nv: ViewState = { level, rect: { x0: vr.x0 - mx, y0: vr.y0 - my, x1: vr.x1 + mx, y1: vr.y1 + my } };
      viewRef.current = nv;
      setView(nv);
    }
  }, [placeBg, flushBg, settleBg]);

  // Al llegar el manifiesto se crea la caché de teselas; cada tesela cargada repinta el bitmap.
  useEffect(() => {
    if (!manifest) return;
    const store = new TileStore(manifest, () => {
      clearTimeout(bgTimer.current);
      bgTimer.current = window.setTimeout(flushBg, 120);
    });
    tileStore.current = store;
    bgState.current = null;
    store.preloadCoarse();
    flushBg();
    return () => {
      tileStore.current = null;
    };
  }, [manifest, flushBg]);
  useEffect(
    () => () => {
      clearTimeout(bgTimer.current);
      cancelAnimationFrame(bgRaf.current);
    },
    [],
  );

  const frame = useCallback(
    (now: number) => {
      const a = anim.current;
      a.raf = 0;
      const dt = Math.min(64, Math.max(1, now - (a.last || now)));
      a.last = now;
      let active = false;
      const c = cur.current;
      if (a.fly) {
        const f = a.fly;
        const t = f.dur <= 0 ? 1 : Math.min(1, (now - f.t0) / f.dur);
        const e = 1 - Math.pow(1 - t, 3);
        const s = Math.exp(Math.log(f.s0) + (Math.log(f.s1) - Math.log(f.s0)) * e);
        const wx = f.cx0 + (f.cx1 - f.cx0) * e;
        const wy = f.cy0 + (f.cy1 - f.cy0) * e;
        c.s = s;
        c.x = f.sx - wx * s;
        c.y = f.sy - wy * s;
        if (t >= 1) a.fly = null;
        else active = true;
      } else {
        if (a.zoom) {
          const z = a.zoom;
          let ns = c.s + (z.s - c.s) * (1 - Math.exp(-dt / 70));
          if (reduced.current || Math.abs(ns - z.s) < z.s * 0.002) {
            ns = z.s;
            a.zoom = null;
          } else active = true;
          const wx = (z.sx - c.x) / c.s;
          const wy = (z.sy - c.y) / c.s;
          c.s = ns;
          c.x = z.sx - wx * ns;
          c.y = z.sy - wy * ns;
        }
        if (a.vx !== 0 || a.vy !== 0) {
          c.x += a.vx * dt;
          c.y += a.vy * dt;
          const k = Math.exp(-dt / 260);
          a.vx *= k;
          a.vy *= k;
          if (Math.hypot(a.vx, a.vy) < 0.02) a.vx = a.vy = 0;
          else active = true;
        }
      }
      clampT(c);
      apply();
      if (active) a.raf = requestAnimationFrame(frame);
    },
    [apply, clampT],
  );

  const kick = useCallback(() => {
    const a = anim.current;
    if (a.raf) return;
    a.last = performance.now();
    a.raf = requestAnimationFrame(frame);
  }, [frame]);

  const stopMotion = useCallback(() => {
    const a = anim.current;
    a.fly = null;
    a.zoom = null;
    a.vx = a.vy = 0;
  }, []);

  const fitTransform = useCallback((): Transform => {
    const f = freeArea();
    const s = Math.max(0.05, Math.min((f.fw - 2 * FIT_MARGIN_PX) / (BBOX_W + 2 * FIT_PAD_UNITS), (f.fh - 2 * FIT_MARGIN_PX) / (BBOX_H + 2 * FIT_PAD_UNITS)));
    return { s, x: f.cx - BBOX_CX * s, y: f.cy - BBOX_CY * s };
  }, [freeArea]);

  const toWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg || size.current.w === 0) return null;
    const r = svg.getBoundingClientRect();
    const { x, y, s } = cur.current;
    return { x: (clientX - r.left - x) / s, y: (clientY - r.top - y) / s };
  }, []);

  const flyTo = useCallback(
    (wx: number, wy: number, opts: { zoom?: number; lift?: number } = {}) => {
      stopMotion();
      touched.current = true;
      const f = freeArea();
      const c = cur.current;
      const s1 = clamp(fit.current * (opts.zoom ?? c.s / fit.current), fit.current * MIN_REL_ZOOM, fit.current * MAX_REL_ZOOM);
      const sx = f.cx;
      const sy = f.cy - (opts.lift ?? 0);
      anim.current.fly = {
        t0: performance.now(),
        dur: reduced.current ? 0 : 480,
        s0: c.s,
        s1,
        cx0: (sx - c.x) / c.s,
        cy0: (sy - c.y) / c.s,
        cx1: wx,
        cy1: wy,
        sx,
        sy,
      };
      kick();
    },
    [freeArea, kick, stopMotion],
  );

  const zoomAround = useCallback(
    (factor: number, sx: number, sy: number) => {
      touched.current = true;
      const a = anim.current;
      a.fly = null;
      a.vx = a.vy = 0;
      const base = a.zoom?.s ?? cur.current.s;
      a.zoom = { s: clamp(base * factor, fit.current * MIN_REL_ZOOM, fit.current * MAX_REL_ZOOM), sx, sy };
      kick();
    },
    [kick],
  );

  useImperativeHandle(
    ref,
    () => ({
      flyTo,
      zoomBy: (factor: number) => {
        const f = freeArea();
        zoomAround(factor, f.cx, f.cy);
      },
      reset: () => {
        stopMotion();
        touched.current = false;
        const t = fitTransform();
        const c = cur.current;
        const f = freeArea();
        anim.current.fly = {
          t0: performance.now(),
          dur: reduced.current ? 0 : 480,
          s0: c.s,
          s1: t.s,
          cx0: (f.cx - c.x) / c.s,
          cy0: (f.cy - c.y) / c.s,
          cx1: BBOX_CX,
          cy1: BBOX_CY,
          sx: f.cx,
          sy: f.cy,
        };
        kick();
      },
      toWorld,
    }),
    [flyTo, freeArea, zoomAround, stopMotion, fitTransform, kick, toWorld],
  );

  // Tamaño del contenedor: encuadre inicial y reajuste de límites.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const measure = () => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      if (size.current.w === 0 || size.current.h === 0) return;
      const t = fitTransform();
      fit.current = t.s;
      setFitState(t.s);
      if (!touched.current) cur.current = t;
      else clampT(cur.current);
      viewRef.current = null;
      bgState.current = null;
      apply();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [apply, clampT, fitTransform]);

  // Si cambian los insets (p. ej. al abrir una hoja) y el usuario no ha tocado el mapa, se reencuadra.
  const insetKey = `${insets?.top ?? 0}|${insets?.right ?? 0}|${insets?.bottom ?? 0}|${insets?.left ?? 0}`;
  useEffect(() => {
    if (size.current.w === 0 || touched.current) return;
    const t = fitTransform();
    fit.current = t.s;
    setFitState(t.s);
    cur.current = t;
    viewRef.current = null;
    apply();
  }, [insetKey, apply, fitTransform]);

  useEffect(() => () => cancelAnimationFrame(anim.current.raf), []);

  // Rueda: zoom suave anclado al cursor (listener no pasivo para bloquear el scroll de la página).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016));
      const r = svg.getBoundingClientRect();
      zoomAround(factor, e.clientX - r.left, e.clientY - r.top);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  // ---- Punteros: arrastre, pinch, inercia y arrastre de pin (editor) -------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef({
    moved: false,
    pinched: false,
    captured: false,
    sx: 0,
    sy: 0,
    lastT: 0,
    vx: 0,
    vy: 0,
    pinch: 0,
    midX: 0,
    midY: 0,
    pin: null as null | { id: string; el: SVGElement; x: number; y: number; ox: number; oy: number },
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopMotion();
    touched.current = true;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (pointers.current.size === 1) {
      d.moved = false;
      d.pinched = false;
      d.captured = false;
      d.vx = d.vy = 0;
      d.pin = null;
      d.sx = e.clientX;
      d.sy = e.clientY;
      d.lastT = e.timeStamp;
      const el = (e.target as Element).closest('[data-pin]') as SVGElement | null;
      const ed = editableRef.current;
      const orig = ed && ed.pinId !== null ? pinsRef.current.find((p) => p.id === ed.pinId) : undefined;
      if (ed && el && orig && el.dataset.pin === ed.pinId) d.pin = { id: orig.id, el, x: orig.x, y: orig.y, ox: orig.x, oy: orig.y };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      d.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      d.midX = (a.x + b.x) / 2;
      d.midY = (a.y + b.y) / 2;
      d.pinched = true;
      d.moved = true;
      d.pin = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const c = cur.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      c.x += mx - d.midX;
      c.y += my - d.midY;
      if (d.pinch > 0 && dist > 0) {
        const ns = clamp(c.s * (dist / d.pinch), fit.current * MIN_REL_ZOOM, fit.current * MAX_REL_ZOOM);
        const sx = mx - rect.left;
        const sy = my - rect.top;
        const wx = (sx - c.x) / c.s;
        const wy = (sy - c.y) / c.s;
        c.s = ns;
        c.x = sx - wx * ns;
        c.y = sy - wy * ns;
      }
      d.pinch = dist;
      d.midX = mx;
      d.midY = my;
      clampT(c);
      kick();
      return;
    }
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    if (d.pin) {
      const w = toWorld(e.clientX, e.clientY);
      if (w) {
        d.pin.x = clamp(w.x, 0, MAP_W);
        d.pin.y = clamp(w.y, 0, MAP_H);
        d.pin.el.style.transform = pxPos(d.pin.x, d.pin.y);
      }
      return;
    }
    if (!d.captured) {
      svgRef.current?.setPointerCapture(e.pointerId);
      d.captured = true;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.vx = 0.6 * d.vx + 0.4 * (dx / dt);
    d.vy = 0.6 * d.vy + 0.4 * (dy / dt);
    d.lastT = e.timeStamp;
    c.x += dx;
    c.y += dy;
    clampT(c);
    kick();
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (pointers.current.size === 1) {
      // Al soltar un dedo del pinch, el otro sigue arrastrando desde su posición actual.
      const [p] = [...pointers.current.values()] as [{ x: number; y: number }];
      d.sx = p.x;
      d.sy = p.y;
      d.pinch = 0;
      return;
    }
    if (pointers.current.size > 0) return;
    if (d.pin && d.moved) {
      const ed = editableRef.current;
      const { id, el, ox, oy } = d.pin;
      void Promise.resolve(ed?.onMove(id, round2(d.pin.x), round2(d.pin.y))).then((ok) => {
        if (ok === false) el.style.transform = pxPos(ox, oy);
      });
      d.pin = null;
      return;
    }
    if (d.moved && !d.pinched && !reduced.current && e.timeStamp - d.lastT < 90 && Math.hypot(d.vx, d.vy) > 0.05) {
      anim.current.vx = d.vx;
      anim.current.vy = d.vy;
      kick();
    }
  };

  // ---- Render de pines/clusters --------------------------------------------------------------------------------------------
  const items = useMemo(() => (view ? buildItems(pins, view, selectedId, fitState) : []), [pins, view, selectedId, fitState]);

  const zoomIntoCluster = (x: number, y: number) => {
    const c = cur.current;
    flyTo(x, y, { zoom: Math.min(MAX_REL_ZOOM, (c.s / fit.current) * 2.4) });
  };

  const activate = (e: React.KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div ref={wrapRef} className={`absolute inset-0 touch-none select-none overflow-hidden ${className}`} style={{ background: WATER }}>
      <canvas ref={bgRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0" style={{ transformOrigin: '0 0', willChange: 'transform' }} />
      <svg
        ref={svgRef}
        role="application"
        aria-label={ariaLabel}
        data-capture={captureClicks ? '1' : undefined}
        className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          if (drag.current.moved) e.stopPropagation();
        }}
        onClick={(e) => {
          if ((e.target as Element).closest('[data-pin],[data-cluster]')) return;
          const w = toWorld(e.clientX, e.clientY);
          if (w && onBgRef.current) onBgRef.current({ x: round2(clamp(w.x, 0, MAP_W)), y: round2(clamp(w.y, 0, MAP_H)) });
        }}
      >
        <style>{CSS}</style>
        <g ref={worldRef}>
          
          {refOverlay && <RefOverlay data={refOverlay} />}
          {tracer && <TracerOverlay tracer={tracer} />}
          {crosshair && (
            <g data-cross style={{ transform: pxPos(crosshair.x, crosshair.y), pointerEvents: 'none' }}>
              <circle className="lm-pulse" r={14} fill="none" stroke="#FFC857" strokeWidth={2} />
              <circle r={14} fill="rgba(255,200,87,0.12)" stroke="#FFC857" strokeWidth={2} />
              <path d="M-22 0H-6M6 0H22M0-22V-6M0 6V22" stroke="#FFC857" strokeWidth={2} strokeLinecap="round" />
              <circle r={2} fill="#FFC857" />
            </g>
          )}
          {items.map((it) => {
            if (it.kind === 'cluster') {
              return (
                <g
                  key={it.key}
                  data-cluster
                  role="button"
                  tabIndex={0}
                  aria-label={`${it.count} lugares agrupados. Acercar para verlos`}
                  className="lm-pin"
                  style={{ transform: pxPos(it.x, it.y) }}
                  onClick={() => zoomIntoCluster(it.x, it.y)}
                  onKeyDown={(e) => activate(e, () => zoomIntoCluster(it.x, it.y))}
                >
                  <circle r={22} fill="transparent" />
                  <circle r={17} fill="rgba(20,14,36,0.88)" stroke="#F69259" strokeWidth={2} />
                  <circle className="lm-ring" r={21} />
                  <text textAnchor="middle" dy="0.36em" fontSize={13} fontWeight={700} fontFamily="Jost, sans-serif" fill="#FBF1F5" pointerEvents="none">
                    {it.count}
                  </text>
                </g>
              );
            }
            const p = it.pin;
            const sel = p.id === selectedId;
            return (
              <g
                key={p.id}
                data-pin={p.id}
                data-sel={sel ? '1' : '0'}
                role="button"
                tabIndex={0}
                aria-label={p.label}
                aria-pressed={sel}
                className="lm-pin"
                style={{ transform: pxPos(p.x, p.y) }}
                onClick={() => onSelect(p.id)}
                onKeyDown={(e) => activate(e, () => onSelect(p.id))}
              >
                <circle r={22} fill="transparent" />
                <circle className="lm-ring" r={20} />
                <circle r={11} fill={p.done ? '#FFC857' : p.color} fillOpacity={0.95} stroke="#1A0A22" strokeWidth={2} />
                {p.done && <path d="M-5.5 0L-1.2 4.4L5.8-4.4" fill="none" stroke="#1A0A22" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
