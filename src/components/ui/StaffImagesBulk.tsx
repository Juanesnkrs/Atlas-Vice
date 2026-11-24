// Estudio de Imágenes (staff, ADMIN+): utilidades compartidas, zona de soltar y carga masiva por nombre de archivo.
// Cada archivo se llama `<slug>.png|jpg|jpeg|webp`. Flujo: validar en el navegador → emparejar con el servidor
// (solo lectura) → tabla de simulación → «Aplicar» (cola de 3 en paralelo) → informe. La simulación no escribe nada.
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../store/useAuthStore';
import { CONTENT_INVALIDATE } from './StaffModules';
import { BTN, GHOST, PRIMARY, SELECT, SMALL_BTN, staffFetch, toast } from './StaffKit';

// ---- Reglas de la especificación (Roadmap V1, Sprint 3) -----------------------------------------
export const IMG_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
export const IMG_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
export const MAX_BYTES = 12 * 1024 * 1024;
export const MIN_W = 1600;
export const MIN_H = 900;
export const MODULE_OPTIONS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'vehiculos', label: 'Vehículos' },
  { slug: 'armas', label: 'Armas' },
  { slug: 'guias', label: 'Guías' },
  { slug: 'mapa', label: 'Mapa' },
];
export const moduleLabel = (slug: string): string => MODULE_OPTIONS.find((m) => m.slug === slug)?.label ?? slug;

export const fmtBytes = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Tipo MIME del archivo; si el navegador no lo informa se deduce de la extensión. */
export function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : '';
}

/** Lee el ancho y alto reales del archivo (createImageBitmap; si falla, <img>). */
export async function readDims(file: File): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const out = { w: bmp.width, h: bmp.height };
    bmp.close();
    return out;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight };
    } catch {
      throw new Error('No se pudo leer la imagen. Comprueba que el archivo no esté dañado.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Errores bloqueantes que se detectan sin leer los píxeles (tipo y peso). */
export function checkBasics(file: File): string | null {
  if (!IMG_TYPES.includes(mimeOf(file))) return 'Tipo no admitido: usa JPG, PNG o WebP.';
  if (file.size > MAX_BYTES) return `La imagen pesa ${fmtBytes(file.size)}; el máximo es 12 MB.`;
  return null;
}
export const checkDims = (d: { w: number; h: number }): string | null =>
  d.w < MIN_W || d.h < MIN_H ? `Imagen demasiado pequeña: debe medir al menos ${MIN_W}×${MIN_H} px (recibida ${d.w}×${d.h}).` : null;

/** Mensaje legible de un fallo de red o del servidor (los 400 del servidor ya vienen en español). */
export function uploadErrMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
  return e instanceof Error ? e.message : 'No se pudo subir la imagen.';
}

export interface UploadResult {
  id: string;
  url: string;
  bytes: number;
  thumb_bytes: number;
  width: number;
  height: number;
  cropped: boolean;
  capturaPropiaPendiente: boolean;
}

/** Sube un archivo a una ficha. `focus` en % (0–100) y `alt` opcional (≤ 200). El servidor recorta con `cover`. */
export function uploadImage(entityId: string, file: File, opts: { focus?: { x: number; y: number } | null; alt?: string } = {}): Promise<UploadResult> {
  const qs = new URLSearchParams();
  if (opts.focus) qs.set('focus', `${Math.round(opts.focus.x)},${Math.round(opts.focus.y)}`);
  const alt = opts.alt?.trim();
  if (alt) qs.set('alt', alt.slice(0, 200));
  const q = qs.toString();
  return staffFetch<UploadResult>(`/api/admin/entities/${entityId}/image${q ? `?${q}` : ''}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': mimeOf(file) },
  });
}

/** Refresca la cola de imágenes y el contenido público en caché. */
export function useRefreshImages(): () => void {
  const qc = useQueryClient();
  return () => {
    for (const key of ['staff', ...CONTENT_INVALIDATE]) void qc.invalidateQueries({ queryKey: [key] });
  };
}

// ---- Zona de soltar (arrastrar y soltar + botón accesible) --------------------------------------
export function DropZone({
  onFiles,
  multiple,
  compact,
  label,
  hint,
  buttonLabel,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  compact?: boolean;
  label: string;
  hint?: ReactNode;
  buttonLabel: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (files.length > 0 && !disabled) onFiles(multiple ? files : files.slice(0, 1));
  };
  const onDrop = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setOver(false);
    take(ev.dataTransfer.files);
  };
  return (
    <div
      onDragOver={(ev) => {
        ev.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex items-center gap-3 rounded-xl border-2 border-dashed text-center ${
        over ? 'border-vice-gold bg-vice-gold/15' : 'border-white/25 bg-white/5'
      } ${compact ? 'flex-row justify-between px-3 py-2 text-left' : 'flex-col justify-center px-4 py-8'}`}
    >
      <input
        ref={input}
        type="file"
        accept={IMG_ACCEPT}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(ev) => take(ev.target.files)}
      />
      <div className="min-w-0">
        <p className={compact ? 'text-xs font-semibold' : 'font-display text-lg font-bold'}>{label}</p>
        {hint && <p className="mt-1 text-xs text-vice-text/75">{hint}</p>}
      </div>
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} className={compact ? SMALL_BTN : PRIMARY}>
        {buttonLabel}
      </button>
    </div>
  );
}

