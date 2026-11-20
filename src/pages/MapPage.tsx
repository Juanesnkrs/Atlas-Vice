// P04 - Mapa interactivo de Leonida: motor SVG propio (MapCanvas) sobre cartografía vectorial original,
// filtros combinados sincronizados con la URL, buscador instantáneo, ficha de marcador con check 100%
// (P04.3), drawer de hilos (P07.3) y Modo Editor de coordenadas para ADMIN+.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SunsetBanner } from '../components/layout/ViceShell';
import { BottomSheet } from '../components/ui/BottomSheet';
import { MapCanvas, type MapCanvasHandle, type MapPin, type MapRefOverlay, type MapTracer } from '../components/ui/MapCanvas';
import { PalmButton } from '../components/ui/PalmButton';
import { REF_IMAGES } from '../data/leonidaMap';
import {
  entityHref,
  entitySlug,
  slugify,
  MAP_LAYERS,
  SAMPLE_NOTICE,
  forumCategoryLabel,
  markerLayer,
  useForumData,
  useWorldData,
  type MapLayerId,
} from '../data/seed';
import { apiFetch, ApiError, useAuthStore } from '../store/useAuthStore';
import { navigate } from '../store/useRouteStore';
import { useProgressStore } from '../store/useProgressStore';
import type { Entity, MapMarker } from '../types/database';

const LAYER_IDS: ReadonlySet<string> = new Set(MAP_LAYERS.map((l) => l.id));
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Alto aproximado (px) que ocupan buscador y fila de capas en móvil. */
const MOBILE_CONTROLS_PX = 124;
const MAX_RESULTS = 8;

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

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

/** Puntuación de un campo para una palabra: exacto > empieza por > inicio de palabra > contiene. */
function fieldScore(text: string, token: string, weight: number): number {
  if (!text) return 0;
  if (text === token) return weight;
  if (text.startsWith(token)) return weight * 0.85;
  if (text.includes(` ${token}`)) return weight * 0.7;
  if (text.includes(token)) return weight * 0.5;
  return 0;
}

interface SearchDoc {
  marker: MapMarker;
  t: string;
  e: string;
  r: string;
  c: string;
  entityTitle: string | null;
}

