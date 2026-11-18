// P04 - Mapa interactivo de Leonida: lienzo táctico vectorial (SVG) con capas,
// pines, ficha de marcador con check 100% (P04.3) y drawer de hilos (P07.3).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SunsetBanner } from '../components/layout/ViceShell';
import { BottomSheet } from '../components/ui/BottomSheet';
import {
  entityHref,
  MAP_LAYERS,
  MAP_REGIONS,
  SAMPLE_NOTICE,
  forumCategoryLabel,
  markerLayer,
  useForumData,
  useWorldData,
  type MapLayerId,
} from '../data/seed';
import { useProgressStore } from '../store/useProgressStore';
import type { MapMarker } from '../types/database';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BASE_W = 1000;
const ASPECT = 0.7;
const MIN_W = 160;
const INITIAL: ViewBox = { x: 0, y: 0, w: BASE_W, h: BASE_W * ASPECT };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function normalize(v: ViewBox): ViewBox {
  const w = clamp(v.w, MIN_W, BASE_W);
  const h = w * ASPECT;
  return { w, h, x: clamp(v.x, -200, 1200 - w), y: clamp(v.y, -150, 850 - h) };
}

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

function Artwork({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <SunsetBanner className={className} />;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(src)} />;
}

const LAND =
  'M150 200 C160 120 300 90 420 100 C520 70 700 90 800 140 C880 190 900 300 870 400 C850 480 800 540 720 560 C640 580 560 540 480 560 C380 580 300 520 240 470 C170 410 140 300 150 200 Z';

function MapArt() {
  const grid: number[] = [];
  for (let i = 0; i <= 1000; i += 100) grid.push(i);
  return (
    <g>
      <defs>
        <linearGradient id="waterG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1B1033" />
          <stop offset="1" stopColor="#2E1A47" />
        </linearGradient>
        <linearGradient id="landG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B2A6E" />
          <stop offset="1" stopColor="#8A3566" />
        </linearGradient>
      </defs>
      <rect x="-2000" y="-2000" width="5000" height="5000" fill="url(#waterG)" />
      <g stroke="rgba(255,255,255,0.05)" strokeWidth="1">
        {grid.map((n) => (
          <g key={n}>
            <line x1={n} y1="-100" x2={n} y2="800" />
            <line x1="-100" y1={n * 0.7} x2="1100" y2={n * 0.7} />
          </g>
        ))}
      </g>
      <path d={LAND} fill="url(#landG)" stroke="#F69259" strokeOpacity="0.55" strokeWidth="3" />
      <g fill="url(#landG)" stroke="#F69259" strokeOpacity="0.45" strokeWidth="2">
        <ellipse cx="330" cy="610" rx="46" ry="18" />
        <ellipse cx="412" cy="578" rx="40" ry="15" />
        <ellipse cx="372" cy="652" rx="56" ry="16" />
        <ellipse cx="470" cy="620" rx="22" ry="9" />
      </g>
      <g fill="rgba(225,75,123,0.12)" stroke="rgba(246,146,89,0.25)" strokeDasharray="6 6">
        <ellipse cx="260" cy="225" rx="100" ry="70" />
        <ellipse cx="520" cy="160" rx="110" ry="50" />
        <ellipse cx="800" cy="205" rx="70" ry="50" />
        <ellipse cx="765" cy="330" rx="70" ry="60" />
        <ellipse cx="615" cy="365" rx="75" ry="60" />
        <ellipse cx="700" cy="500" rx="75" ry="55" />
      </g>
      <g fill="none" stroke="rgba(251,241,245,0.22)" strokeWidth="2" strokeDasharray="10 8">
        <path d="M200 260 C320 240 460 220 560 290 C640 340 700 360 760 340" />
        <path d="M560 290 C600 400 650 470 700 520" />
        <path d="M520 160 C560 200 560 250 560 290" />
      </g>
    </g>
  );
}

