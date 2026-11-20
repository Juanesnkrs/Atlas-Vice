// Utilidades compartidas de los módulos privados de gestión (chunks `staff-*`). Nada de este archivo
// se importa desde código público: solo lo cargan StaffPage, StaffModeration, StaffControl y CatalogAdminPanel.
import { ApiError, apiFetch, useAuthStore } from '../../store/useAuthStore';

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

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Error desconocido');

/**
 * Cliente de la API para los módulos de gestión. El servidor responde 404 uniforme (y, según el despliegue,
 * 401/403) a quien no tiene acceso: se trata como «sin acceso» sin mostrar mensajes sobre permisos; se descarta
 * el rol local y `/_staff` vuelve a la vista 404 estándar.
 */
export async function staffFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  try {
    return await apiFetch<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 401 || e.status === 403)) {
      useAuthStore.getState().dropElevatedRole();
    }
    throw e;
  }
}

export function StatusBadge({ status }: { status: SubStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
  );
}
