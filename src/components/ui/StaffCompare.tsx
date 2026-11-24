// Comparación lado a lado de un aporte del pipeline (staff → Comunidad y moderación → Aportes, MODERATOR+).
// «Ficha actual» frente a «Propuesta del pipeline», con las diferencias marcadas con una etiqueta «Cambia» (no solo
// color), la imagen actual frente a la provisional y tres decisiones claras. El servidor decide; esta UI es cosmética.
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { mediaSrc } from '../../data/seed';
import { ApiError, API_URL } from '../../store/useAuthStore';
import { Modal } from './Modal';
import { BTN, errMsg, GHOST, PRIMARY, SMALL_BTN, staffFetch, toast } from './StaffKit';

type Accion = 'mantener' | 'aceptar' | 'solo_imagen';
type Rec = Record<string, unknown>;

interface Version {
  titulo?: string;
  subtitulo?: string | null;
  categoria?: string | null;
  descripcion?: string | null;
  metadata?: Rec;
  confianza?: string | number | null;
  fuente?: string | null;
  fuente_url?: string | null;
}
interface CompareDTO {
  submission_id: string;
  estado: string;
  reason: 'nueva' | 'actualizada' | 'conflicto';
  entity: { slug: string; titulo: string; confianza?: string | number | null; fuente?: string | null } | null;
  actual: Version | null;
  propuesta: Version;
  diferencias: Array<{ campo: string; actual: unknown; propuesta: unknown }>;
  imagen: { actual_url: string | null; propuesta: { bytes: number; sha256: string } | null; thumb_url_propuesta: string | null };
  puede_solo_imagen: boolean;
  puede_aceptar: boolean;
}

const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const blank = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(blank(a) ? null : a) === JSON.stringify(blank(b) ? null : b);

const LABEL: Record<string, string> = {
  marca: 'Marca', plazas: 'Plazas', municion: 'Munición', ubicacion: 'Ubicación', clase: 'Clase', traccion: 'Tracción',
  marchas: 'Marchas', peso_kg: 'Peso (kg)', basado_en: 'Basado en', apariciones: 'Apariciones', carroceria: 'Carrocería',
  precio: 'Precio', velocidad_punta: 'Velocidad punta', aceleracion: 'Aceleración', adquisicion: 'Adquisición', slot: 'Ranura',
  dano: 'Daño', cadencia: 'Cadencia', alcance: 'Alcance', genero: 'Género', region: 'Región', steps: 'Pasos',
  capitulo: 'Capítulo', protagonistas: 'Protagonistas', stats_juego: 'Estadísticas de juego',
};
/** Claves técnicas o de origen: no se muestran en «Más datos». */
const HIDDEN = new Set(['descripcion', 'fuente', 'fuente_url', 'confianza', 'evidencia', 'notas', 'contentHash', 'content_hash', 'sha256', 'capturaPropiaPendiente', 'tarjeta']);
const human = (k: string): string => LABEL[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function Val({ v }: { v: unknown }) {
  if (blank(v)) return <span className="text-vice-text/60">Sin dato</span>;
  if (typeof v === 'boolean') return <>{v ? 'Sí' : 'No'}</>;
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) return <>{v.map(String).join(', ')}</>;
    return (
      <ol className="ml-5 list-decimal space-y-1">
        {v.map((x, i) => (
          <li key={i}>
            <Val v={x} />
          </li>
        ))}
      </ol>
    );
  }
  if (isRec(v)) {
    return (
      <dl className="space-y-0.5">
        {Object.entries(v)
          .filter(([k]) => !HIDDEN.has(k))
          .map(([k, x]) => (
            <div key={k} className="flex flex-wrap gap-x-2">
              <dt className="font-semibold">{human(k)}:</dt>
              <dd className="min-w-0 break-words">
                <Val v={x} />
              </dd>
            </div>
          ))}
      </dl>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{String(v)}</span>;
}

function Field({ label, changed, children }: { label: string; changed: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${changed ? 'border-l-4 border-vice-gold bg-vice-gold/10' : 'border-l-4 border-transparent bg-white/5'}`}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-vice-text/70">
        {label}
        {changed && <span className="rounded-full bg-vice-gold px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal text-vice-ink">Cambia</span>}
      </p>
      <div className="mt-0.5 break-words text-sm">{children}</div>
    </div>
  );
}

const kb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('es')} KB`;
const apiUrl = (u: string): string => (u.startsWith('/') ? `${API_URL}${u}` : u);

function Skeleton() {
  return (
    <div role="status" aria-label="Cargando comparación" className="grid gap-4 md:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          {[10, 10, 10, 28, 10].map((h, j) => (
            <div key={j} style={{ height: `${h * 4}px` }} className="animate-pulse rounded-lg bg-white/10" />
          ))}
        </div>
      ))}
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