// ---- Carga masiva --------------------------------------------------------------------------------
interface Candidate {
  id: string;
  module_slug: string;
  slug: string;
  titulo: string;
  imagen_url: string | null;
  capturaPropiaPendiente: boolean;
}
interface MatchInfo {
  estado: 'encontrada' | 'ambigua' | 'no_encontrada';
  candidatos: Candidate[];
}
interface MatchResponse {
  matches: Record<string, MatchInfo>;
}
interface Entry {
  key: string;
  file: File;
  slug: string;
  /** Error local bloqueante (tipo, peso, dimensiones, lectura). */
  localError: string | null;
  /** Archivo sustituido por otro con el mismo slug (se usa el último). */
  superseded: boolean;
  match: MatchInfo | null;
  /** Candidato elegido para resolver una coincidencia ambigua. */
  chosen: string | null;
}
type Outcome = { ok: true; res: UploadResult } | { ok: false; reason: string };
type Phase = 'idle' | 'checking' | 'sim' | 'applying' | 'done';

const slugOfFile = (name: string): string => name.replace(/\.[^.]+$/, '').trim().toLowerCase();
const BATCH = 200;
const PARALLEL = 3;

/** Cola con tope de concurrencia; `worker` nunca lanza (los errores se devuelven como resultado). */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(lanes);
}

type Row = { entry: Entry; status: 'lista' | 'no_encontrada' | 'ambigua' | 'error' | 'repetido' | 'buscando'; target: Candidate | null; note: string };

function rowOf(e: Entry): Row {
  if (e.localError) return { entry: e, status: 'error', target: null, note: e.localError };
  if (e.superseded) return { entry: e, status: 'repetido', target: null, note: 'Repetido: se usa el último archivo con este nombre.' };
  if (!e.match) return { entry: e, status: 'buscando', target: null, note: 'Buscando la ficha…' };
  if (e.match.estado === 'encontrada') return { entry: e, status: 'lista', target: e.match.candidatos[0] ?? null, note: '' };
  if (e.match.estado === 'no_encontrada') return { entry: e, status: 'no_encontrada', target: null, note: 'Ninguna ficha tiene este slug.' };
  const picked = e.match.candidatos.find((c) => c.id === e.chosen) ?? null;
  return { entry: e, status: picked ? 'lista' : 'ambigua', target: picked, note: picked ? '' : 'Varias fichas comparten este slug: elige el módulo.' };
}

