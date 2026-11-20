// Utilidades compartidas de los módulos privados de gestión (chunks `staff-*`). Nada de este archivo
// se importa desde código público: solo lo cargan StaffPage y los módulos Staff*.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiFetch, useAuthStore } from '../../store/useAuthStore';
import { Modal } from './Modal';

export type Role = string;
export const ROLE_ORDER: readonly Role[] = ['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];
export const rankOf = (r: Role | null): number => (r === null ? -1 : ROLE_ORDER.indexOf(r));

export type SubStatus = 'pending' | 'approved' | 'rejected';
export interface SubmissionDTO {
  id: string;
  userId: string;
  moduleSlug: string;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  coords: { x: number; y: number } | null;
  status: SubStatus;
  reviewedBy: string | null;
  createdAt?: string;
}

export const TIPOS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'marker', label: 'Marcador / ubicación' },
  { value: 'entity', label: 'Entidad (arma, vehículo, coleccionable, guía)' },
  { value: 'correction', label: 'Corrección de un dato' },
];
export const STATUS_LABEL: Record<SubStatus, string> = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
const STATUS_TONE: Record<SubStatus, string> = {
  pending: 'bg-vice-gold text-vice-ink',
  approved: 'bg-vice-cyan text-vice-ink',
  rejected: 'bg-vice-rose text-vice-ink',
};

export const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
export const SELECT = `${INPUT} bg-[#2e1a47]`;
export const BTN =
  'flex min-h-11 items-center justify-center rounded-xl px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-50';
export const PRIMARY = `${BTN} bg-vice-accent font-bold text-vice-ink`;
export const GHOST = `${BTN} bg-white/10 hover:bg-white/20`;
export const SMALL_BTN = `${BTN} bg-white/10 px-3 text-sm hover:bg-white/20`;
export const DANGER_BTN = `${BTN} border border-vice-rose/60 px-3 text-sm text-vice-rose hover:bg-white/10`;
export const ROW = 'flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2';
/** Margen inferior de toda vista del panel: el dock flotante y el área segura de iOS nunca tapan las acciones. */
export const PAGE_PAD = 'pb-[calc(7rem+env(safe-area-inset-bottom))]';

/** Aplana el árbol de errores de Zod (`details` de la API) en mensajes legibles. */
function flattenDetails(node: unknown, path: string, out: string[]): void {
  if (node === null || typeof node !== 'object') return;
  const n = node as { errors?: unknown; properties?: Record<string, unknown>; items?: unknown[] };
  if (Array.isArray(n.errors)) for (const m of n.errors) out.push(path ? `${path}: ${String(m)}` : String(m));
  for (const [k, v] of Object.entries(n.properties ?? {})) flattenDetails(v, path ? `${path}.${k}` : k, out);
  (n.items ?? []).forEach((v, i) => flattenDetails(v, `${path}[${i + 1}]`, out));
}

export const errMsg = (e: unknown): string => {
  if (e instanceof ApiError && e.details) {
    const out: string[] = [];
    flattenDetails(e.details, '', out);
    if (out.length) return out.slice(0, 4).join(' · ');
  }
  return e instanceof Error ? e.message : 'Error desconocido';
};

/**
 * Cliente de la API para los módulos de gestión. El servidor responde 404 uniforme con el cuerpo `No encontrado`
 * (y, según el despliegue, 401/403) a quien no tiene acceso: solo eso se trata como «sin acceso» (se descarta el
 * rol local y `/_staff` vuelve a la vista 404 estándar). Un 404 de negocio («Entidad no encontrada») NO expulsa
 * al staff: se muestra como error de la acción.
 */
export async function staffFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  try {
    return await apiFetch<T>(path, { cache: 'no-store', ...init });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || (e.status === 404 && e.message === 'No encontrado'))) {
      useAuthStore.getState().dropElevatedRole();
    }
    throw e;
  }
}

