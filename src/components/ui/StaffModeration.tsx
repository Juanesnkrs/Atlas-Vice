// Bloque «Aportes» de la sección Comunidad y moderación (MODERATOR+): bandeja de /aportar. Aprobar crea o actualiza la
// entidad o el marcador correspondiente (lo hace el servidor, con auditoría); rechazar solo cierra el aporte.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Block,
  BTN,
  errMsg,
  PRIMARY,
  QueryState,
  STATUS_LABEL,
  staffFetch,
  StatusBadge,
  SubTabs,
  TIPOS,
  toast,
  type SubmissionDTO,
  type SubStatus,
} from './StaffKit';

const TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(TIPOS.map((t) => [t.value, t.label])),
  contact: 'Mensaje de contacto',
  newsletter: 'Suscripción al boletín',
};
const STATES: ReadonlyArray<{ id: SubStatus; label: string }> = (['pending', 'approved', 'rejected'] as const).map((id) => ({
  id,
  label: STATUS_LABEL[id],
}));

export default function StaffModeration() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<SubStatus>('pending');

  const queue = useQuery({
    queryKey: ['staff', 'submissions', filter],
    queryFn: () => staffFetch<SubmissionDTO[]>(`/api/admin/submissions?status=${filter}&limit=100`),
  });

  const review = useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'rejected' }) =>
      staffFetch<SubmissionDTO>(`/api/admin/submissions/${v.id}`, { method: 'PATCH', json: { status: v.status } }),
    onSuccess: (_d, v) => {
      toast.ok(v.status === 'approved' ? 'Aporte aprobado y publicado.' : 'Aporte rechazado.');
      for (const key of ['staff', 'world', 'entity']) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast.err(`No se pudo actualizar el aporte: ${errMsg(e)}`),
  });

  const rows = queue.data ?? [];
  return (
    <Block
      id="blk-aportes"
      title="Bandeja de aportes"
      controls="las sugerencias enviadas desde Aportar. Al aprobar un aporte se publica la ficha o el marcador en el catálogo y el mapa."
      href="/aportar"
      linkLabel="Abrir Aportar"
    >
      <SubTabs label="Estado" tabs={STATES} value={filter} onChange={setFilter} />
      <QueryState
        loading={queue.isLoading}
        error={queue.error}
        empty={!queue.isLoading && !queue.error && rows.length === 0}
        emptyText="No hay aportes en este estado."
        onRetry={() => void queue.refetch()}
      />
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((s) => (
          <li key={s.id} className="rounded-xl bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                {s.title}{' '}
                <span className="text-xs font-normal text-vice-text/70">
                  · {TYPE_LABEL[s.type] ?? s.type} · {s.moduleSlug}
                </span>
              </p>
              <StatusBadge status={s.status} />
            </div>
            {typeof s.payload.descripcion === 'string' && <p className="mt-1 text-sm text-vice-text/85">{s.payload.descripcion}</p>}
            {typeof s.payload.message === 'string' && <p className="mt-1 text-sm text-vice-text/85">{s.payload.message}</p>}
            {typeof s.payload.email === 'string' && <p className="text-xs text-vice-text/70">{s.payload.email}</p>}
            {s.coords && (
              <p className="text-xs text-vice-text/70">
                {typeof s.payload.region === 'string' ? `${s.payload.region} · ` : ''}X {s.coords.x} · Y {s.coords.y}
              </p>
            )}
            {s.status === 'pending' && (
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={review.isPending} onClick={() => review.mutate({ id: s.id, status: 'approved' })} className={`${PRIMARY} px-5`}>
                  Aprobar
                </button>
                <button type="button" disabled={review.isPending} onClick={() => review.mutate({ id: s.id, status: 'rejected' })} className={`${BTN} bg-white/10 hover:bg-white/20`}>
                  Rechazar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Block>
  );
}
