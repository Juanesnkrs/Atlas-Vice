// P04 - Mapa interactivo de Leonida: motor SVG propio (MapCanvas) sobre cartografía vectorial original,
// filtros combinados sincronizados con la URL, buscador instantáneo, ficha de marcador con check 100%
// (P04.3), drawer de hilos (P07.3) y Modo Editor de coordenadas para ADMIN+.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SunsetBanner } from '../components/layout/ViceShell';
import { ApiErrorState } from '../components/ui/ApiErrorState';
import { BottomSheet } from '../components/ui/BottomSheet';
import { EntityPicker, type PickedEntity } from '../components/ui/EntityPicker';
import { MapCanvas, type MapCanvasHandle, type MapPin, type MapRefOverlay, type MapTracer } from '../components/ui/MapCanvas';
import { PalmButton } from '../components/ui/PalmButton';
import { REF_IMAGES } from '../data/leonidaMap';
import {
  entityHref,
  slugify,
  MAP_LAYERS,
  MAP_SCOPE,
  forumCategoryLabel,
  markerLayer,
  useForumData,
  useWorldData,
  type MapLayerId,
} from '../data/seed';
import { apiFetch, ApiError, useAuthStore } from '../store/useAuthStore';
import { navigate } from '../store/useRouteStore';
import { useProgressStore } from '../store/useProgressStore';
import type { MapMarker } from '../types/database';

const LAYER_IDS: ReadonlySet<string> = new Set(MAP_LAYERS.map((l) => l.id));
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  /** Ficha preseleccionada con `?editor=1&entity=` que aún no tiene pin. */
  preset: PickedEntity | null;
  regions:ReadonlyArray<string>;
  nearestRegion: (x: number, y: number) => string;
  busy: boolean;
  status: { ok: boolean; text: string } | null;
  onCreate: (p: CreatePayload) => void;
  onMoveHere: () => void;
  onCopy: () => void;
  onClose: () => void;
  /** Panel acoplado en móvil: la cabecera (título y «Salir») la pone el contenedor. */
  compact?: boolean;
}

const FIELD =
  'glass min-h-11 w-full rounded-xl px-3 text-sm text-vice-text placeholder:text-vice-text/60 focus-visible:outline-2 focus-visible:outline-vice-gold';

