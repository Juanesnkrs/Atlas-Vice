// Formularios y borrado seguro de los módulos privados de gestión: FormModal (borrador en memoria, aviso de cambios
// sin guardar, sin cierre por clic en el fondo), SafeDelete (escribir el slug exacto + dependientes) y useCrud
// (formulario + mutación + aviso + invalidación). Solo lo importan los módulos Staff*.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useStaffStore, type FormValues } from '../../store/useStaffStore';
import { Modal } from './Modal';
import { BTN, errMsg, GHOST, INPUT, PRIMARY, staffFetch, toast } from './StaffKit';

const snapshot = (form: HTMLFormElement): FormValues =>
  Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
const sameValues = (a: FormValues, b: FormValues): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** Vuelca un borrador en los campos nombrados del formulario (campos no controlados). */
function applyValues(form: HTMLFormElement, values: FormValues): void {
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) || !el.name) continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) el.checked = el.name in values;
    else el.value = values[el.name] ?? '';
  }
  // Los campos controlados (p. ej. EntityPicker) se resincronizan al oír este evento.
  form.dispatchEvent(new Event('staff-draft-applied'));
}

function DraftForm({
  formId,
  draftKey,
  onSubmit,
  discard,
  children,
}: {
  formId: string;
  draftKey: string;
  onSubmit: (fd: FormData) => void;
  discard: { current: (() => void) | null };
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const initial = useRef<FormValues>({});
  const [recovered, setRecovered] = useState(false);

  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const st = useStaffStore.getState();
    initial.current = snapshot(form);
    const draft = st.drafts[draftKey];
    if (draft) {
      applyValues(form, draft);
      setRecovered(true);
    }
    st.markForm(draftKey, draft !== undefined && !sameValues(draft, initial.current));
    discard.current = () => {
      form.reset();
      st.clearDraft(draftKey);
      st.markForm(draftKey, false);
      form.dispatchEvent(new Event('staff-draft-applied'));
      setRecovered(false);
    };
    return () => {
      discard.current = null;
      useStaffStore.getState().unmarkForm(draftKey);
    };
  }, [draftKey, discard]);

  const track = () => {
    const form = formRef.current;
    if (!form) return;
    const st = useStaffStore.getState();
    const now = snapshot(form);
    if (sameValues(now, initial.current)) {
      st.clearDraft(draftKey);
      st.markForm(draftKey, false);
    } else {
      st.setDraft(draftKey, now);
      st.markForm(draftKey, true);
    }
  };
  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    onSubmit(new FormData(ev.currentTarget));
  };
  return (
    <form id={formId} ref={formRef} onSubmit={submit} onInput={track} onChange={track} className="flex flex-col gap-3" noValidate>
      {recovered && (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-vice-gold/15 px-3 py-2 text-sm">
          Se recuperó un borrador sin guardar.
          <button type="button" onClick={() => discard.current?.()} className="font-semibold underline underline-offset-2">
            Descartar borrador
          </button>
        </p>
      )}
      {children}
    </form>
  );
}

/**
 * Formulario modal del panel. No se cierra con el clic en el fondo; si hay cambios sin guardar, Cancelar/X/Esc piden
 * confirmación (inline, sin diálogos anidados). Mantiene un borrador en memoria por `draftKey` (`tipo:id|new`) que se
 * recupera al reabrir y se borra al guardar o al descartar.
 */
