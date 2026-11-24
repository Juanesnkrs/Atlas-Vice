// Estudio de Imágenes (Contenido público → Imágenes, ADMIN+): sube imágenes ya editadas en Photoshop (1600×900, 16:9).
// Cola de fichas sin imagen o provisionales, carga individual con vista previa antes/después y foco del recorte, y carga
// masiva por nombre de archivo (StaffImagesBulk). La UI es cosmética: el servidor valida, recorta (`cover`) y genera
// la versión grande (1600×900) y la de listados (800×450).
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { mediaSrc, thumbUrl } from '../../data/seed';
import { Modal } from './Modal';
import { GHOST, INPUT, Pager, PRIMARY, QueryState, ROW, SMALL_BTN, SubTabs, staffFetch } from './StaffKit';
import { useBlockFilters } from './StaffNav';
import {
  BulkUpload,
  checkBasics,
  checkDims,
  DropZone,
  fmtBytes,
  IMG_ACCEPT,
  MIN_H,
  MIN_W,
  moduleLabel,
  MODULE_OPTIONS,
  readDims,
  uploadErrMsg,
  uploadImage,
  useRefreshImages,
  type UploadResult,
} from './StaffImagesBulk';

const GOAL = 40;
const PER_PAGE = 50;
const FILTER_DEFAULTS = { q: '', m: '', st: 'pendientes', p: '1' };

interface QueueItem {
  id: string;
  slug: string;
  titulo: string;
  module_slug: string;
  imagen_url: string | null;
  capturaPropiaPendiente: boolean;
  imagen_alt?: string | null;
}
interface Stats {
  total: number;
  sin_imagen: number;
  provisionales: number;
  propias: number;
}
interface QueueResponse {
  items: QueueItem[];
  total: number;
  page: number;
  pages: number;
  stats: Stats;
  stats_por_modulo: Record<string, Stats>;
}

type Kind = 'sin' | 'prov' | 'propia';
const kindOf = (it: QueueItem): Kind => (!it.imagen_url ? 'sin' : it.capturaPropiaPendiente ? 'prov' : 'propia');
const KIND_LABEL: Record<Kind, string> = { sin: 'Sin imagen', prov: 'Provisional', propia: 'Propia' };
const KIND_TONE: Record<Kind, string> = { sin: 'bg-vice-rose text-vice-ink', prov: 'bg-vice-gold text-vice-ink', propia: 'bg-vice-cyan text-vice-ink' };

