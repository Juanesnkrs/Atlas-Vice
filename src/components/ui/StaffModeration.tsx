// Módulo privado: cola de revisión de aportes. Se carga solo tras confirmar un rol de gestión (ver StaffPage).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isApiConfigured } from '../../store/useAuthStore';
import { BTN, errMsg, STATUS_LABEL, staffFetch, StatusBadge, TIPOS, type SubmissionDTO, type SubStatus } from './StaffKit';

export default function StaffModeration() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<SubStatus>('pending');
  const [note, setNote] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['submissions', 'queue', filter],
    enabled: isApiConfigured,
    queryFn: () => staffFetch<SubmissionDTO[]>(`/api/admin/submissions?status=${filter}&limit=100`),
  });

  const review = useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'rejected' }) =>
      staffFetch<SubmissionDTO>(`/api/admin/submissions/${v.id}`, { method: 'PATCH', json: { status: v.status } }),
    onSuccess: (_d, v) => {
      setNote(`Aporte ${v.status === 'approved' ? 'aprobado' : 'rechazado'}.`);
      void qc.invalidateQueries({ queryKey: ['submissions'] });
    },
    onError: (e) => setNote(`No se pudo actualizar: ${errMsg(e)}`),
  });

  return (
    <section aria-labelledby="mod-title" className="glass rounded-2xl p-5">
      <h2 id="mod-title" className="font-display text-xl font-bold">
        Cola de moderación
      </h2>
      <div role="group" aria-label="Estado" className="mt-3 flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected'] as const).map((st) => (
          <button
            key={st}
            type="button"
            aria-pressed={filter === st}
            onClick={() => setFilter(st)}
            className={`${BTN} ${filter === st ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/20'}`}
          >
            {STATUS_LABEL[st]}
          </button>
        ))}
      </div>
      <div aria-live="polite" className="min-h-[1.25rem] pt-2 text-sm text-vice-cyan">
        {note}
      </div>
      {queue.isLoading ? (
        <p role="status" className="text-sm">
          Cargando cola…
        </p>
      ) : queue.error ? (
        <p role="alert" className="text-sm text-vice-gold">
          No se pudo cargar la cola.
        </p>
      ) : (queue.data ?? []).length === 0 ? (
        <p className="text-sm text-vice-text/70">No hay aportes en este estado.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {(queue.data ?? []).map((s) => (
            <li key={s.id} className="rounded-xl bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {s.title}{' '}
                  <span className="text-xs font-normal text-vice-text/70">
                    · {TIPOS.find((t) => t.value === s.type)?.label ?? s.type} · {s.moduleSlug}
                  </span>
                </p>
                <StatusBadge status={s.status} />
              </div>
              {typeof s.payload.descripcion === 'string' && (
                <p className="mt-1 text-sm text-vice-text/85">{s.payload.descripcion}</p>
              )}
              {s.coords && (
                <p className="text-xs text-vice-text/70">
                  {typeof s.payload.region === 'string' ? `${s.payload.region} · ` : ''}X {s.coords.x} · Y {s.coords.y}
                </p>
              )}
              {s.status === 'pending' && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: s.id, status: 'approved' })}
                    className={`${BTN} bg-vice-cyan text-vice-ink`}
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: s.id, status: 'rejected' })}
                    className={`${BTN} bg-white/10 hover:bg-white/20`}
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