export function FormModal({
  open,
  title,
  formId,
  draftKey,
  pending,
  error,
  onClose,
  children,
  onSubmit,
}: {
  open: boolean;
  title: string;
  formId: string;
  draftKey: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  children: ReactNode;
  onSubmit: (fd: FormData) => void;
}) {
  const dirty = useStaffStore((s) => s.openForms[draftKey] === true);
  const [confirming, setConfirming] = useState(false);
  const discard = useRef<(() => void) | null>(null);

  const requestClose = useCallback(() => {
    if (useStaffStore.getState().sessionExpired) return;
    if (!useStaffStore.getState().openForms[draftKey]) return onClose();
    setConfirming((c) => !c);
  }, [draftKey, onClose]);
  const leave = () => {
    useStaffStore.getState().clearDraft(draftKey);
    setConfirming(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={title}
      dismissOnBackdrop={false}
      footer={
        <div className="flex flex-col gap-2">
          {/* El error vive en la zona fija: nunca queda oculto bajo el scroll del formulario. */}
          <div aria-live="assertive" className="text-sm">
            {error && (
              <p role="alert" className="text-vice-gold">
                {error}
              </p>
            )}
          </div>
          {confirming && dirty ? (
            <div role="alertdialog" aria-label="Cambios sin guardar" className="flex flex-col gap-2 rounded-xl bg-vice-gold/15 p-3 text-sm">
              <p className="font-semibold">Hay cambios sin guardar. ¿Descartarlos?</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setConfirming(false)} className={`${GHOST} flex-1`}>
                  Seguir editando
                </button>
                <button type="button" onClick={leave} className={`${BTN} flex-1 bg-vice-rose font-bold text-vice-ink`}>
                  Descartar cambios
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button type="button" onClick={requestClose} className={`${GHOST} flex-1`}>
                Cancelar
              </button>
              <button type="submit" form={formId} disabled={pending} className={`${PRIMARY} flex-1`}>
                {pending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}
        </div>
      }
    >
      <DraftForm formId={formId} draftKey={draftKey} onSubmit={onSubmit} discard={discard}>
        {children}
      </DraftForm>
    </Modal>
  );
}

// ---- Borrado seguro --------------------------------------------------------------------------------
export type DependentsType = 'thread' | 'entity' | 'marker' | 'module';
export interface DeleteTarget {
  type: DependentsType | 'post' | 'slide';
  id: string;
  /** Nombre legible del objeto. */
  label: string;
  /** Texto exacto que hay que escribir (slug; id corto o título si no hay slug). `null` = sin escribir nada (respuestas). */
  confirmText: string | null;
  /** Qué es `confirmText`, para indicarlo en pantalla. */
  confirmKind?: 'slug' | 'id' | 'título';
}

interface Dependents {
  replies?: number;
  votes?: number;
  markers?: Array<{ id: string; titulo: string }>;
  threads?: number;
  entities?: number;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Resumen de dependientes y si bloquean el borrado (ficha con pines, módulo con fichas: el servidor responde 409). */
function dependentsSummary(d: Dependents): { lines: string[]; blocked: string | null } {
  const lines: string[] = [];
  let blocked: string | null = null;
  if (d.replies !== undefined) lines.push(`Se borrarán también ${plural(d.replies, 'respuesta', 'respuestas')} y ${plural(d.votes ?? 0, 'voto', 'votos')}.`);
  if (d.markers && d.markers.length > 0) {
    blocked = `La ficha tiene ${plural(d.markers.length, 'pin', 'pines')} en el mapa (${d.markers.map((m) => `«${m.titulo}»`).join(', ')}). Bórralos o desvincúlalos antes.`;
  }
  if (d.entities !== undefined && d.entities > 0) {
    blocked = `El módulo tiene ${plural(d.entities, 'ficha', 'fichas')}. Muévelas o bórralas antes.`;
  }
  if (d.threads) lines.push(`${plural(d.threads, 'hilo del foro enlaza', 'hilos del foro enlazan')} este objeto; quedarán sin enlace.`);
  return { lines, blocked };
}

/**
 * Confirmación de borrado: hay que escribir el texto exacto para habilitar «Borrar» y se muestran los dependientes.
 * El borrado queda en la auditoría con una copia completa, restaurable por el nivel máximo.
 */
export function SafeDelete({
  target,
  ...rest
}: {
  target: DeleteTarget | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return target ? <SafeDeleteDialog key={`${target.type}:${target.id}`} target={target} {...rest} /> : null;
}

function SafeDeleteDialog({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  // Las respuestas del foro y las diapositivas del Hero no tienen dependientes que consultar.
  const noDeps = target.type === 'post' || target.type === 'slide';
  const deps = useQuery({
    queryKey: ['staff', 'dependents', target.type, target.id],
    enabled: !noDeps,
    queryFn: () => staffFetch<Dependents>(`/api/admin/dependents/${target.type}/${target.id}`),
    gcTime: 0,
  });
  const summary = deps.data ? dependentsSummary(deps.data) : { lines: [], blocked: null };
  const needsText = target.confirmText !== null;
  const matches = !needsText || typed === target.confirmText;
  const ready = matches && !summary.blocked && (noDeps || deps.isSuccess);

  return (
    <Modal
      open
      onClose={onCancel}
      title="Confirmar borrado"
      dismissOnBackdrop={false}
      footer={
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={`${GHOST} flex-1`}>
            Cancelar
          </button>
          <button type="button" disabled={pending || !ready} onClick={onConfirm} className={`${BTN} flex-1 bg-vice-rose font-bold text-vice-ink`}>
            {pending ? 'Borrando…' : 'Borrar'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Se borrará «{target.label}». {noDeps ? 'Esta acción no se puede deshacer.' : 'Quedará una copia en la auditoría y el nivel máximo podrá restaurarla.'}
        </p>
        {!noDeps && deps.isLoading && <p role="status">Comprobando dependientes…</p>}
        {!noDeps && deps.error && (
          <p role="alert" className="text-vice-gold">
            No se pudieron comprobar los dependientes: {errMsg(deps.error)}
          </p>
        )}
        {summary.lines.map((l) => (
          <p key={l} className="rounded-lg bg-white/5 px-3 py-2">
            {l}
          </p>
        ))}
        {summary.blocked && (
          <p role="alert" className="rounded-lg bg-vice-rose/20 px-3 py-2 font-semibold">
            {summary.blocked}
          </p>
        )}
        {needsText && (
          <label className="flex flex-col gap-1">
            <span>
              Escribe <strong className="font-mono">{target.confirmText}</strong> ({target.confirmKind === 'id' ? 'identificador corto' : target.confirmKind === 'título' ? 'título; este objeto no tiene slug' : 'slug'}) para confirmar:
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Texto de confirmación"
              className={INPUT}
            />
          </label>
        )}
      </div>
    </Modal>
  );
}

// ---- Patrón CRUD -----------------------------------------------------------------------------------
export interface CrudConfig {
  /** Tipo del borrador (`entity`, `marker`…): la clave final es `tipo:id|new`. */
  draftType: string;
  /** URL de guardado: POST sin id, PATCH con id. */
  saveUrl: (id: string | null) => string;
  /** URL de borrado (si el bloque borra). */
  deleteUrl?: (id: string) => string;
  /** Raíces de queryKey a refrescar además de las del panel (`staff`). */
  invalidate: readonly string[];
  messages: { created: string; saved: string; deleted?: string };
}

/**
 * Patrón común de gestor: formulario modal + mutación de guardado + borrado seguro + aviso + invalidación.
 * Los errores de guardado se muestran en el propio formulario; los de borrado, como aviso.
 */
export function useCrud<T extends { id: string }>(cfg: CrudConfig) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ item: T | null } | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const draftKey = `${cfg.draftType}:${editing?.item?.id ?? 'new'}`;

  const refresh = useCallback(() => {
    for (const key of ['staff', ...cfg.invalidate]) void qc.invalidateQueries({ queryKey: [key] });
  }, [qc, cfg.invalidate]);

  const save = useMutation({
    mutationFn: (v: { id: string | null; body: Record<string, unknown> }) =>
      staffFetch(cfg.saveUrl(v.id), { method: v.id ? 'PATCH' : 'POST', json: v.body }),
    onSuccess: (_d, v) => {
      toast.ok(v.id ? cfg.messages.saved : cfg.messages.created);
      useStaffStore.getState().clearDraft(`${cfg.draftType}:${v.id ?? 'new'}`);
      setEditing(null);
      refresh();
    },
    onError: (e) => setFormErr(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => staffFetch(cfg.deleteUrl!(id), { method: 'DELETE' }),
    onSuccess: () => {
      toast.ok(cfg.messages.deleted ?? 'Borrado.');
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      toast.err(`No se pudo borrar: ${errMsg(e)}`);
      setDeleting(null);
      refresh();
    },
  });

  return {
    editing,
    item: editing?.item ?? null,
    draftKey,
    formErr,
    setFormErr,
    openNew: () => {
      setFormErr(null);
      setEditing({ item: null });
    },
    openEdit: (item: T) => {
      setFormErr(null);
      setEditing({ item });
    },
    closeForm: () => setEditing(null),
    save: (id: string | null, body: Record<string, unknown>) => save.mutate({ id, body }),
    saving: save.isPending,
    deleting,
    askDelete: (t: DeleteTarget) => setDeleting(t),
    cancelDelete: () => setDeleting(null),
    confirmDelete: () => deleting && remove.mutate(deleting.id),
    removing: remove.isPending,
    refresh,
  };
}