/** Ranking por título > entidad > región > categoría; todas las palabras deben coincidir en algún campo. */
function rank(docs: ReadonlyArray<SearchDoc>, query: string): SearchDoc[] {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return docs
    .map((d) => {
      let total = 0;
      for (const tk of tokens) {
        const best = Math.max(fieldScore(d.t, tk, 100), fieldScore(d.e, tk, 70), fieldScore(d.r, tk, 40), fieldScore(d.c, tk, 20));
        if (best === 0) return { d, score: 0 };
        total += best;
      }
      return { d, score: total };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.d.marker.titulo.localeCompare(b.d.marker.titulo, 'es'))
    .slice(0, MAX_RESULTS)
    .map((x) => x.d);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function Artwork({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <SunsetBanner className={className} />;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(src)} />;
}


interface MarkerCardProps {
  marker: MapMarker;
  entityTitle: string | null;
  entityId: string | null;
  /** Ruta limpia de la ficha (/catalogo/:categoria/:itemSlug o /guias/:slug) cuando existe. */
  catalogHref: string | null;
  done: boolean;
  guest: boolean;
  /** Móvil: resumen compacto (miniatura, descripción y dos acciones) como la ficha de `Mobile.dc.html`. */
  compact: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function MarkerCard({ marker, entityTitle, entityId, catalogHref, done, guest, compact, onToggle, onClose }: MarkerCardProps) {
  const { data: forum } = useForumData();
  const threads = forum.threads.filter(
    (t) => t.marker_id === marker.id || (entityId !== null && t.entity_id === entityId),
  );
  // Invitado: nunca se enlaza a un hilo concreto; ForumPage gestiona el muro de registro.
  const forumLink = (path: string): string => (guest ? '/foro' : path);
  if (compact) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        <div className="flex gap-3">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl">
            <Artwork src={marker.media_url} alt={`Foto de ${marker.titulo}`} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{marker.region}</p>
            {marker.descripcion && <p className="mt-1 line-clamp-3 text-sm text-vice-text/85">{marker.descripcion}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={done}
            onClick={onToggle}
            className={`flex min-h-12 flex-1 items-center justify-center whitespace-nowrap rounded-full px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
              done ? 'bg-vice-gold text-vice-ink' : 'bg-vice-accent text-vice-ink'
            }`}
          >
            {done ? 'Completado (quitar)' : 'Marcar completado'}
          </button>
          <a
            href={forumLink(`/foro?marker=${marker.id}`)}
            className="glass flex min-h-12 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            Hilos ({threads.length})
          </a>
        </div>
        {entityTitle && entityId && (
          <a
            href={catalogHref ?? `/catalogo?entity=${entityId}`}
            className="flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            Ver ficha: {entityTitle}
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="h-36 w-full overflow-hidden rounded-xl">
        <Artwork src={marker.media_url} alt={`Foto de ${marker.titulo}`} className="h-full w-full object-cover" />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{marker.region}</p>
        <h3 className="font-display text-xl font-bold">{marker.titulo}</h3>
        {marker.descripcion && <p className="mt-1 text-sm text-vice-text/85">{marker.descripcion}</p>}
      </div>
      {entityTitle && entityId && (
        <a
          href={catalogHref ?? `/catalogo?entity=${entityId}`}
          className="flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
        >
          Ver ficha: {entityTitle}
        </a>
      )}
      <button
        type="button"
        aria-pressed={done}
        onClick={onToggle}
        className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
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
                  href={forumLink(`/foro?hilo=${t.id}`)}
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
        <PalmButton as="a" href={forumLink(`/foro?marker=${marker.id}`)} fullWidth className="mt-2 min-h-12! text-base!">
          Discutir este punto
        </PalmButton>
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


// ---- Modo Editor (ADMIN+): el servidor aplica RBAC; esto es solo la interfaz --------------------------------------------
interface CreatePayload {
  entity_id: string | null;
  slug?: string;
  region: string;
  titulo: string;
}

// ---- Herramientas del Modo Editor: calca de referencia y trazador SVG ------------------------------------------
interface RefState {
  on: boolean;
  id: string;
  /** 0-80 (%). */
  opacity: number;
  /** Multiplicador sobre el encuadre base de la imagen (centrado en ella). */
  scale: number;
  dx: number;
  dy: number;
}
/** La calca ya viene alineada 1:1 con la isla vectorial: REF_IMAGES (leonidaMap.ts) fija x, y, ancho, alto y recorte (el mapa ocupa ~68 % izquierdo de la imagen comunitaria), por lo que el ajuste fino parte de escala ×1 y desplazamiento (0, 0). */
const REF_DEFAULT: RefState = { on: false, id: REF_IMAGES[0]!.id, opacity: 45, scale: 1, dx: 0, dy: 0 };

type TraceMode = 'poly' | 'route';
interface TraceState {
  on: boolean;
  mode: TraceMode;
  pts: ReadonlyArray<readonly [number, number]>;
}
const TRACE_DEFAULT: TraceState = { on: false, mode: 'poly', pts: [] };

/** Atributo `d` exacto del trazo: polígono cerrado (Z) o ruta abierta. */
function traceD(t: TraceState): string {
  if (t.pts.length === 0) return '';
  const body = t.pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  return t.mode === 'poly' && t.pts.length > 2 ? `${body} Z` : body;
}

const RANGE = 'h-11 w-full accent-[#F67E56]';
const SMALL_BTN =
  'min-h-11 rounded-xl border border-white/15 px-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-40';

interface EditorToolsProps {
  refState: RefState;
  refFailed: boolean;
  onRef: (next: RefState) => void;
  trace: TraceState;
  onTrace: (next: TraceState) => void;
  onCopyD: () => void;
}

function EditorTools({ refState, refFailed, onRef, trace, onTrace, onCopyD }: EditorToolsProps) {
  const set = (patch: Partial<RefState>) => onRef({ ...refState, ...patch });
  const d = traceD(trace);
  return (
    <>
      <fieldset className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-vice-orange">Calca de referencia</legend>
        <label className="flex min-h-11 items-center gap-2 font-semibold">
          <input type="checkbox" checked={refState.on} onChange={(e) => set({ on: e.target.checked })} className="h-5 w-5 accent-[#F67E56]" />
          Mostrar calca
        </label>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Imagen de referencia">
          {REF_IMAGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={refState.id === r.id}
              onClick={() => set({ id: r.id, scale: 1, dx: 0, dy: 0 })}
              className={`${SMALL_BTN} ${refState.id === r.id ? 'bg-vice-gold/20 text-vice-gold' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="flex flex-col text-xs">
          Opacidad: {refState.opacity}%
          <input type="range" min={0} max={80} step={1} value={refState.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} className={RANGE} />
        </label>
        <label className="flex flex-col text-xs">
          Escala: ×{refState.scale.toFixed(3)}
          <input type="range" min={0.5} max={1.6} step={0.005} value={refState.scale} onChange={(e) => set({ scale: Number(e.target.value) })} className={RANGE} />
        </label>
        <label className="flex flex-col text-xs">
          Desplazamiento X: {refState.dx.toFixed(1)}
          <input type="range" min={-250} max={250} step={0.5} value={refState.dx} onChange={(e) => set({ dx: Number(e.target.value) })} className={RANGE} />
        </label>
        <label className="flex flex-col text-xs">
          Desplazamiento Y: {refState.dy.toFixed(1)}
          <input type="range" min={-250} max={250} step={0.5} value={refState.dy} onChange={(e) => set({ dy: Number(e.target.value) })} className={RANGE} />
        </label>
        <button type="button" onClick={() => set({ scale: 1, dx: 0, dy: 0 })} className={SMALL_BTN}>
          Restablecer alineación
        </button>
        {refState.on && refFailed && (
          <p role="status" className="rounded-xl bg-vice-accent/20 px-3 py-2 text-xs font-semibold">
            No se encontró la imagen. La carpeta <code>public/ref Leonida map/</code> solo existe en local (no se sube a git ni al build).
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-vice-orange">Trazar SVG</legend>
        <button
          type="button"
          aria-pressed={trace.on}
          onClick={() => onTrace({ ...trace, on: !trace.on })}
          className={`${SMALL_BTN} ${trace.on ? 'bg-vice-gold/20 text-vice-gold' : ''}`}
        >
          {trace.on ? 'Trazando: toca el mapa para añadir puntos' : 'Activar trazador'}
        </button>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de trazo">
          <button
            type="button"
            aria-pressed={trace.mode === 'poly'}
            onClick={() => onTrace({ ...trace, mode: 'poly' })}
            className={`${SMALL_BTN} ${trace.mode === 'poly' ? 'bg-vice-gold/20 text-vice-gold' : ''}`}
          >
            Polígono cerrado
          </button>
          <button
            type="button"
            aria-pressed={trace.mode === 'route'}
            onClick={() => onTrace({ ...trace, mode: 'route' })}
            className={`${SMALL_BTN} ${trace.mode === 'route' ? 'bg-vice-gold/20 text-vice-gold' : ''}`}
          >
            Ruta abierta
          </button>
        </div>
        <p className="text-xs text-vice-text/70">
          {trace.pts.length} {trace.pts.length === 1 ? 'punto' : 'puntos'} · {trace.mode === 'poly' ? 'isla, bioma o zona' : 'carretera o río'}
        </p>
        <textarea
          readOnly
          rows={3}
          value={d ? `d="${d}"` : ''}
          placeholder='d="M …"'
          aria-label="Atributo d del trazo"
          className="glass w-full resize-none rounded-xl p-2 font-mono text-xs text-vice-text placeholder:text-vice-text/60"
        />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={trace.pts.length === 0} onClick={() => onTrace({ ...trace, pts: trace.pts.slice(0, -1) })} className={SMALL_BTN}>
            Deshacer punto
          </button>
          <button type="button" disabled={trace.pts.length === 0} onClick={() => onTrace({ ...trace, pts: [] })} className={SMALL_BTN}>
            Limpiar
          </button>
        </div>
        <button type="button" disabled={trace.pts.length < 2} onClick={onCopyD} className={SMALL_BTN}>
          Copiar d="M …"
        </button>
      </fieldset>
    </>
  );
}

interface EditorPanelProps {
  extra: ReactNode;
  cross: { x: number; y: number } | null;
  selected: MapMarker | null;
  entities: ReadonlyArray<Entity>;
  moduleSlug: (moduleId: string) => string;
  regions: ReadonlyArray<string>;
  nearestRegion: (x: number, y: number) => string;
  busy: boolean;
  status: { ok: boolean; text: string } | null;
  onCreate: (p: CreatePayload) => void;
  onMoveHere: () => void;
  onCopy: () => void;
  onClose: () => void;
}

const FIELD =
  'glass min-h-11 w-full rounded-xl px-3 text-sm text-vice-text placeholder:text-vice-text/60 focus-visible:outline-2 focus-visible:outline-vice-gold';

function EditorPanel({ extra, cross, selected, entities, moduleSlug, regions, nearestRegion, busy, status, onCreate, onMoveHere, onCopy, onClose }: EditorPanelProps) {
  const [entityQuery, setEntityQuery] = useState('');
  const [picked, setPicked] = useState<Entity | null>(null);
  const [region, setRegion] = useState('');
  const [titulo, setTitulo] = useState('');
  const [slug, setSlug] = useState('');
  const [regionTouched, setRegionTouched] = useState(false);

  // Sugiere la región más cercana al punto fijado mientras el admin no la haya escrito.
  useEffect(() => {
    if (cross && !regionTouched) setRegion(nearestRegion(cross.x, cross.y));
  }, [cross, regionTouched, nearestRegion]);

  const matches = useMemo(() => {
    const tokens = norm(entityQuery).split(/\s+/).filter(Boolean);
    if (picked || tokens.length === 0) return [];
    return entities
      .filter((e) => {
        const hay = norm(`${e.titulo} ${entitySlug(e)} ${e.categoria}`);
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 6);
  }, [entities, entityQuery, picked]);

  const pick = (e: Entity | null) => {
    setPicked(e);
    setEntityQuery('');
    if (e) {
      setTitulo(e.titulo);
      setSlug(entitySlug(e));
    }
  };

  const slugOk = slug === '' || SLUG_RE.test(slug);
  const canCreate = cross !== null && region.trim() !== '' && titulo.trim() !== '' && slugOk && !busy;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">Modo editor</p>
          <p className="text-vice-text/80">Toca el mapa para fijar la mira. Arrastra el pin seleccionado para moverlo.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 shrink-0 rounded-xl px-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
        >
          Salir
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="text-xs text-vice-text/70">Coordenadas (lienzo 0–1000 × 0–700)</p>
        <p role="status" className="font-display text-lg font-bold tabular-nums">
          {cross ? `x ${cross.x.toFixed(2)} · y ${cross.y.toFixed(2)}` : 'Sin mira fijada'}
        </p>
        <button
          type="button"
          disabled={!cross}
          onClick={onCopy}
          className="mt-2 min-h-11 w-full rounded-xl border border-white/15 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-40"
        >
          Copiar coordenadas
        </button>
      </div>

      {extra}

      <div className="flex flex-col gap-2">
        <label className="font-semibold" htmlFor="ed-entity">
          Entidad del catálogo
        </label>
        {picked ? (
          <div className="glass flex min-h-11 items-center justify-between gap-2 rounded-xl px-3">
            <span className="min-w-0 truncate">
              {picked.titulo} <span className="text-xs text-vice-orange">· {moduleSlug(picked.module_id)}</span>
            </span>
            <button type="button" onClick={() => pick(null)} className="min-h-11 shrink-0 px-2 text-xs font-semibold underline">
              Quitar
            </button>
          </div>
        ) : (
          <>
            <input
              id="ed-entity"
              type="search"
              value={entityQuery}
              onChange={(e) => setEntityQuery(e.target.value)}
              placeholder="Buscar en el catálogo… (opcional)"
              autoComplete="off"
              className={FIELD}
            />
            {matches.length > 0 && (
              <ul className="glass overflow-hidden rounded-xl" aria-label="Entidades">
                {matches.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => pick(e)}
                      className="flex min-h-11 w-full flex-col px-3 py-1.5 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                    >
                      <span className="font-semibold">{e.titulo}</span>
                      <span className="text-xs text-vice-orange">
                        {moduleSlug(e.module_id)} · {e.categoria}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2">
        <label className="font-semibold" htmlFor="ed-titulo">
          Título
        </label>
        <input id="ed-titulo" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} className={FIELD} />
        <label className="font-semibold" htmlFor="ed-region">
          Región
        </label>
        <input
          id="ed-region"
          list="ed-regions"
          value={region}
          maxLength={80}
          onChange={(e) => {
            setRegionTouched(true);
            setRegion(e.target.value);
          }}
          className={FIELD}
        />
        <datalist id="ed-regions">
          {regions.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <label className="font-semibold" htmlFor="ed-slug">
          Slug (<code>?pin=</code>)
        </label>
        <input
          id="ed-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          onBlur={() => titulo && slug === '' && setSlug(slugify(titulo))}
          aria-invalid={!slugOk}
          className={FIELD}
        />
        {!slugOk && <p className="text-xs text-vice-accent">Solo minúsculas, números y guiones.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <PalmButton
          type="button"
          fullWidth
          disabled={!canCreate}
          onClick={() =>
            onCreate({ entity_id: picked?.id ?? null, ...(slug ? { slug } : {}), region: region.trim(), titulo: titulo.trim() })
          }
          className="min-h-12! text-base!"
        >
          {busy ? 'Guardando…' : 'Crear marcador aquí'}
        </PalmButton>
        {selected && (
          <button
            type="button"
            disabled={!cross || busy}
            onClick={onMoveHere}
            className="min-h-12 rounded-xl border border-white/15 px-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-40"
          >
            Mover «{selected.titulo}» aquí
          </button>
        )}
      </div>

      {status && (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 font-semibold ${status.ok ? 'bg-vice-gold/20 text-vice-gold' : 'bg-vice-accent/20 text-vice-text'}`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}

const ZOOM_BTN =
  'flex h-11 w-11 items-center justify-center text-xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold';

const keyOf = (p: URLSearchParams): string => `${p.get('pin')}|${p.get('marker')}|${p.get('entity')}`;
// 401/403/404 (el servidor responde 404 uniforme a quien no tiene acceso): mensaje neutro, sin hablar de permisos.
const errText = (e: unknown): string =>
  e instanceof ApiError && ![401, 403, 404].includes(e.status) ? e.message : 'No se pudo completar la acción.';

export default function MapPage({ params }: { params: URLSearchParams }) {
  const { data, error } = useWorldData();
  const qc = useQueryClient();
  const items = useProgressStore((s) => s.items);
  const toggle = useProgressStore((s) => s.toggle);
  const guest = useAuthStore((s) => s.status !== 'authenticated');
  const isAdmin = useAuthStore((s) => s.isStaff());
  const isDesktop = useIsDesktop();

  // Con el mapa en pantalla, el cristal (backdrop-filter) se vuelve opaco en móvil: desenfocar el fondo en cada
  // frame mientras el bitmap se mueve es lo que más frena el pan/zoom táctil (ver .map-active en vice-nui.css).
  useEffect(() => {
    document.body.classList.add('map-active');
    return () => document.body.classList.remove('map-active');
  }, []);

  const canvas = useRef<MapCanvasHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const handledKey = useRef<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [layersOpen, setLayersOpen] = useState(false);
  const [editor, setEditor] = useState(false);
  const [cross, setCross] = useState<{ x: number; y: number } | null>(null);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [refState, setRefState] = useState<RefState>(REF_DEFAULT);
  const [refFailed, setRefFailed] = useState(false);
  const [trace, setTrace] = useState<TraceState>(TRACE_DEFAULT);

  const entitiesById = useMemo(() => new Map(data.entities.map((e) => [e.id, e])), [data.entities]);
  const modulesById = useMemo(() => new Map(data.modules.map((m) => [m.id, m])), [data.modules]);
  const markersById = useMemo(() => new Map(data.markers.map((m) => [m.id, m])), [data.markers]);

  const layered = useMemo(
    () => data.markers.map((m) => ({ marker: m, layer: markerLayer(m, entitiesById, modulesById) })),
    [data.markers, entitiesById, modulesById],
  );
  const layerCount = useMemo(() => {
    const c = new Map<MapLayerId, number>();
    for (const l of layered) c.set(l.layer, (c.get(l.layer) ?? 0) + 1);
    return c;
  }, [layered]);
  const regions = useMemo(
    () => [...new Set(data.markers.map((m) => m.region))].sort((a, b) => a.localeCompare(b, 'es')),
    [data.markers],
  );

  // ---- Filtros: la URL es la fuente de verdad (?capas= ?region= ?ocultar=1) ---------------------------------------
  const paramKey = params.toString();
  const capasParam = params.get('capas');
  const region = params.get('region');
  const hideDone = params.get('ocultar') === '1';
  // Capas válidas de ?capas=; si no hay ninguna coincidencia (valores inválidos) se activan todas.
  const parsedLayers = useMemo(() => (capasParam === null ? [] : capasParam.split(',').filter((id): id is MapLayerId => LAYER_IDS.has(id))), [capasParam]);
  const capasValid = capasParam !== null && parsedLayers.length > 0;
  const active = useMemo(() => (capasValid ? new Set<MapLayerId>(parsedLayers) : new Set<MapLayerId>(MAP_LAYERS.map((l) => l.id))), [capasValid, parsedLayers]);

  const updateUrl = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(params);
      mut(p);
      handledKey.current = keyOf(p);
      const s = p.toString();
      navigate(`/mapa${s ? `?${s}` : ''}`, { replace: true, keepScroll: true });
    },
    [params],
  );

  const toggleLayer = (id: MapLayerId) => {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateUrl((p) => {
      if (next.size === MAP_LAYERS.length) p.delete('capas');
      else p.set('capas', MAP_LAYERS.filter((l) => next.has(l.id)).map((l) => l.id).join(','));
    });
  };
  const setRegionFilter = (v: string) => updateUrl((p) => (v ? p.set('region', v) : p.delete('region')));
  const setHideDone = (v: boolean) => updateUrl((p) => (v ? p.set('ocultar', '1') : p.delete('ocultar')));
  const filtersActive = capasValid || region !== null || hideDone;
  const resetFilters = () =>
    updateUrl((p) => {
      p.delete('capas');
      p.delete('region');
      p.delete('ocultar');
    });

  const isDone = useCallback((id: string): boolean => items[`marker:${id}`]?.completado === true, [items]);
  const doneCount = data.markers.filter((m) => isDone(m.id)).length;

  const visible = useMemo(
    () =>
      layered.filter(
        (l) => active.has(l.layer) && (!region || l.marker.region === region) && !(hideDone && isDone(l.marker.id)),
      ),
    [layered, active, region, hideDone, isDone],
  );

  const selected = (selectedId && markersById.get(selectedId)) || null;
  const selectedEntity = selected?.entity_id ? (entitiesById.get(selected.entity_id) ?? null) : null;
  const selectedModule = selectedEntity ? modulesById.get(selectedEntity.module_id) : undefined;
  const catalogHref = selectedEntity && selectedModule ? entityHref(selectedEntity, selectedModule.slug) : null;

  const pins = useMemo<MapPin[]>(() => {
    const toPin = (m: MapMarker, layer: MapLayerId): MapPin => {
      const o = overrides.get(m.id);
      const done = isDone(m.id);
      return {
        id: m.id,
        x: o?.x ?? m.coord_x,
        y: o?.y ?? m.coord_y,
        color: MAP_LAYERS.find((l) => l.id === layer)?.color ?? '#fff',
        done,
        label: `${m.titulo}, ${m.region}${done ? ', completado' : ''}`,
      };
    };
    const list = visible.map((l) => toPin(l.marker, l.layer));
    // La ficha abierta siempre conserva su pin, aunque un filtro lo excluya.
    if (selected && !list.some((p) => p.id === selected.id)) {
      list.push(toPin(selected, markerLayer(selected, entitiesById, modulesById)));
    }
    return list;
  }, [visible, overrides, isDone, selected, entitiesById, modulesById]);

  // ---- Enfoque y selección ------------------------------------------------------------------------------------------------
  const lift = useCallback(
    (): number => (isDesktop ? 0 : (wrapRef.current?.clientHeight ?? 700) * 0.24),
    [isDesktop],
  );
  const focusMarker = useCallback(
    (m: MapMarker) => canvas.current?.flyTo(m.coord_x, m.coord_y, { zoom: 3.4, lift: lift() }),
    [lift],
  );

  const selectMarker = useCallback(
    (m: MapMarker) => {
      setSelectedId(m.id);
      focusMarker(m);
      if (editor) setCross({ x: m.coord_x, y: m.coord_y });
      updateUrl((p) => {
        p.delete('pin');
        p.delete('marker');
        p.delete('entity');
        if (m.slug) p.set('pin', m.slug);
        else p.set('marker', m.id);
      });
    },
    [focusMarker, editor, updateUrl],
  );

  const deselect = useCallback(() => {
    setSelectedId(null);
    updateUrl((p) => {
      p.delete('pin');
      p.delete('marker');
      p.delete('entity');
    });
  }, [updateUrl]);

  // Escape cierra la tarjeta del marcador (salvo que el foco esté en un campo de texto).
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      deselect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, deselect]);

  // Deep-link: ?pin=<slug> (y compatibilidad con ?marker=<uuid> y ?entity=<uuid>).
  useEffect(() => {
    const k = keyOf(params);
    if (handledKey.current === k) return;
    const pin = params.get('pin');
    const markerId = params.get('marker');
    const entityId = params.get('entity');
    if (!pin && !markerId && !entityId) {
      handledKey.current = k;
      return;
    }
    const target = pin
      ? data.markers.find((m) => m.slug === pin)
      : markerId
        ? markersById.get(markerId)
        : data.markers.find((m) => m.entity_id === entityId);
    if (target) {
      handledKey.current = k;
      setSelectedId(target.id);
      focusMarker(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey, data.markers]);

  // ?region=: además de filtrar, encuadra el centro de los marcadores de esa región.
  useEffect(() => {
    if (!region || params.get('pin') || params.get('marker') || params.get('entity')) return;
    const ms = data.markers.filter((m) => m.region === region);
    if (ms.length === 0) return;
    const cx = ms.reduce((a, m) => a + m.coord_x, 0) / ms.length;
    const cy = ms.reduce((a, m) => a + m.coord_y, 0) / ms.length;
    canvas.current?.flyTo(cx, cy, { zoom: ms.length > 1 ? 2.2 : 3.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, data.markers.length]);

  // ---- Buscador instantáneo (NFD, ranking título > entidad > región) ------------------------------------------------
  const searchDocs = useMemo<SearchDoc[]>(
    () =>
      data.markers.map((m) => {
        const e = m.entity_id ? entitiesById.get(m.entity_id) : undefined;
        return { marker: m, t: norm(m.titulo), e: norm(e?.titulo ?? ''), r: norm(m.region), c: norm(e?.categoria ?? ''), entityTitle: e?.titulo ?? null };
      }),
    [data.markers, entitiesById],
  );
  const results = useMemo(() => rank(searchDocs, query), [searchDocs, query]);

  // ---- Modo editor -----------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 5000);
    return () => window.clearTimeout(t);
  }, [status]);

  const nearestRegion = useCallback(
    (x: number, y: number): string => {
      let best = '';
      let bd = Infinity;
      for (const m of data.markers) {
        const d = Math.hypot(m.coord_x - x, m.coord_y - y);
        if (d < bd) {
          bd = d;
          best = m.region;
        }
      }
      return best;
    },
    [data.markers],
  );

  const moveMarker = useCallback(
    async (id: string, x: number, y: number): Promise<boolean> => {
      setOverrides((prev) => new Map(prev).set(id, { x, y }));
      setCross({ x, y });
      const clear = () =>
        setOverrides((prev) => {
          const n = new Map(prev);
          n.delete(id);
          return n;
        });
      try {
        await apiFetch(`/api/markers/${id}`, { method: 'PATCH', json: { coord_x: x, coord_y: y } });
        await qc.invalidateQueries({ queryKey: ['world'] });
        clear();
        setStatus({ ok: true, text: `Posición guardada ✓ (${x.toFixed(2)}, ${y.toFixed(2)})` });
        return true;
      } catch (e) {
        clear();
        setStatus({ ok: false, text: errText(e) });
        return false;
      }
    },
    [qc],
  );

  const createMarker = async (p: CreatePayload) => {
    if (!cross) return;
    setBusy(true);
    try {
      const created = await apiFetch<MapMarker>('/api/markers', { method: 'POST', json: { ...p, coord_x: cross.x, coord_y: cross.y } });
      await qc.invalidateQueries({ queryKey: ['world'] });
      setStatus({ ok: true, text: `Marcador «${created.titulo}» creado ✓` });
      selectMarker(created);
    } catch (e) {
      setStatus({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const copyCoords = async () => {
    if (!cross) return;
    const ok = await copyText(`${cross.x.toFixed(2)}, ${cross.y.toFixed(2)}`);
    setStatus({ ok, text: ok ? `Copiado: ${cross.x.toFixed(2)}, ${cross.y.toFixed(2)}` : 'No se pudo copiar al portapapeles.' });
  };

  const copyTraceD = async () => {
    const d = traceD(trace);
    if (!d) return;
    const ok = await copyText(`d="${d}"`);
    setStatus({ ok, text: ok ? `Copiado d="…" con ${trace.pts.length} puntos` : 'No se pudo copiar al portapapeles.' });
  };

  const refOverlay = useMemo<MapRefOverlay | null>(() => {
    if (!editor || !refState.on) return null;
    const base = REF_IMAGES.find((r) => r.id === refState.id) ?? REF_IMAGES[0]!;
    const w = base.w * refState.scale;
    const h = base.h * refState.scale;
    return {
      src: base.src,
      x: base.x + (base.w - w) / 2 + refState.dx,
      y: base.y + (base.h - h) / 2 + refState.dy,
      w,
      h,
      cropW: base.cropW,
      opacity: refState.opacity / 100,
      onError: () => setRefFailed(true),
    };
  }, [editor, refState]);
  const tracer = useMemo<MapTracer | null>(
    () => (editor && trace.pts.length > 0 ? { points: trace.pts, closed: trace.mode === 'poly' } : null),
    [editor, trace],
  );

  const moduleSlug = useCallback((moduleId: string): string => modulesById.get(moduleId)?.slug ?? 'catálogo', [modulesById]);

  const editorPanel = (
    <EditorPanel
      extra={
        <EditorTools
          refState={refState}
          refFailed={refFailed}
          onRef={(next) => {
            if (next.id !== refState.id) setRefFailed(false);
            setRefState(next);
          }}
          trace={trace}
          onTrace={setTrace}
          onCopyD={() => void copyTraceD()}
        />
      }
      cross={cross}
      selected={selected}
      entities={data.entities}
      moduleSlug={moduleSlug}
      regions={regions}
      nearestRegion={nearestRegion}
      busy={busy}
      status={status}
      onCreate={(p) => void createMarker(p)}
      onMoveHere={() => selected && cross && void moveMarker(selected.id, cross.x, cross.y)}
      onCopy={() => void copyCoords()}
      onClose={() => {
        setEditor(false);
        setCross(null);
        setTrace((tr) => ({ ...tr, on: false }));
      }}
    />
  );

  const notice = error
    ? data.source === 'seed'
      ? 'No se pudo conectar con el servidor: se muestran datos de ejemplo.'
      : 'No se pudo actualizar desde el servidor.'
    : data.source === 'seed'
      ? SAMPLE_NOTICE
      : null;

  const card = selected && (
    <MarkerCard
      marker={selected}
      entityTitle={selectedEntity?.titulo ?? null}
      entityId={selectedEntity?.id ?? null}
      catalogHref={catalogHref}
      done={isDone(selected.id)}
      guest={guest}
      compact={!isDesktop}
      onToggle={() => toggle({ markerId: selected.id })}
      onClose={deselect}
    />
  );

  const insets = useMemo(() => ({ top: isDesktop ? 0 : MOBILE_CONTROLS_PX }), [isDesktop]);
  const editable = useMemo(
    () => (editor && !trace.on && selected ? { pinId: selected.id, onMove: moveMarker } : undefined),
    [editor, trace.on, selected, moveMarker],
  );

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none select-none overflow-hidden">
      <MapCanvas
        ref={canvas}
        pins={pins}
        selectedId={selectedId}
        insets={insets}
        crosshair={editor && !trace.on ? cross : null}
        refOverlay={refOverlay}
        tracer={tracer}
        captureClicks={editor && trace.on}
        editable={editable}
        ariaLabel="Mapa de Leonida. Arrastra para mover, rueda, pellizco o botones para acercar."
        onSelect={(id) => {
          const m = markersById.get(id);
          if (m) selectMarker(m);
        }}
        onBackgroundClick={(w) => {
          if (editor && trace.on) {
            setTrace((tr) => ({ ...tr, pts: [...tr.pts, [Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10] as const] }));
            setStatus(null);
          } else if (editor) {
            setCross(w);
            setStatus(null);
          } else if (selectedId) deselect();
        }}
      />

      {/* Sin resultados: aviso claro con salida directa */}
      {pins.length === 0 && filtersActive && (
        <div role="status" className="pointer-events-none absolute inset-x-3 bottom-28 z-10 flex justify-center md:bottom-10">
          <div className="glass pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl p-4 text-center">
            <p className="font-semibold">No hay marcadores con estos filtros.</p>
            <PalmButton type="button" onClick={resetFilters} className="min-h-11!">
              Limpiar filtros
            </PalmButton>
          </div>
        </div>
      )}

      {/* HUD superior izquierdo: buscador + filtros (+ editor en escritorio) */}
      <div className="pointer-events-none absolute left-3 right-3 top-2 z-10 flex max-h-[calc(100%-1rem)] flex-col gap-2 md:right-auto md:w-64 md:overflow-y-auto">
        <div className="pointer-events-auto relative">
          <label htmlFor="map-search" className="sr-only">
            Buscar marcador, entidad o región
          </label>
          <input
            id="map-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en el mapa…"
            autoComplete="off"
            className="glass min-h-12 w-full rounded-full px-5 text-base text-vice-text placeholder:text-vice-text/60 focus-visible:outline-2 focus-visible:outline-vice-gold"
          />
          {query.trim() && (
            <ul className="glass absolute inset-x-0 top-14 z-20 overflow-hidden rounded-xl" aria-label="Resultados">
              {results.length === 0 && <li className="px-4 py-3 text-sm text-vice-text/70">Sin resultados.</li>}
              {results.map(({ marker: m, entityTitle }) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full flex-col px-4 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                    onClick={() => {
                      setQuery('');
                      selectMarker(m);
                    }}
                  >
                    <span className="font-semibold">{m.titulo}</span>
                    <span className="text-xs text-vice-orange">
                      {m.region}
                      {entityTitle && entityTitle !== m.titulo ? ` · ${entityTitle}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2 md:hidden">
          <button
            type="button"
            aria-expanded={layersOpen}
            onClick={() => setLayersOpen((v) => !v)}
            className="glass min-h-11 whitespace-nowrap rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            Capas y filtros{filtersActive ? ' •' : ''}
          </button>
          <p role="status" className="glass whitespace-nowrap rounded-full px-3 py-2 text-xs">
            {doneCount}/{data.markers.length} completados
          </p>
        </div>

        <fieldset
          className={`glass pointer-events-auto max-h-[46vh] shrink-0 overflow-y-auto rounded-2xl p-3 ${
            layersOpen ? 'block' : 'hidden md:block'
          }`}
        >
          <legend className="sr-only">Capas y filtros del mapa</legend>
          <p className="mb-1 px-1 text-xs font-semibold tracking-widest text-vice-text/90">CAPAS DEL MAPA</p>
          {MAP_LAYERS.filter((l) => (layerCount.get(l.id) ?? 0) > 0).map((l) => (
            <label key={l.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] hover:bg-white/10">
              <input type="checkbox" checked={active.has(l.id)} onChange={() => toggleLayer(l.id)} className="h-4 w-4 accent-[#E1307E]" />
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              <span className="flex-1">{l.label}</span>
              <span className="text-xs text-vice-text/70">{layerCount.get(l.id) ?? 0}</span>
            </label>
          ))}
          {MAP_LAYERS.some((l) => (layerCount.get(l.id) ?? 0) === 0) && (
            <details className="mt-1 rounded-lg px-2 text-vice-text/60">
              <summary className="flex min-h-9 cursor-pointer items-center text-[13px] font-semibold">
                Próximamente ({MAP_LAYERS.filter((l) => (layerCount.get(l.id) ?? 0) === 0).length})
              </summary>
              {MAP_LAYERS.filter((l) => (layerCount.get(l.id) ?? 0) === 0).map((l) => (
                <label key={l.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-[13px] opacity-70">
                  <input type="checkbox" checked={active.has(l.id)} onChange={() => toggleLayer(l.id)} className="h-4 w-4 accent-[#E1307E]" />
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                  <span className="flex-1">{l.label}</span>
                  <span className="text-xs">sin puntos aún</span>
                </label>
              ))}
            </details>
          )}
          <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-2">
            <label htmlFor="map-region" className="px-1 text-xs font-semibold tracking-widest text-vice-text/90">
              REGIÓN
            </label>
            <select
              id="map-region"
              value={region ?? ''}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="glass min-h-11 w-full rounded-xl px-3 text-sm text-vice-text focus-visible:outline-2 focus-visible:outline-vice-gold"
            >
              <option value="">Todas las regiones</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-white/10">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} className="h-5 w-5 accent-[#E1307E]" />
              <span className="flex-1">Ocultar encontrados</span>
            </label>
            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="min-h-10 rounded-lg text-sm font-semibold text-vice-orange hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
              >
                Restablecer filtros
              </button>
            )}
          </div>
        </fieldset>

        {editor && isDesktop && <div className="glass pointer-events-auto shrink-0 rounded-2xl p-3">{editorPanel}</div>}
      </div>

      {/* Zoom, progreso y Modo Editor (ADMIN+) */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2 md:bottom-auto md:top-2">
        <div className="glass flex flex-col overflow-hidden rounded-2xl">
          <button type="button" aria-label="Acercar" onClick={() => canvas.current?.zoomBy(1.6)} className={ZOOM_BTN}>
            +
          </button>
          <button type="button" aria-label="Alejar" onClick={() => canvas.current?.zoomBy(1 / 1.6)} className={ZOOM_BTN}>
            −
          </button>
          <button type="button" aria-label="Restablecer vista" onClick={() => canvas.current?.reset()} className={ZOOM_BTN}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12a8 8 0 108-8H8M8 4L4.5 7.5 8 11" />
            </svg>
          </button>
        </div>
        {isAdmin && (
          <button
            type="button"
            aria-pressed={editor}
            onClick={() => {
              setEditor((v) => !v);
              setCross(null);
              setStatus(null);
            }}
            className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
              editor ? 'bg-vice-gold text-vice-ink' : 'glass'
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
            Modo editor
          </button>
        )}
        <p role="status" className="glass hidden whitespace-nowrap rounded-full px-3 py-1 text-xs md:absolute md:right-full md:top-0 md:mr-2 md:block">
          {doneCount}/{data.markers.length} completados
        </p>
      </div>

      {notice && (
        <p className="pointer-events-none absolute bottom-2 left-3 z-10 max-w-[60%] text-[11px] text-vice-text/70 md:max-w-xs">
          {notice}
        </p>
      )}

      {/* Ficha P04.3: panel flotante (escritorio) / Bottom Sheet (móvil; en modo editor muestra el editor) */}
      {selected && isDesktop && (
        <aside
          aria-label="Ficha de marcador"
          className="glass absolute bottom-3 right-3 top-[15rem] z-10 w-[340px] overflow-y-auto rounded-2xl p-4 max-md:hidden"
        >
          {card}
        </aside>
      )}
      <BottomSheet
        open={(editor || selected !== null) && !isDesktop}
        onClose={() => (editor ? undefined : deselect())}
        title={editor ? 'Modo editor' : selected?.titulo}
        modal={false}
        className="md:hidden"
      >
        {editor ? editorPanel : card}
      </BottomSheet>
    </div>
  );
}