function Imagen({ d, id }: { d: CompareDTO; id: string }) {
  const [badActual, setBadActual] = useState(false);
  const [badProp, setBadProp] = useState(false);
  const actual = d.imagen.actual_url;
  const prop = d.imagen.propuesta;
  const thumb = d.imagen.thumb_url_propuesta ? apiUrl(d.imagen.thumb_url_propuesta) : `${API_URL}/api/admin/submissions/${id}/tarjeta.webp`;
  const frame = 'flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-[#0b0f1f] text-sm text-vice-text/70';
  return (
    <section aria-label="Imagen" className="grid gap-4 md:grid-cols-2">
      <figure>
        <figcaption className="mb-1 text-sm font-semibold">Imagen actual</figcaption>
        <div className={frame}>
          {actual && !badActual ? (
            <img src={mediaSrc(actual)} alt="Imagen actual de la ficha" onError={() => setBadActual(true)} className="h-full w-full object-contain" />
          ) : (
            <span>{actual ? 'No se pudo cargar la imagen' : 'Sin imagen'}</span>
          )}
        </div>
      </figure>
      <figure>
        <figcaption className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
          Imagen provisional propuesta
          {prop && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium">{kb(prop.bytes)}</span>}
        </figcaption>
        <div className={frame}>
          {prop && !badProp ? (
            <img src={thumb} alt="Imagen provisional propuesta por el pipeline" onError={() => setBadProp(true)} className="h-full w-full object-contain" />
          ) : (
            <span>{prop ? 'No se pudo cargar la miniatura' : 'El aporte no trae imagen'}</span>
          )}
        </div>
        {prop && <p className="mt-1 text-xs text-vice-text/75">Imagen de terceros, transitoria: se sustituye cuando haya una captura propia.</p>}
      </figure>
    </section>
  );
}

export function CompareDialog({
  id,
  title,
  onClose,
  onResolved,
}: {
  id: string;
  title: string;
  onClose: () => void;
  /** Se llama tras resolver (o si ya estaba procesado) para refrescar bandeja y contadores. */
  onResolved: () => void;
}) {
  const q = useQuery({
    queryKey: ['staff', 'compare', id],
    retry: false,
    staleTime: 0,
    queryFn: () => staffFetch<CompareDTO>(`/api/admin/submissions/${id}/compare`),
  });
  const [busy, setBusy] = useState<Accion | null>(null);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const d = q.data;

  const resolve = async (accion: Accion): Promise<void> => {
    if (busy) return;
    setBusy(accion);
    setMsg(null);
    try {
      await staffFetch(`/api/admin/submissions/${id}/resolve`, { method: 'POST', json: { accion } });
      toast.ok(
        accion === 'mantener' ? 'Se mantuvo la ficha actual y el aporte quedó cerrado.' : accion === 'aceptar' ? 'Se aplicó la versión del pipeline.' : 'Se aplicó solo la imagen propuesta.',
      );
      onResolved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.err('Este aporte ya lo resolvió otra persona. Actualizamos la bandeja.');
        onResolved();
        onClose();
      } else {
        const m = errMsg(e);
        setMsg(m);
        toast.err(m);
      }
    } finally {
      setBusy(null);
      setConfirmAccept(false);
    }
  };

  const conflict = d?.reason === 'conflicto';
  const diffSet = new Set((d?.diferencias ?? []).map((x) => x.campo));
  const changed = (campo: string, a: unknown, b: unknown): boolean => d !== undefined && d.actual !== null && (diffSet.has(campo) || !same(a, b));
  const a = d?.actual ?? null;
  const p = d?.propuesta;

  const metaKeys = (() => {
    if (!d || !p) return [] as string[];
    const keys = new Set([...Object.keys(a?.metadata ?? {}), ...Object.keys(p.metadata ?? {})]);
    return [...keys].filter((k) => !HIDDEN.has(k));
  })();
  const metaChanged = (k: string): boolean =>
    d !== undefined && a !== null && (diffSet.has(`metadata.${k}`) || diffSet.has(`metadata_json.${k}`) || diffSet.has(k) || !same(a.metadata?.[k], p?.metadata?.[k]));

  const column = (v: Version | null, side: 'actual' | 'propuesta'): ReactNode => {
    if (v === null) return <p className="rounded-lg bg-white/5 px-3 py-3 text-sm">Todavía no existe una ficha con este identificador: el aporte crearía una nueva.</p>;
    const other = side === 'actual' ? p : a;
    const ch = (campo: string, x: unknown, y: unknown): boolean => other !== null && other !== undefined && changed(campo, x, y);
    return (
      <div className="space-y-2">
        <Field label="Título" changed={ch('titulo', v.titulo, other?.titulo)}>
          {v.titulo}
        </Field>
        <Field label="Subtítulo" changed={ch('subtitulo', v.subtitulo, other?.subtitulo)}>
          <Val v={v.subtitulo} />
        </Field>
        <Field label="Categoría" changed={ch('categoria', v.categoria, other?.categoria)}>
          <Val v={v.categoria} />
        </Field>
        <Field label="Descripción" changed={ch('descripcion', v.descripcion, other?.descripcion)}>
          <Val v={v.descripcion} />
        </Field>
        <Field label="Confianza" changed={ch('confianza', v.confianza, other?.confianza)}>
          <Val v={v.confianza ?? (side === 'actual' ? d?.entity?.confianza : undefined)} />
        </Field>
        <Field label="Fuente" changed={ch('fuente', v.fuente, other?.fuente)}>
          <Val v={v.fuente ?? (side === 'actual' ? d?.entity?.fuente : undefined)} />
        </Field>
      </div>
    );
  };

  const soloImagenWhy = !d ? '' : d.puede_solo_imagen ? '' : d.imagen.propuesta === null ? 'El aporte no trae imagen.' : 'La ficha ya tiene imagen.';

  const footer = (
    <div className="flex flex-col gap-2">
      <div aria-live="assertive">
        {msg && (
          <p role="alert" className="text-sm text-vice-gold">
            {msg}
          </p>
        )}
      </div>
      {d && conflict && !confirmAccept && (
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-start">
          <button type="button" disabled={busy !== null} onClick={() => void resolve('mantener')} className={`${PRIMARY} px-5`}>
            {busy === 'mantener' ? 'Guardando…' : 'Mantener mi ficha'}
          </button>
          <div className="flex flex-col gap-1">
            <button type="button" disabled={busy !== null || !d.puede_solo_imagen} onClick={() => void resolve('solo_imagen')} className={`${GHOST} px-5`}>
              {busy === 'solo_imagen' ? 'Guardando…' : 'Usar solo la imagen'}
            </button>
            {soloImagenWhy && <span className="text-xs text-vice-text/80">{soloImagenWhy}</span>}
          </div>
          <div className="flex flex-col gap-1 md:ml-auto">
            <button
              type="button"
              disabled={busy !== null || !d.puede_aceptar}
              onClick={() => setConfirmAccept(true)}
              className={`${BTN} border border-vice-rose/60 px-5 text-vice-rose hover:bg-white/10`}
            >
              Aceptar la versión del pipeline
            </button>
            {!d.puede_aceptar && <span className="text-xs text-vice-text/80">No se puede aceptar en este aporte.</span>}
          </div>
        </div>
      )}
      {d && conflict && confirmAccept && (
        <div role="alertdialog" aria-label="Confirmar reemplazo" className="flex flex-col gap-2 rounded-xl bg-vice-rose/15 p-3 text-sm">
          <p className="font-semibold">Esto reemplaza el texto actual de la ficha por el del pipeline. Los cambios hechos a mano se perderán. ¿Continuar?</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" autoFocus onClick={() => setConfirmAccept(false)} className={`${GHOST} flex-1`}>
              Volver
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void resolve('aceptar')} className={`${BTN} flex-1 bg-vice-rose font-bold text-vice-ink`}>
              {busy === 'aceptar' ? 'Aplicando…' : 'Sí, reemplazar el texto'}
            </button>
          </div>
        </div>
      )}
      {(!d || !conflict) && (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          {d && <p className="text-xs text-vice-text/80">Vista previa de solo lectura. Aprueba o rechaza desde la fila del aporte.</p>}
          <button type="button" onClick={onClose} className={`${GHOST} px-5`}>
            Cerrar
          </button>
        </div>
      )}
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`Comparar: ${title}`} wide footer={footer}>
      {q.isPending ? (
        <Skeleton />
      ) : q.isError || !d || !p ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-vice-gold">
          <span>
            {q.error instanceof ApiError && q.error.status === 422
              ? 'Este aporte no es una ficha del pipeline, no hay nada que comparar.'
              : `No se pudo cargar la comparación: ${errMsg(q.error)}`}
          </span>
          <button type="button" onClick={() => void q.refetch()} className={SMALL_BTN}>
            Reintentar
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            {d.reason === 'conflicto'
              ? 'La ficha actual tiene cambios hechos a mano y el pipeline propone otra versión. Los campos distintos llevan la etiqueta «Cambia». Lo más seguro es mantener tu ficha.'
              : d.reason === 'actualizada'
                ? 'El pipeline propone una actualización de una ficha existente.'
                : 'El pipeline propone una ficha nueva.'}
            {d.diferencias.length > 0 && <span className="ml-1 font-semibold">Diferencias: {d.diferencias.length}.</span>}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <section aria-label="Ficha actual">
              <h3 className="mb-2 font-display text-base font-bold">Ficha actual</h3>
              {column(a, 'actual')}
            </section>
            <section aria-label="Propuesta del pipeline">
              <h3 className="mb-2 font-display text-base font-bold">Propuesta del pipeline</h3>
              {column(p, 'propuesta')}
            </section>
          </div>
          <Imagen d={d} id={id} />
          {metaKeys.length > 0 && (
            <details className="rounded-xl bg-white/5 px-3 py-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold">
                Más datos ({metaKeys.length})
              </summary>
              <div className="grid gap-x-4 gap-y-2 pb-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                {metaKeys.map((k) => {
                  const ch = metaChanged(k);
                  return (
                    <div key={k} className="contents">
                      <Field label={`${human(k)} · actual`} changed={ch}>
                        <Val v={a?.metadata?.[k]} />
                      </Field>
                      <Field label={`${human(k)} · propuesta`} changed={ch}>
                        <Val v={p.metadata?.[k]} />
                      </Field>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