interface MarkerCardProps {
  marker: MapMarker;
  entityTitle: string | null;
  entityId: string | null;
  /** Ruta limpia de la ficha (/catalogo/:modulo/:slug o /guias/:slug) cuando existe. */
  catalogHref: string | null;
  done: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function MarkerCard({ marker, entityTitle, entityId, catalogHref, done, onToggle, onClose }: MarkerCardProps) {
  const { data: forum } = useForumData();
  const threads = forum.threads.filter(
    (t) => t.marker_id === marker.id || (entityId !== null && t.entity_id === entityId),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="h-36 w-full overflow-hidden rounded-xl">
        <Artwork src={marker.media_url} alt={`Foto de ${marker.titulo}`} className="h-full w-full object-cover" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{marker.region}</p>
        <h3 className="font-display text-xl font-bold">{marker.titulo}</h3>
        {marker.descripcion && <p className="mt-1 text-sm text-vice-text/85">{marker.descripcion}</p>}
        <p className="mt-1 text-xs text-vice-text/60">
          Coord. {marker.coord_x.toFixed(2)} · {marker.coord_y.toFixed(2)}
        </p>
      </div>
      {entityTitle && entityId && (
        <a
          href={catalogHref ?? `/catalogo?entity=${entityId}`}
          className="flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
        >
          Ver en catálogo: {entityTitle}
        </a>
      )}
      <button
        type="button"
        aria-pressed={done}
        onClick={onToggle}
        className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
          done ? 'bg-vice-gold text-vice-ink' : 'bg-vice-accent text-vice-ink'
        }`}
      >
        {done ? 'Completado al 100% (quitar)' : 'Marcar como completado'}
      </button>
      <section aria-label="Comentarios contextuales" className="rounded-xl border border-white/10 bg-white/5 p-3">
        <h4 className="font-display text-base font-bold">Hilos ({threads.length})</h4>
        {threads.length === 0 ? (
          <p className="mt-1 text-sm text-vice-text/70">Aún no hay hilos sobre este punto.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {threads.slice(0, 3).map((t) => (
              <li key={t.id} className="text-sm">
                <a
                  href={`/foro?hilo=${t.id}`}
                  className="block min-h-11 rounded-lg px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  <span className="text-xs text-vice-orange">{forumCategoryLabel(t.categoria)}</span>
                  <span className="block font-semibold">{t.titulo}</span>
                  <span className="text-xs text-vice-text/70">▲ {t.upvotes_count}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <a
          href={`/foro?marker=${marker.id}`}
          className="mt-2 flex min-h-11 items-center justify-center rounded-xl bg-white/10 px-4 text-sm font-semibold hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-vice-gold"
        >
          Discutir este punto
        </a>
      </section>
      <button
        type="button"
        onClick={onClose}
        className="hidden min-h-11 rounded-xl text-sm text-vice-text/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold md:block"
      >
        Cerrar ficha
      </button>
    </div>
  );
}

export default function MapPage({ params }: { params: URLSearchParams }) {
  const { data, loading, error } = useWorldData();
  const items = useProgressStore((s) => s.items);
  const toggle = useProgressStore((s) => s.toggle);
  const isDesktop = useIsDesktop();

  const [vb, setVb] = useState<ViewBox>(INITIAL);
  const [active, setActive] = useState<Set<MapLayerId>>(() => new Set(MAP_LAYERS.map((l) => l.id)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [layersOpen, setLayersOpen] = useState(false);
  const [size, setSize] = useState({ w: 1000, h: 700 });

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef({ moved: false, sx: 0, sy: 0, captured: false });
  const pinchRef = useRef(0);

  const entitiesById = useMemo(() => new Map(data.entities.map((e) => [e.id, e])), [data.entities]);
  const modulesById = useMemo(() => new Map(data.modules.map((m) => [m.id, m])), [data.modules]);

  const layered = useMemo(
    () => data.markers.map((m) => ({ marker: m, layer: markerLayer(m, entitiesById, modulesById) })),
    [data.markers, entitiesById, modulesById],
  );
  const layerCount = useMemo(() => {
    const c = new Map<MapLayerId, number>();
    for (const l of layered) c.set(l.layer, (c.get(l.layer) ?? 0) + 1);
    return c;
  }, [layered]);
  const visible = layered.filter((l) => active.has(l.layer));
  const colorOf = (id: MapLayerId): string => MAP_LAYERS.find((l) => l.id === id)?.color ?? '#fff';

  const isDone = (id: string): boolean => items[`marker:${id}`]?.completado === true;
  const doneCount = data.markers.filter((m) => isDone(m.id)).length;

  const selected = data.markers.find((m) => m.id === selectedId) ?? null;
  const selectedEntity = selected?.entity_id ? (entitiesById.get(selected.entity_id) ?? null) : null;
  const selectedModule = selectedEntity ? modulesById.get(selectedEntity.module_id) : undefined;
  const catalogHref = selectedEntity && selectedModule ? entityHref(selectedEntity, selectedModule.slug) : null;

  // ---- Utilidades de vista ---------------------------------------------------
  const toSvg = useCallback((cx: number, cy: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setVb((v) => {
      const w = clamp(v.w * factor, MIN_W, BASE_W);
      const ratio = w / v.w;
      return normalize({ w, h: w * ASPECT, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio });
    });
  }, []);

  const zoomCenter = (factor: number) => zoomAt(factor, vb.x + vb.w / 2, vb.y + vb.h / 2);

  const centerOn = useCallback((px: number, py: number, w = 380) => {
    setVb(normalize({ w, h: w * ASPECT, x: px - w / 2, y: py - (w * ASPECT) / 2 }));
  }, []);

  const select = useCallback(
    (m: MapMarker) => {
      setSelectedId(m.id);
      centerOn(m.coord_x, m.coord_y, Math.min(vb.w, 420));
    },
    [centerOn, vb.w],
  );

  // Rueda: zoom (listener no pasivo para poder evitar el scroll de la página).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      if (p) zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toSvg, zoomAt]);

  // Tamaño del contenedor: los pines mantienen tamaño táctil constante en pantalla.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1000, h: el.clientHeight || 700 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 1000, h: el.clientHeight || 700 });
    return () => ro.disconnect();
  }, []);

  // Parámetros de URL: marker / entity / region.
  const paramKey = params.toString();
  useEffect(() => {
    const markerId = params.get('marker');
    const entityId = params.get('entity');
    const region = params.get('region');
    let target: MapMarker | undefined;
    if (markerId) target = data.markers.find((m) => m.id === markerId);
    else if (entityId) target = data.markers.find((m) => m.entity_id === entityId);
    else if (region) target = data.markers.find((m) => m.region === region);
    if (target) {
      setSelectedId(target.id);
      centerOn(target.coord_x, target.coord_y, 380);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey, data.markers.length]);

  // ---- Interacción por puntero ---------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragRef.current = { moved: false, sx: e.clientX, sy: e.clientY, captured: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinchRef.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (pinchRef.current > 0 && mid && d > 0) zoomAt(pinchRef.current / d, mid.x, mid.y);
      pinchRef.current = d;
      dragRef.current.moved = true;
      return;
    }
    const drag = dragRef.current;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    drag.moved = true;
    if (!drag.captured) {
      svgRef.current?.setPointerCapture(e.pointerId);
      drag.captured = true;
    }
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    const dx = (e.clientX - prev.x) / ctm.a;
    const dy = (e.clientY - prev.y) / ctm.d;
    setVb((v) => normalize({ ...v, x: v.x - dx, y: v.y - dy }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    pinchRef.current = 0;
  };

  const toggleLayer = (id: MapLayerId) =>
    setActive((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const q = query.trim().toLowerCase();
  const results = q
    ? data.markers
        .filter((m) => `${m.titulo} ${m.region}`.toLowerCase().includes(q))
        .slice(0, 6)
    : [];

  const upp = Math.max(vb.w / size.w, vb.h / size.h); // unidades de lienzo por píxel
  const pinR = 11 * upp;
  const hitR = 22 * upp;

  const card = selected && (
    <MarkerCard
      marker={selected}
      entityTitle={selectedEntity?.titulo ?? null}
      entityId={selectedEntity?.id ?? null}
      catalogHref={catalogHref}
      done={isDone(selected.id)}
      onToggle={() => toggle({ markerId: selected.id })}
      onClose={() => setSelectedId(null)}
    />
  );

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none select-none overflow-hidden">
      <svg
        ref={svgRef}
        role="application"
        aria-label="Mapa táctico de Leonida. Arrastra para mover, rueda o botones para acercar."
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedId(null);
        }}
      >
        <MapArt />
        {MAP_REGIONS.map((r) => (
          <text
            key={r.name}
            x={r.x}
            y={r.y}
            textAnchor="middle"
            fontSize="17"
            fontFamily="Jost, sans-serif"
            fontWeight="600"
            letterSpacing="3"
            fill="#FBF1F5"
            fillOpacity="0.55"
            pointerEvents="none"
          >
            {r.name.toUpperCase()}
          </text>
        ))}
        {[...visible]
          .sort((a, b) => Number(a.marker.id === selectedId) - Number(b.marker.id === selectedId))
          .map(({ marker, layer }) => {
            const done = isDone(marker.id);
            const sel = marker.id === selectedId;
            const color = colorOf(layer);
            return (
              <g
                key={marker.id}
                role="button"
                tabIndex={0}
                aria-label={`${marker.titulo}, ${marker.region}${done ? ', completado' : ''}`}
                aria-pressed={sel}
                transform={`translate(${marker.coord_x} ${marker.coord_y})`}
                className="cursor-pointer outline-none focus-visible:[&>circle:first-child]:stroke-[#FFC857]"
                onClick={() => select(marker)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    select(marker);
                  }
                }}
              >
                <circle r={hitR} fill="transparent" stroke="transparent" strokeWidth={2 * upp} />
                {sel && <circle r={pinR * 1.9} fill="none" stroke="#FFC857" strokeWidth={2.5 * upp} />}
                <circle
                  r={pinR}
                  fill={done ? '#FFC857' : color}
                  fillOpacity={done ? 0.95 : 0.9}
                  stroke="#1A0A22"
                  strokeWidth={2 * upp}
                />
                {done && (
                  <path
                    d={`M${-pinR * 0.5} 0 L${-pinR * 0.1} ${pinR * 0.4} L${pinR * 0.55} ${-pinR * 0.4}`}
                    fill="none"
                    stroke="#1A0A22"
                    strokeWidth={2 * upp}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </g>
            );
          })}
      </svg>

      {/* HUD superior izquierdo: rótulo + buscador */}
      <div className="pointer-events-none absolute left-3 right-3 top-2 z-10 flex flex-col gap-2 md:right-auto md:w-80">
        <p className="glass pointer-events-auto w-fit rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide text-vice-orange">
          Cartografía en actualización · LAUNCH READY
        </p>
        <div className="pointer-events-auto relative">
          <label htmlFor="map-search" className="sr-only">
            Buscar marcador o región
          </label>
          <input
            id="map-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar marcador o región…"
            autoComplete="off"
            className="glass min-h-11 w-full rounded-xl px-4 text-base text-vice-text placeholder:text-vice-text/60 focus-visible:outline-2 focus-visible:outline-vice-gold"
          />
          {q && (
            <ul className="glass absolute inset-x-0 top-12 z-20 overflow-hidden rounded-xl" aria-label="Resultados">
              {results.length === 0 && <li className="px-4 py-3 text-sm text-vice-text/70">Sin resultados.</li>}
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full flex-col px-4 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                    onClick={() => {
                      setQuery('');
                      select(m);
                    }}
                  >
                    <span className="font-semibold">{m.titulo}</span>
                    <span className="text-xs text-vice-orange">{m.region}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Capas */}
        <button
          type="button"
          aria-expanded={layersOpen}
          onClick={() => setLayersOpen((v) => !v)}
          className="glass pointer-events-auto min-h-11 w-fit rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold md:hidden"
        >
          Capas del mapa
        </button>
        <fieldset
          className={`glass pointer-events-auto max-h-[46vh] overflow-y-auto rounded-2xl p-3 ${
            layersOpen ? 'block' : 'hidden md:block'
          }`}
        >
          <legend className="sr-only">Capas del mapa</legend>
          <p className="mb-1 px-1 font-display text-sm font-bold tracking-widest text-vice-orange">CAPAS DEL MAPA</p>
          {MAP_LAYERS.map((l) => (
            <label
              key={l.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-white/10"
            >
              <input
                type="checkbox"
                checked={active.has(l.id)}
                onChange={() => toggleLayer(l.id)}
                className="h-5 w-5 accent-[#E1307E]"
              />
              <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: l.color }} />
              <span className="flex-1">{l.label}</span>
              <span className="text-xs text-vice-text/70">{layerCount.get(l.id) ?? 0}</span>
            </label>
          ))}
        </fieldset>
      </div>

      {/* Zoom + estado */}
      <div className="absolute right-3 top-2 z-10 flex flex-col items-end gap-2">
        <div className="glass flex flex-col overflow-hidden rounded-2xl">
          <button
            type="button"
            aria-label="Acercar"
            onClick={() => zoomCenter(1 / 1.4)}
            className="flex h-11 w-11 items-center justify-center text-xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Alejar"
            onClick={() => zoomCenter(1.4)}
            className="flex h-11 w-11 items-center justify-center text-xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Restablecer vista"
            onClick={() => setVb(INITIAL)}
            className="flex h-11 w-11 items-center justify-center text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            1:1
          </button>
        </div>
        <p role="status" className="glass rounded-full px-3 py-1 text-xs">
          {doneCount}/{data.markers.length} completados
        </p>
      </div>

      <p
        role="status"
        className="pointer-events-none absolute bottom-[4.75rem] left-3 z-10 hidden max-w-xs text-xs text-vice-text/75 md:bottom-24 md:block"
      >
        {SAMPLE_NOTICE}
        {loading && ' Cargando desde la API…'}
        {error && ` API no disponible (${error}); usando el seed.`}
      </p>

      {/* Ficha P04.3: panel flotante (escritorio) / Bottom Sheet (móvil) */}
      {selected && isDesktop && (
        <aside
          aria-label="Ficha de marcador"
          className="glass absolute bottom-24 right-3 top-[13rem] z-10 w-[340px] overflow-y-auto rounded-2xl p-4 max-md:hidden"
        >
          {card}
        </aside>
      )}
      <BottomSheet
        open={selected !== null && !isDesktop}
        onClose={() => setSelectedId(null)}
        title={selected?.titulo}
        modal={false}
        className="md:hidden"
      >
        {card}
      </BottomSheet>
    </div>
  );
}