const STATUS_LABEL: Record<Row['status'], string> = {
  lista: 'Lista',
  no_encontrada: 'No encontrada',
  ambigua: 'Ambigua',
  error: 'No válida',
  repetido: 'Repetida',
  buscando: 'Buscando…',
};
const STATUS_TONE: Record<Row['status'], string> = {
  lista: 'bg-vice-cyan text-vice-ink',
  no_encontrada: 'bg-white/15',
  ambigua: 'bg-vice-gold text-vice-ink',
  error: 'bg-vice-rose text-vice-ink',
  repetido: 'bg-white/15',
  buscando: 'bg-white/15',
};

export function BulkUpload() {
  const refresh = useRefreshImages();
  const [phase, setPhase] = useState<Phase>('idle');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [moduleSlug, setModuleSlug] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [netErr, setNetErr] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const rows = useMemo(() => entries.map(rowOf), [entries]);
  const ready = rows.filter((r) => r.status === 'lista' && r.target);

  /** Pide al servidor los emparejamientos de los slugs dados (solo lectura, lotes de ≤ 200). */
  const matchSlugs = async (slugs: string[], mod: string): Promise<Record<string, MatchInfo>> => {
    const out: Record<string, MatchInfo> = {};
    for (let i = 0; i < slugs.length; i += BATCH) {
      const chunk = slugs.slice(i, i + BATCH);
      const qs = `slugs=${encodeURIComponent(chunk.join(','))}${mod ? `&module=${encodeURIComponent(mod)}` : ''}`;
      const res = await staffFetch<MatchResponse>(`/api/admin/images/match?${qs}`, { cache: 'no-cache' });
      Object.assign(out, res.matches);
    }
    return out;
  };

  const analyze = async (files: File[], base: Entry[], mod: string) => {
    setPhase('checking');
    setNetErr(null);
    const fresh: Entry[] = files.map((file, i) => ({
      key: `${Date.now()}-${base.length + i}-${file.name}`,
      file,
      slug: slugOfFile(file.name),
      localError: checkBasics(file),
      superseded: false,
      match: null,
      chosen: null,
    }));
    // Dimensiones reales, 3 a la vez para no saturar el navegador.
    await runPool(
      fresh.filter((e) => !e.localError),
      PARALLEL,
      async (e) => {
        try {
          e.localError = checkDims(await readDims(e.file));
        } catch (err) {
          e.localError = err instanceof Error ? err.message : 'No se pudo leer la imagen.';
        }
      },
    );
    if (!alive.current) return;
    const all = markDuplicates([...base, ...fresh]);
    setEntries(all);
    await applyMatches(all, mod);
  };

  const markDuplicates = (list: Entry[]): Entry[] => {
    const last = new Map<string, string>();
    for (const e of list) if (!e.localError) last.set(e.slug, e.key);
    return list.map((e) => ({ ...e, superseded: !e.localError && last.get(e.slug) !== e.key }));
  };

  const applyMatches = async (list: Entry[], mod: string) => {
    const slugs = [...new Set(list.filter((e) => !e.localError && !e.superseded).map((e) => e.slug))];
    try {
      const found = slugs.length > 0 ? await matchSlugs(slugs, mod) : {};
      if (!alive.current) return;
      setEntries(list.map((e) => ({ ...e, match: e.localError || e.superseded ? null : (found[e.slug] ?? { estado: 'no_encontrada', candidatos: [] }), chosen: null })));
      setPhase('sim');
    } catch (err) {
      if (!alive.current) return;
      setNetErr(uploadErrMsg(err));
      setPhase('sim');
    }
  };

  const onFiles = (files: File[]) => {
    const base = phase === 'sim' ? entries : [];
    if (phase === 'done') {
      setOutcomes({});
    }
    void analyze(files, base, moduleSlug);
  };

  const onModule = (slug: string) => {
    setModuleSlug(slug);
    if (entries.length > 0 && phase === 'sim') void applyMatches(entries, slug);
  };

  const apply = async () => {
    const jobs = ready.flatMap((r) => (r.target ? [{ key: r.entry.key, file: r.entry.file, id: r.target.id }] : []));
    if (jobs.length === 0) return;
    setPhase('applying');
    setOutcomes({});
    setProgress({ done: 0, total: jobs.length });
    await runPool(jobs, PARALLEL, async (job) => {
      let outcome: Outcome;
      try {
        outcome = { ok: true, res: await uploadImage(job.id, job.file) };
      } catch (err) {
        outcome = { ok: false, reason: uploadErrMsg(err) };
      }
      if (!alive.current) return;
      setOutcomes((o) => ({ ...o, [job.key]: outcome }));
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    });
    if (!alive.current) return;
    setPhase('done');
    refresh();
  };

  const reset = () => {
    setEntries([]);
    setOutcomes({});
    setNetErr(null);
    setPhase('idle');
  };

  const report = useMemo(() => buildReport(rows, outcomes), [rows, outcomes]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.text);
      toast.ok('Reporte copiado.');
    } catch {
      toast.err('No se pudo copiar. Selecciona el texto del informe y cópialo a mano.');
    }
  };

  const busy = phase === 'checking' || phase === 'applying';
  return (
    <div className="flex flex-col gap-4">
      {phase !== 'done' && (
        <>
          <DropZone
            multiple
            onFiles={onFiles}
            disabled={busy}
            label="Soltar varios archivos"
            buttonLabel="Elegir archivos"
            hint={
              <>
                Cada archivo se llama como la ficha: <code>buccaneer.png</code>, <code>pistola-9mm.webp</code>… (JPG, PNG o WebP; hasta 12 MB; mínimo 1600×900 px).
                Primero verás una simulación y no se guardará nada hasta pulsar «Aplicar».
              </>
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              Buscar solo en
              <select value={moduleSlug} onChange={(ev) => onModule(ev.target.value)} disabled={busy} className={`${SELECT} w-auto`}>
                <option value="">Todos los módulos</option>
                {MODULE_OPTIONS.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {entries.length > 0 && (
              <button type="button" onClick={reset} disabled={busy} className={GHOST}>
                Vaciar lista
              </button>
            )}
          </div>
        </>
      )}

      <div aria-live="polite" className="text-sm">
        {phase === 'checking' && <p role="status">Revisando archivos y buscando sus fichas…</p>}
        {netErr && (
          <p role="alert" className="flex flex-wrap items-center gap-3 text-vice-gold">
            {netErr}
            <button type="button" onClick={() => void applyMatches(entries, moduleSlug)} className={SMALL_BTN}>
              Reintentar
            </button>
          </p>
        )}
      </div>

      {(phase === 'sim' || phase === 'applying') && rows.length > 0 && (
        <section aria-label="Simulación de la carga">
          <p className="mb-2 text-sm text-vice-text/85">
            Simulación: {ready.length} lista{ready.length === 1 ? '' : 's'} de {rows.length} archivo{rows.length === 1 ? '' : 's'}. Todavía no se ha guardado nada.
          </p>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const out = outcomes[r.entry.key];
              return (
                <li key={r.entry.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block break-all font-semibold">{r.entry.file.name}</span>
                    <span className="block text-xs text-vice-text/75">
                      {fmtBytes(r.entry.file.size)}
                      {r.target ? ` · ${r.target.titulo} (${moduleLabel(r.target.module_slug)})` : ''}
                      {r.note ? ` · ${r.note}` : ''}
                    </span>
                  </span>
                  {r.status === 'ambigua' && r.entry.match && (
                    <select
                      aria-label={`Elegir módulo para ${r.entry.file.name}`}
                      value={r.entry.chosen ?? ''}
                      onChange={(ev) => setEntries((l) => l.map((x) => (x.key === r.entry.key ? { ...x, chosen: ev.target.value || null } : x)))}
                      className={`${SELECT} w-auto`}
                    >
                      <option value="">Elegir módulo…</option>
                      {r.entry.match.candidatos.map((c) => (
                        <option key={c.id} value={c.id}>
                          {moduleLabel(c.module_slug)} · {c.titulo}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${out ? (out.ok ? 'bg-vice-cyan text-vice-ink' : 'bg-vice-rose text-vice-ink') : STATUS_TONE[r.status]}`}>
                    {out ? (out.ok ? 'Guardada' : 'Con error') : STATUS_LABEL[r.status]}
                  </span>
                  {out && !out.ok && <span className="basis-full text-xs text-vice-gold">{out.reason}</span>}
                </li>
              );
            })}
          </ul>
          {phase === 'applying' ? (
            <div className="mt-3" role="status" aria-live="polite">
              <p className="text-sm font-semibold">
                Subiendo {progress.done} de {progress.total}…
              </p>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <div className="h-full bg-vice-accent transition-[width] motion-reduce:transition-none" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-vice-text/75">Puedes seguir usando el panel mientras tanto.</p>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" disabled={ready.length === 0} onClick={() => void apply()} className={PRIMARY}>
                Aplicar {ready.length} imagen{ready.length === 1 ? '' : 'es'}
              </button>
            </div>
          )}
        </section>
      )}

      {phase === 'done' && (
        <section aria-label="Reporte final" aria-live="polite" className="rounded-xl bg-white/5 p-4 text-sm">
          <h3 className="font-display text-lg font-bold">Reporte final</h3>
          <ul className="mt-2 grid gap-1 sm:grid-cols-4">
            <li>
              <strong>{report.updated.length}</strong> actualizadas
            </li>
            <li>
              <strong>{report.notFound.length}</strong> no encontradas
            </li>
            <li>
              <strong>{report.unresolved.length}</strong> ambiguas sin resolver
            </li>
            <li>
              <strong>{report.failed.length}</strong> con error
            </li>
          </ul>
          {report.failed.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-vice-gold">
              {report.failed.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <textarea readOnly value={report.text} rows={6} aria-label="Texto del reporte" className="mt-3 w-full rounded-xl border border-white/15 bg-white/10 p-3 font-mono text-xs" />
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => void copy()} className={GHOST}>
              Copiar reporte
            </button>
            <button type="button" onClick={reset} className={`${BTN} bg-vice-accent font-bold text-vice-ink`}>
              Cargar más
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function buildReport(rows: Row[], outcomes: Record<string, Outcome>) {
  const updated: string[] = [];
  const notFound: string[] = [];
  const unresolved: string[] = [];
  const failed: string[] = [];
  for (const r of rows) {
    const name = r.entry.file.name;
    const out = outcomes[r.entry.key];
    if (out) {
      if (out.ok) updated.push(`${name} → ${r.target?.titulo ?? r.entry.slug} (${fmtBytes(out.res.bytes)}, ${out.res.cropped ? 'recortada' : 'sin recorte'})`);
      else failed.push(`${name}: ${out.reason}`);
    } else if (r.status === 'no_encontrada') notFound.push(name);
    else if (r.status === 'ambigua') unresolved.push(name);
    else if (r.status === 'error') failed.push(`${name}: ${r.note}`);
    else if (r.status === 'repetido') failed.push(`${name}: ${r.note}`);
  }
  const block = (title: string, list: string[]) => `${title} (${list.length})${list.length ? `\n${list.map((l) => `- ${l}`).join('\n')}` : ''}`;
  const text = [
    'Reporte de carga masiva de imágenes',
    block('Actualizadas', updated),
    block('No encontradas', notFound),
    block('Ambiguas sin resolver', unresolved),
    block('Con error', failed),
  ].join('\n\n');
  return { updated, notFound, unresolved, failed, text };
}