// ---- Avisos (toasts) de éxito y error ---------------------------------------------------------
interface ToastItem {
  id: number;
  ok: boolean;
  text: string;
}
const listeners = new Set<(t: ToastItem) => void>();
let seq = 0;
const emit = (ok: boolean, text: string): void => {
  const t = { id: ++seq, ok, text };
  listeners.forEach((l) => l(t));
};
export const toast = { ok: (text: string): void => emit(true, text), err: (text: string): void => emit(false, text) };

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const on = (t: ToastItem) => {
      setItems((p) => [...p.slice(-2), t]);
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== t.id)), t.ok ? 4000 : 8000);
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4"
    >
      {items.map((t) => (
        <p
          key={t.id}
          role={t.ok ? 'status' : 'alert'}
          className={`pointer-events-auto glass max-w-xl rounded-xl px-4 py-2 text-sm font-semibold ${t.ok ? 'text-vice-cyan' : 'text-vice-gold'}`}
        >
          {t.text}
        </p>
      ))}
    </div>
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ---- Presentación común -----------------------------------------------------------------------
export function StatusBadge({ status }: { status: SubStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
  );
}

/** Enlace a una vista pública en pestaña nueva. */
export function PublicLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-vice-gold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold"
    >
      {children}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

/** Bloque funcional: título, «Qué controla en la app pública» y enlace a la vista pública. */
export function Block({
  id,
  title,
  controls,
  href,
  linkLabel,
  children,
}: {
  id: string;
  title: string;
  controls: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <h2 id={id} className="font-display text-xl font-bold">
          {title}
        </h2>
        {href && <PublicLink href={href}>{linkLabel ?? 'Abrir en la app'}</PublicLink>}
      </div>
      <p className="mt-1 text-sm text-vice-text/80">
        <strong className="font-semibold text-vice-text">Qué controla en la app pública:</strong> {controls}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-vice-text/70">{hint}</p>}
    </div>
  );
}

export function SubTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
          className={`${BTN} ${value === t.id ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/20'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <nav aria-label="Paginación" className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-vice-text/80" role="status">
        {total} resultado{total === 1 ? '' : 's'} · página {page} de {pages}
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={SMALL_BTN}>
          Anterior
        </button>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className={SMALL_BTN}>
          Siguiente
        </button>
      </div>
    </nav>
  );
}

/** Estado de carga / error con reintento / vacío de una consulta. */
export function QueryState({
  loading,
  error,
  empty,
  emptyText,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText: string;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <p role="status" className="py-3 text-sm">
        Cargando…
      </p>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 py-3 text-sm text-vice-gold">
        <span>No se pudo cargar: {errMsg(error)}</span>
        <button type="button" onClick={onRetry} className={SMALL_BTN}>
          Reintentar
        </button>
      </div>
    );
  }
  return empty ? <p className="py-3 text-sm text-vice-text/70">{emptyText}</p> : null;
}

// ---- Diálogos de formulario y de confirmación de borrado ----------------------------------------
export function ConfirmDelete({
  label,
  pending,
  onCancel,
  onConfirm,
}: {
  label: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={label !== null}
      onClose={onCancel}
      title="Confirmar borrado"
      footer={
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className={`${GHOST} flex-1`}>
            Cancelar
          </button>
          <button type="button" disabled={pending} onClick={onConfirm} className={`${BTN} flex-1 bg-vice-rose font-bold text-vice-ink`}>
            {pending ? 'Borrando…' : 'Borrar'}
          </button>
        </div>
      }
    >
      <p className="text-sm">Se borrará «{label}». Esta acción no se puede deshacer.</p>
    </Modal>
  );
}

export function FormModal({
  open,
  title,
  formId,
  pending,
  error,
  onClose,
  children,
  onSubmit,
}: {
  open: boolean;
  title: string;
  formId: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  children: ReactNode;
  onSubmit: (fd: FormData) => void;
}) {
  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    onSubmit(new FormData(ev.currentTarget));
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
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
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className={`${GHOST} flex-1`}>
              Cancelar
            </button>
            <button type="submit" form={formId} disabled={pending} className={`${PRIMARY} flex-1`}>
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {children}
      </form>
    </Modal>
  );
}

export const formGet = (fd: FormData) => ({
  s: (k: string): string => String(fd.get(k) ?? '').trim(),
  n: (k: string): string | null => String(fd.get(k) ?? '').trim() || null,
});