function EditorStep({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-semibold">
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-vice-gold text-vice-ink' : 'bg-white/15 text-vice-text'}`}
        >
          {done ? '✓' : n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Guía de 3 pasos para colocar un pin: ficha (opcional) → tocar el mapa → datos y guardar. */
function EditorPanel({ extra, cross, selected, preset, regions, nearestRegion, busy, status, onCreate, onMoveHere, onCopy, onClose, compact = false }: EditorPanelProps) {
  const [picked, setPicked] = useState<PickedEntity | null>(null);
  const [region, setRegion] = useState('');
  const [titulo, setTitulo] = useState('');
  const [slug, setSlug] = useState('');
  const [regionTouched, setRegionTouched] = useState(false);

  // Sugiere la región más cercana al punto fijado mientras el admin no la haya escrito.
  useEffect(() => {
    if (cross && !regionTouched) setRegion(nearestRegion(cross.x, cross.y));
  }, [cross, regionTouched, nearestRegion]);

  const pick = useCallback((e: PickedEntity | null) => {
    setPicked(e);
    if (e) {
      setTitulo(e.titulo);
      setSlug(e.slug);
    }
  }, []);

  // Ficha preseleccionada con `?editor=1&entity=`: queda elegida para crear su pin al tocar el mapa.
  useEffect(() => {
    if (preset) pick(preset);
  }, [preset, pick]);

  const slugOk = slug === '' || SLUG_RE.test(slug);
  const missing = [cross === null && 'tocar el mapa', titulo.trim() === '' && 'el nombre', region.trim() === '' && 'la zona', !slugOk && 'un enlace corto válido'].filter(
    (m): m is string => typeof m === 'string',
  );
  const canCreate = missing.length === 0 && !busy;

  return (
    <div className="flex flex-col gap-3 text-sm">
      {!compact && (
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">Modo editor</p>
            <p className="text-vice-text/80">Coloca un pin nuevo o mueve uno existente.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-xl px-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            Salir
          </button>
        </div>
      )}

      <EditorStep n={1} title="Elige la ficha (opcional)" done={picked !== null}>
        <EntityPicker key={picked?.id ?? 'none'} id="ed-entity" defaultValue={picked?.id ?? null} label="Ficha del catálogo" hideLabel onChange={pick} />
      </EditorStep>

      <EditorStep n={2} title="Toca el mapa donde irá el pin" done={cross !== null}>
        {cross ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-vice-gold/40 bg-vice-gold/10 px-3 py-2">
            <p role="status" className="font-semibold">
              Punto fijado ✓ <span className="font-normal tabular-nums text-vice-text/70">(x {cross.x.toFixed(0)} · y {cross.y.toFixed(0)})</span>
            </p>
            <button type="button" onClick={onCopy} className="min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold">
              Copiar
            </button>
          </div>
        ) : (
          <p role="status" className="rounded-xl border border-dashed border-vice-orange/50 px-3 py-2 text-vice-text/90">
            Aún sin punto. Toca el mapa (puedes volver a tocar para corregir).
          </p>
        )}
      </EditorStep>

      <EditorStep n={3} title="Completa los datos y guarda">
        <label className="font-semibold" htmlFor="ed-titulo">
          Nombre del pin
        </label>
        <input id="ed-titulo" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} className={FIELD} />
        <label className="font-semibold" htmlFor="ed-region">
          Zona o región
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
        <details className="rounded-xl bg-white/5 px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-vice-text/80">Más opciones</summary>
          <div className="flex flex-col gap-2 pb-3">
            <label className="font-semibold" htmlFor="ed-slug">
              Enlace corto <span className="font-normal text-vice-text/70">(<code>?pin=</code>)</span>
            </label>
            <input
              id="ed-slug"
              value={slug}
              placeholder="Se genera a partir del nombre"
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              onBlur={() => titulo && slug === '' && setSlug(slugify(titulo))}
              aria-invalid={!slugOk}
              className={FIELD}
            />
            {!slugOk && <p className="text-xs text-vice-accent">Solo minúsculas, números y guiones.</p>}
          </div>
        </details>
        <PalmButton
          type="button"
          fullWidth
          disabled={!canCreate}
          onClick={() => onCreate({ entity_id: picked?.id ?? null, ...(slug ? { slug } : {}), region: region.trim(), titulo: titulo.trim() })}
          className="min-h-12! text-base!"
        >
          {busy ? 'Guardando…' : 'Guardar pin'}
        </PalmButton>
        <p className="text-xs text-vice-text/70">{missing.length > 0 ? `Para guardar falta: ${missing.join(', ')}.` : 'Todo listo para guardar.'}</p>
      </EditorStep>

      {selected && (
        <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <h3 className="font-semibold">Mover un pin que ya existe</h3>
          <p className="text-xs text-vice-text/80">
            Tienes seleccionado «{selected.titulo}». Arrástralo por el mapa, o toca un punto nuevo y pulsa el botón.
          </p>
          <button
            type="button"
            disabled={!cross || busy}
            onClick={onMoveHere}
            className="min-h-12 rounded-xl border border-white/15 px-3 font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-40"
          >
            Mover «{selected.titulo}» al punto fijado
          </button>
        </section>
      )}

      {status && (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 font-semibold ${status.ok ? 'bg-vice-gold/20 text-vice-gold' : 'bg-vice-accent/20 text-vice-text'}`}
        >
          {status.text}
        </p>
      )}

      <details className="rounded-xl border border-white/10">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-xs font-semibold text-vice-text/80">Herramientas avanzadas (calca y trazador de dibujo)</summary>
        <div className="flex flex-col gap-3 p-3 pt-0">{extra}</div>
      </details>
    </div>
  );
}

/**
 * Móvil: panel acoplado sobre el dock y plegable. Arranca plegado (solo una barra con la instrucción) para dejar el mapa
 * libre; al fijar el punto se abre. Informa de su alto para que el lienzo reserve ese espacio. Se pinta fuera del lienzo
 * táctil (portal) para poder hacer scroll dentro.
 */
function EditorDock({ hasPoint, onClose, onHeight, children }: { hasPoint: boolean; onClose: () => void; onHeight: (px: number) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hasPoint) setOpen(true);
  }, [hasPoint]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => onHeight(Math.round(el.getBoundingClientRect().height) + 8));
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeight(0);
    };
  }, [onHeight]);
  return createPortal(
    <section
      ref={ref}
      aria-label="Modo editor"
      className="glass fixed inset-x-2 z-[var(--z-sheet)] flex max-h-[46dvh] flex-col overflow-hidden rounded-2xl md:hidden"
      style={{ bottom: 'calc(var(--dock-reserve) + 0.25rem)' }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 flex-1 flex-col items-start justify-center text-left focus-visible:outline-2 focus-visible:outline-vice-gold"
        >
          <span className="text-[11px] font-semibold uppercase tracking-widest text-vice-orange">Modo editor</span>
          <span className="text-sm font-semibold">
            {open ? 'Completa los datos del pin' : hasPoint ? 'Punto fijado ✓ · Toca para completar' : 'Toca el mapa para fijar el punto'}
          </span>
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-h-11 shrink-0 rounded-xl px-2 text-xs font-semibold text-vice-orange hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold">
          {open ? 'Ocultar' : 'Abrir'}
        </button>
        <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-xl px-2 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold">
          Salir
        </button>
      </div>
      {open && <div className="touch-pan-y overflow-y-auto overscroll-contain px-3 pb-4">{children}</div>}
    </section>,
    document.body,
  );
}

/** Ayuda junto al contador: qué es «completado» y leyenda de colores de las capas con puntos. */
function MapHelp({ layers, align }: { layers: ReadonlyArray<{ id: string; label: string; color: string }>; align: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="map-ayuda"
        aria-label="Ayuda: qué significa completado y colores del mapa"
        onClick={() => setOpen((v) => !v)}
        className="glass pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold focus-visible:outline-2 focus-visible:outline-vice-gold md:h-8 md:w-8"
      >
        ?
      </button>
      {open && (
        <div
          id="map-ayuda"
          role="region"
          aria-label="Ayuda del mapa"
          className={`glass pointer-events-auto absolute top-full z-20 mt-2 w-72 max-w-[85vw] rounded-2xl p-3 text-left text-xs leading-relaxed ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <p className="font-semibold">¿Qué es «completado»?</p>
          <p className="mt-1 text-vice-text/90">
            Marca un lugar como completado desde su ficha cuando ya lo hayas visitado o resuelto. Cuenta para tu avance.
          </p>
          <p className="mt-2 font-semibold">Colores de los puntos</p>
          <ul className="mt-1 grid grid-cols-1 gap-y-1">
            {layers.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

const ZOOM_BTN =
  'flex h-11 w-11 items-center justify-center text-xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold';

const keyOf = (p: URLSearchParams): string => `${p.get('pin')}|${p.get('marker')}|${p.get('entity')}`;
// 401/403/404 (el servidor responde 404 uniforme a quien no tiene acceso): mensaje neutro, sin hablar de permisos.
const errText = (e: unknown): string =>
  e instanceof ApiError && ![401, 403, 404].includes(e.status) ? e.message : 'No se pudo completar la acción.';

export default function MapPage({ params }: { params: URLSearchParams }) {
  // Solo módulos + marcadores + las fichas del módulo `mapa` (y las referenciadas por algún pin, si hiciera falta).
  const { data, error, unavailable, retry } = useWorldData(MAP_SCOPE);
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
  const legendLayers = useMemo(() => MAP_LAYERS.filter((l) => (layerCount.get(l.id) ?? 0) > 0), [layerCount]);
  const regions = useMemo(
    () => [...new Set(data.markers.map((m) => m.region))].sort((a, b) => a.localeCompare(b, 'es')),
    [data.markers],
  );

  // ---- Filtros: la URL es la fuente de verdad (?capas= ?region= ?ocultar=1) ---------------------------------------
  const paramKey = params.toString();
  // `?editor=1` abre directamente el Modo editor (solo si el servidor confirma el rol; el RBAC real sigue en la API).
  const editorParam = params.get('editor') === '1';
  useEffect(() => {
    if (editorParam && isAdmin) setEditor(true);
  }, [editorParam, isAdmin]);
  // En Modo editor, `?entity=<slug|uuid>` preselecciona esa ficha para situar su pin (sin `editor=1` conserva el
  // significado público de deep-link por uuid).
  const presetKey = editorParam && isAdmin ? params.get('entity') : null;
  const presetQuery = useQuery({
    queryKey: ['entity-preset', presetKey],
    enabled: presetKey !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const k = presetKey!;
      const list = await apiFetch<PickedEntity[]>(
        UUID_RE.test(k) ? `/api/entities?id=${encodeURIComponent(k)}&limit=1` : `/api/entities?q=${encodeURIComponent(k)}&limit=8`,
      );
      return list.find((e) => e.id === k || e.slug === k) ?? null;
    },
  });
  const presetEntity = presetQuery.data ?? null;
  const presetMarker = presetEntity ? (data.markers.find((m) => m.entity_id === presetEntity.id) ?? null) : null;
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

  // Ficha preseleccionada que ya tiene pin: se selecciona y se enfoca una sola vez.
  const presetFocused = useRef<string | null>(null);
  useEffect(() => {
    if (!presetMarker || presetFocused.current === presetMarker.id) return;
    presetFocused.current = presetMarker.id;
    setSelectedId(presetMarker.id);
    setCross({ x: presetMarker.coord_x, y: presetMarker.coord_y });
    focusMarker(presetMarker);
  }, [presetMarker, focusMarker]);

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

  const renderEditorPanel = (compact: boolean) => (
    <EditorPanel
      compact={compact}
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
      preset={presetMarker ? null : presetEntity}
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
  const closeEditor = () => {
    setEditor(false);
    setCross(null);
    setTrace((tr) => ({ ...tr, on: false }));
  };

  const notice = error && !unavailable ? 'No se pudo actualizar desde el servidor.' : null;

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

  // Alto del panel acoplado del editor (móvil): el lienzo lo reserva y centra el punto fijado en la zona visible.
  const [dockPx, setDockPx] = useState(0);
  const insets = useMemo(() => ({ top: isDesktop ? 0 : MOBILE_CONTROLS_PX, bottom: editor && !isDesktop ? dockPx : 0 }), [isDesktop, editor, dockPx]);
  const crossSet = cross !== null;
  useEffect(() => {
    if (editor && !isDesktop && crossSet && dockPx > 0 && cross) canvas.current?.flyTo(cross.x, cross.y, { zoom: 2.4 });
    // Solo al fijar el primer punto o al cambiar el alto del panel; los toques siguientes no deben mover el mapa. Se acerca
    // un poco: con la isla entera a la vista el lienzo no puede desplazarse para dejar el punto sobre el panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, isDesktop, crossSet, dockPx]);
  const editable = useMemo(
    () => (editor && !trace.on && selected ? { pinId: selected.id, onMove: moveMarker } : undefined),
    [editor, trace.on, selected, moveMarker],
  );

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none select-none overflow-hidden">
      <h1 className="sr-only">Mapa de Leonida</h1>
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

      {/* API caída, 429 o sin servidor: estado honesto con reintento (el mapa base sigue disponible) */}
      {unavailable && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <ApiErrorState compact title="No pudimos cargar los lugares" message={error ?? ''} onRetry={retry} />
        </div>
      )}

      {/* Sin resultados: aviso claro con salida directa */}
      {pins.length === 0 && filtersActive && !unavailable && (
        <div role="status" className="pointer-events-none absolute inset-x-3 bottom-28 z-10 flex justify-center md:bottom-10">
          <div className="glass pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl p-4 text-center">
            <p className="font-semibold">No hay lugares con estos filtros.</p>
            <PalmButton type="button" onClick={resetFilters} className="min-h-11!">
              Limpiar filtros
            </PalmButton>
          </div>
        </div>
      )}

      {/* HUD superior izquierdo: buscador + filtros (+ editor en escritorio) */}
      <div className="pointer-events-none absolute left-3 right-3 top-2 z-10 flex max-h-[calc(100%-1rem)] flex-col gap-2 md:right-auto md:w-[25rem] md:overflow-y-auto ${editor && isDesktop ? 'lg:w-[22rem]' : 'lg:w-64'}">
        <div className="pointer-events-auto relative">
          <label htmlFor="map-search" className="sr-only">
            Buscar lugar, ficha o región
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

        <div className={`pointer-events-auto flex-wrap items-center gap-2 lg:hidden ${editor && isDesktop ? 'hidden' : 'flex'}`}>
          <button
            type="button"
            aria-expanded={layersOpen}
            onClick={() => setLayersOpen((v) => !v)}
            className="glass min-h-11 whitespace-nowrap rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            Capas y filtros{filtersActive ? ' •' : ''}
          </button>
          <p role="status" className="glass whitespace-nowrap rounded-full px-3 py-2 text-xs">
            {doneCount}/{data.markers.length} lugares completados
          </p>
          <MapHelp layers={legendLayers} align="left" />
        </div>

        <fieldset
          className={`glass pointer-events-auto max-h-[46vh] shrink-0 overflow-y-auto rounded-2xl p-3 ${
            editor && isDesktop ? 'hidden' : layersOpen ? 'block' : 'hidden lg:block'
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

        {editor && isDesktop && <div aria-label="Modo editor" role="region" className="glass pointer-events-auto shrink-0 rounded-2xl p-3">{renderEditorPanel(false)}</div>}
      </div>

      {/* Zoom, progreso y Modo Editor (ADMIN+) */}
      <div className={`absolute right-3 z-10 flex flex-col items-end gap-2 md:bottom-auto md:top-2 ${editor && !isDesktop ? 'top-[10.5rem]' : 'bottom-3'}`}>
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
            title="Solo para el equipo"
            onClick={() => {
              setEditor((v) => !v);
              setCross(null);
              setStatus(null);
            }}
            className={`mt-4 flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-bold ring-1 ring-vice-gold/40 focus-visible:outline-2 focus-visible:outline-vice-gold ${
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
        <div className="hidden items-center gap-1 lg:absolute lg:right-full lg:top-0 lg:mr-2 lg:flex">
          <p role="status" className="glass whitespace-nowrap rounded-full px-3 py-1 text-xs">
            {doneCount}/{data.markers.length} lugares completados
          </p>
          <MapHelp layers={legendLayers} align="right" />
        </div>
      </div>

      {notice && (
        <p className="pointer-events-none absolute bottom-2 left-3 z-10 max-w-[60%] text-[11px] text-vice-text/70 md:max-w-xs">
          {notice}
        </p>
      )}

      {/* Ficha P04.3: panel flotante (escritorio) / Bottom Sheet (móvil; en modo editor muestra el editor) */}
      {selected && isDesktop && !editor && (
        <aside
          aria-label="Ficha del lugar"
          className="glass absolute bottom-3 right-3 top-[15rem] z-10 w-[340px] overflow-y-auto rounded-2xl p-4 max-md:hidden"
        >
          {card}
        </aside>
      )}
      {editor && !isDesktop && (
        <EditorDock hasPoint={cross !== null} onClose={closeEditor} onHeight={setDockPx}>
          {renderEditorPanel(true)}
        </EditorDock>
      )}
      <BottomSheet
        open={selected !== null && !editor && !isDesktop}
        onClose={deselect}
        title={selected?.titulo}
        modal={false}
        className="md:hidden"
      >
        {card}
      </BottomSheet>
    </div>
  );
}