/** Silueta del sistema para fichas sin imagen (SVG propio). */
function Placeholder({ className = '' }: { className?: string }) {
  return (
    <div role="img" aria-label="Sin imagen" className={`flex aspect-video items-center justify-center rounded-lg bg-[linear-gradient(160deg,#3A1E55,#1E1030)] text-vice-text/50 ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M21 16l-5-5-8 8" />
      </svg>
    </div>
  );
}

function CurrentImage({ item, className = '' }: { item: QueueItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!item.imagen_url || failed) return <Placeholder className={className} />;
  return (
    <img
      src={thumbUrl(item.imagen_url)}
      alt={item.imagen_alt || item.titulo}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`aspect-video w-full rounded-lg bg-vice-night object-cover ${className}`}
    />
  );
}

// ---- Medidor y contadores -----------------------------------------------------------------------
function Meter({ stats }: { stats: Stats | undefined }) {
  const own = stats?.propias ?? 0;
  const pct = Math.min(100, Math.round((own / GOAL) * 100));
  return (
    <div className="rounded-xl bg-white/5 p-4">
      <p className="font-display text-lg font-bold">
        Imágenes propias: {own} de {GOAL}
      </p>
      <div
        role="progressbar"
        aria-label="Imágenes propias cargadas"
        aria-valuemin={0}
        aria-valuemax={GOAL}
        aria-valuenow={Math.min(own, GOAL)}
        className="mt-2 h-3 overflow-hidden rounded-full bg-white/10"
      >
        <div className="h-full bg-vice-accent transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-vice-text/80">A partir de {GOAL} imágenes propias se pueden activar los anuncios.</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        {(
          [
            ['Sin imagen', stats?.sin_imagen],
            ['Provisionales', stats?.provisionales],
            ['Propias', stats?.propias],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-lg bg-white/5 px-2 py-2">
            <dt className="text-xs text-vice-text/75">{label}</dt>
            <dd className="font-display text-xl font-bold">{n ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---- Diálogo de carga individual (antes / después) ---------------------------------------------
function UploadDialog({ item, initial, onClose, onSaved }: { item: QueueItem; initial: File; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File>(initial);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [blocking, setBlocking] = useState<string | null>(checkBasics(initial));
  const [focus, setFocus] = useState({ x: 50, y: 50 });
  const [alt, setAlt] = useState(item.imagen_alt ?? '');
  const [busy, setBusy] = useState(false);
  const [srvErr, setSrvErr] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    let live = true;
    const basic = checkBasics(file);
    setBlocking(basic);
    setDims(null);
    setSrvErr(null);
    setFocus({ x: 50, y: 50 });
    if (basic) return;
    readDims(file).then(
      (d) => {
        if (!live) return;
        setDims(d);
        setBlocking(checkDims(d));
      },
      (e: unknown) => live && setBlocking(e instanceof Error ? e.message : 'No se pudo leer la imagen.'),
    );
    return () => {
      live = false;
    };
  }, [file]);

  const not169 = dims !== null && Math.abs(dims.w / dims.h - 16 / 9) > 0.01;
  const onFrameClick = (ev: MouseEvent<HTMLDivElement>) => {
    if (!not169) return;
    const r = ev.currentTarget.getBoundingClientRect();
    setFocus({
      x: Math.round(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100))),
      y: Math.round(Math.min(100, Math.max(0, ((ev.clientY - r.top) / r.height) * 100))),
    });
  };

  const save = async () => {
    if (blocking || busy) return;
    setBusy(true);
    setSrvErr(null);
    try {
      const res = await uploadImage(item.id, file, { focus: not169 ? focus : null, alt });
      setResult(res);
      onSaved();
    } catch (e) {
      setSrvErr(uploadErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = result ? (
    <button type="button" onClick={onClose} className={`${PRIMARY} w-full`}>
      Cerrar
    </button>
  ) : (
    <div className="flex flex-col gap-2">
      <div aria-live="assertive" className="text-sm">
        {srvErr && (
          <p role="alert" className="text-vice-gold">
            {srvErr}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onClose} disabled={busy} className={`${GHOST} flex-1`}>
          Cancelar
        </button>
        <button type="button" onClick={() => void save()} disabled={busy || blocking !== null || dims === null} className={`${PRIMARY} flex-1`}>
          {busy ? 'Guardando…' : 'Guardar imagen'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={`Imagen de «${item.titulo}»`} footer={footer} dismissOnBackdrop={false}>
      {result ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <p className="font-semibold text-vice-cyan">Imagen guardada.</p>
          <ul className="list-disc pl-5">
            <li>
              Versión grande: {fmtBytes(result.bytes)} ({result.width}×{result.height})
            </li>
            <li>Versión para listados: {fmtBytes(result.thumb_bytes)} (800×450)</li>
            <li>{result.cropped ? 'Se recortó para ajustarla a 16:9.' : 'Sin recorte: ya era 16:9.'}</li>
          </ul>
          <img src={mediaSrc(`${result.url}`)} alt="Resultado guardado" className="aspect-video w-full rounded-lg object-cover" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <figure>
              <figcaption className="mb-1 text-xs font-bold uppercase tracking-widest text-vice-text/75">Antes</figcaption>
              <CurrentImage item={item} />
            </figure>
            <figure>
              <figcaption className="mb-1 text-xs font-bold uppercase tracking-widest text-vice-text/75">Después</figcaption>
              <div
                onClick={onFrameClick}
                className={`relative aspect-video w-full touch-manipulation overflow-hidden rounded-lg bg-vice-night ${not169 ? 'cursor-crosshair' : ''}`}
              >
                {!blocking && (
                  <img src={url} alt="Vista previa del recorte" className="h-full w-full object-cover" style={{ objectPosition: `${focus.x}% ${focus.y}%` }} />
                )}
                {not169 && !blocking && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-vice-gold bg-vice-gold/30"
                    style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
                  />
                )}
              </div>
            </figure>
          </div>

          <p className="text-xs text-vice-text/80">
            {file.name} · {fmtBytes(file.size)}
            {dims ? ` · ${dims.w}×${dims.h} px` : ''}
          </p>
          <div aria-live="polite" className="flex flex-col gap-1 text-sm">
            {blocking && (
              <p role="alert" className="font-semibold text-vice-rose">
                {blocking}
              </p>
            )}
            {!blocking && not169 && <p className="font-semibold text-vice-gold">Se recortará a 16:9; ajusta el foco tocando la vista previa o con los controles.</p>}
            {!blocking && dims && !not169 && <p className="text-vice-cyan">Proporción 16:9: no necesita recorte.</p>}
          </div>

          {not169 && !blocking && (
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="mb-1 text-sm font-medium">
                Foco del recorte: {focus.x}% horizontal · {focus.y}% vertical
              </legend>
              <label className="text-xs">
                Horizontal
                <input type="range" min={0} max={100} value={focus.x} onChange={(ev) => setFocus((f) => ({ ...f, x: Number(ev.target.value) }))} className="h-11 w-full accent-vice-cyan" />
              </label>
              <label className="text-xs">
                Vertical
                <input type="range" min={0} max={100} value={focus.y} onChange={(ev) => setFocus((f) => ({ ...f, y: Number(ev.target.value) }))} className="h-11 w-full accent-vice-cyan" />
              </label>
            </fieldset>
          )}

          <div>
            <label htmlFor="img-alt" className="mb-1 block text-sm font-medium">
              Texto alternativo (opcional)
            </label>
            <input id="img-alt" value={alt} maxLength={200} onChange={(ev) => setAlt(ev.target.value)} className={INPUT} />
            <p className="mt-1 text-xs text-vice-text/70">Describe la imagen para personas con lector de pantalla. Máximo 200 caracteres.</p>
          </div>

          <div>
            <input
              ref={pick}
              type="file"
              accept={IMG_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (pick.current) pick.current.value = '';
                if (f) setFile(f);
              }}
            />
            <button type="button" disabled={busy} onClick={() => pick.current?.click()} className={SMALL_BTN}>
              Elegir otro archivo
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- Cola de trabajo ---------------------------------------------------------------------------
function Queue() {
  const { f, set, search, page, setPage } = useBlockFilters('imagenes', FILTER_DEFAULTS);
  const refresh = useRefreshImages();
  const [dialog, setDialog] = useState<{ item: QueueItem; file: File } | null>(null);
  const q = f.q;
  const estado = f.st === 'todas' ? 'todas' : 'pendientes';

  const list = useQuery({
    queryKey: ['staff', 'images-queue', f.m, q, estado, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      staffFetch<QueueResponse>(
        `/api/admin/images/queue?estado=${estado}&page=${page}&limit=${PER_PAGE}${f.m ? `&module=${encodeURIComponent(f.m)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { cache: 'no-cache' },
      ),
  });
  const stats = list.data?.stats;
  const perModule = list.data?.stats_por_modulo ?? {};
  const countOf = (s: Stats | undefined): string => (s ? String(estado === 'todas' ? s.total : s.sin_imagen + s.provisionales) : '…');
  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Meter stats={stats} />

      <div className="flex flex-wrap items-center gap-2">
        <SubTabs
          label="Estado de las fichas"
          tabs={[
            { id: 'pendientes', label: 'Pendientes' },
            { id: 'todas', label: 'Todas' },
          ]}
          value={estado}
          onChange={(id) => set({ st: id, p: '1' })}
        />
        <input type="search" aria-label="Buscar por nombre o slug" placeholder="Buscar por nombre o slug…" {...search} className={`${INPUT} min-w-0 flex-1 sm:max-w-xs`} />
      </div>
      <div role="group" aria-label="Filtrar por módulo" className="flex flex-wrap gap-2">
        {[{ slug: '', label: 'Todos' }, ...MODULE_OPTIONS].map((m) => (
          <button
            key={m.slug}
            type="button"
            aria-pressed={f.m === m.slug}
            onClick={() => set({ m: m.slug, p: '1' })}
            className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
              f.m === m.slug ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {m.label}
            <span className="rounded-full bg-black/25 px-2 text-xs">{countOf(m.slug ? perModule[m.slug] : stats)}</span>
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <ul aria-label="Cargando fichas" className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="h-24 animate-pulse rounded-xl bg-white/5 motion-reduce:animate-none" />
          ))}
        </ul>
      ) : (
        <QueryState
          loading={false}
          error={list.error}
          empty={!list.error && items.length === 0}
          emptyText={estado === 'pendientes' && !q && !f.m ? 'No hay fichas pendientes: ¡todo tiene imagen propia!' : 'Sin fichas con ese filtro.'}
          onRetry={() => void list.refetch()}
        />
      )}

      <ul className="flex flex-col gap-2">
        {items.map((it) => {
          const kind = kindOf(it);
          return (
            <li key={it.id} className={`${ROW} flex-nowrap items-stretch max-md:flex-wrap`}>
              <div className="w-28 shrink-0 max-md:w-24">
                <CurrentImage item={it} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{it.titulo}</p>
                <p className="break-all text-xs text-vice-text/70">
                  {moduleLabel(it.module_slug)} · /{it.slug}
                </p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${KIND_TONE[kind]}`}>{KIND_LABEL[kind]}</span>
              </div>
              <div className="w-full md:w-72">
                <DropZone compact label="Suelta aquí la imagen" buttonLabel="Elegir imagen" onFiles={(files) => files[0] && setDialog({ item: it, file: files[0] })} />
              </div>
            </li>
          );
        })}
      </ul>
      {list.data && list.data.total > 0 && <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}

      {dialog && <UploadDialog key={`${dialog.item.id}`} item={dialog.item} initial={dialog.file} onClose={() => setDialog(null)} onSaved={refresh} />}
    </div>
  );
}

export function ImagesManager() {
  const [mode, setMode] = useState<'cola' | 'masiva'>('cola');
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-white/5 p-4 text-sm leading-relaxed">
        <p className="font-semibold">Qué hace</p>
        <p className="mt-1 text-vice-text/85">
          Sube imágenes ya editadas en Photoshop, exportadas a {MIN_W}×{MIN_H} px en formato 16:9 (JPG, PNG o WebP, hasta 12 MB). Si no son 16:9, la app las recorta y
          te deja elegir el foco. Después genera la versión grande (ficha y portada) y una versión ligera para los listados.
        </p>
      </div>
      <SubTabs
        label="Forma de cargar"
        tabs={[
          { id: 'cola' as const, label: 'Una a una' },
          { id: 'masiva' as const, label: 'Carga masiva' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'cola' ? <Queue /> : <BulkUpload />}
    </div>
  );
}

export default ImagesManager;
