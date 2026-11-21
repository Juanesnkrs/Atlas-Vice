// Bloques «Auditoría» y «Salud» de Control Total (chunk `staff-ctl-*`, solo SUPER_ADMIN): bitácora filtrable de cambios
// administrativos con diff legible y restauración de borrados, y métricas reales del servicio (MongoDB, proceso, worker y caché).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal } from './Modal';
import { Block, BTN, errMsg, GHOST, INPUT, Pager, QueryState, SELECT, SMALL_BTN, staffFetch, toast } from './StaffKit';
import { DiffView } from './StaffHistory';
import { useBlockFilters } from './StaffNav';

interface AuditEntry {
  id: string;
  actor_id: string;
  actor_name: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  /** Hay una copia completa que permite reinsertar el objeto borrado. */
  restorable: boolean;
  /** Ya se restauró a partir de esta entrada. */
  restored: boolean;
  ip: string | null;
  created_at: string;
}
interface AuditPage {
  logs: AuditEntry[];
  total: number;
  page: number;
  pages: number;
  facets: { actions: string[]; targetTypes: string[] };
}
interface Health {
  status: string;
  checkedAt: string;
  mongo: {
    ok: boolean;
    pingMs: number;
    db: string;
    readyState: number;
    dataSizeKB: number;
    storageSizeKB: number;
    collections: Array<{ name: string; count: number }>;
  };
  process: { node: string; uptimeS: number; rssMB: number; heapUsedMB: number };
  worker: { enabled: boolean; running: boolean; lastFinishedAt: string | null; nextRunAt: string | null };
  cache: { ssrEntries: number; publicJson: string; compression: string };
}

const dayStart = (d: string): string => new Date(`${d}T00:00:00`).toISOString();
const dayEnd = (d: string): string => new Date(`${d}T23:59:59.999`).toISOString();
/** Nombre legible del objeto de una entrada (título, slug o id corto). */
const labelOf = (l: AuditEntry): string => String(l.metadata['titulo'] ?? l.metadata['slug'] ?? l.target_id?.slice(0, 8) ?? l.target_type);

export default function StaffAudit() {
  const qc = useQueryClient();
  const { f, set, page, setPage } = useBlockFilters('auditoria', { action: '', tipo: '', actor: '', desde: '', hasta: '', p: '1' });
  const [restoring, setRestoring] = useState<AuditEntry | null>(null);

  const qs = new URLSearchParams({ limit: '25', page: String(page) });
  if (f.action) qs.set('action', f.action);
  if (f.tipo) qs.set('target_type', f.tipo);
  if (f.actor) qs.set('actor_id', f.actor);
  if (f.desde) qs.set('from', dayStart(f.desde));
  if (f.hasta) qs.set('to', dayEnd(f.hasta));
  const logs = useQuery({
    queryKey: ['staff', 'audit', qs.toString()],
    placeholderData: keepPreviousData,
    queryFn: () => staffFetch<AuditPage>(`/api/admin/audit-logs?${qs.toString()}`),
  });
  const rows = logs.data?.logs ?? [];
  const facets = logs.data?.facets;
  const actorName = rows.find((r) => r.actor_id === f.actor)?.actor_name ?? f.actor.slice(0, 8);

  const restore = useMutation({
    mutationFn: (id: string) => staffFetch<{ restored: { type: string; id: string } }>(`/api/admin/audit-logs/${id}/restore`, { method: 'POST', json: {} }),
    onSuccess: (r) => {
      toast.ok(`Restaurado (${r.restored.type}) con su identificador original.`);
      for (const key of ['staff', 'world', 'entity', 'config']) void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => toast.err(`No se pudo restaurar: ${errMsg(e)}`),
    onSettled: () => setRestoring(null),
  });

  return (
    <Block
      id="blk-audit"
      title="Bitácora de auditoría"
      controls="nada directamente: registra quién cambió qué en la app pública (catálogo, mapa, foro, configuración, roles). Los borrados se pueden restaurar."
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select aria-label="Acción" value={f.action} onChange={(e) => set({ action: e.target.value, p: '1' })} className={SELECT}>
          <option value="">Todas las acciones</option>
          {(facets?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select aria-label="Tipo de objetivo" value={f.tipo} onChange={(e) => set({ tipo: e.target.value, p: '1' })} className={SELECT}>
          <option value="">Todos los objetivos</option>
          {(facets?.targetTypes ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          Desde
          <input type="date" value={f.desde} onChange={(e) => set({ desde: e.target.value, p: '1' })} className={INPUT} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Hasta
          <input type="date" value={f.hasta} onChange={(e) => set({ hasta: e.target.value, p: '1' })} className={INPUT} />
        </label>
      </div>
      {(f.actor || f.action || f.tipo || f.desde || f.hasta) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {f.actor && <span>Actor: {actorName}</span>}
          <button type="button" onClick={() => set({ action: '', tipo: '', actor: '', desde: '', hasta: '', p: '1' })} className={SMALL_BTN}>
            Quitar filtros
          </button>
        </div>
      )}
      <QueryState
        loading={logs.isLoading}
        error={logs.error}
        empty={!logs.isLoading && !logs.error && rows.length === 0}
        emptyText="Sin eventos con ese filtro."
        onRetry={() => void logs.refetch()}
      />
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((l) => (
          <li key={l.id} className="rounded-xl bg-white/5 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{l.action}</p>
              <p className="text-xs text-vice-text/70">{new Date(l.created_at).toLocaleString('es')}</p>
            </div>
            <p className="text-xs text-vice-text/70">
              {l.actor_name ?? l.actor_id.slice(0, 8)} · {l.actor_role} · {l.target_type}
              {l.target_id ? `:${l.target_id.slice(0, 8)}` : ''}
              {l.actor_id !== 'system' && (
                <button type="button" onClick={() => set({ actor: l.actor_id, p: '1' })} className="ml-2 inline-flex min-h-11 items-center underline">
                  Filtrar por este actor
                </button>
              )}
            </p>
            {Object.keys(l.metadata ?? {}).length > 0 && (
              <details className="mt-1">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-vice-gold">Detalle</summary>
                <div className="mt-1 rounded-lg bg-black/30 p-2">
                  <DiffView metadata={l.metadata} />
                </div>
              </details>
            )}
            {l.restored && <p className="mt-1 inline-block rounded-full bg-vice-cyan px-2 py-0.5 text-xs font-bold text-vice-ink">Restaurado</p>}
            {l.restorable && !l.restored && (
              <button type="button" onClick={() => setRestoring(l)} className={`${SMALL_BTN} mt-1`}>
                Restaurar
              </button>
            )}
          </li>
        ))}
      </ul>
      {logs.data && logs.data.total > 0 && <Pager page={logs.data.page} pages={logs.data.pages} total={logs.data.total} onPage={setPage} />}

      <Modal
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title="Restaurar objeto borrado"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setRestoring(null)} className={`${GHOST} flex-1`}>
              Cancelar
            </button>
            <button type="button" disabled={restore.isPending} onClick={() => restoring && restore.mutate(restoring.id)} className={`${BTN} flex-1 bg-vice-accent font-bold text-vice-ink`}>
              {restore.isPending ? 'Restaurando…' : 'Restaurar'}
            </button>
          </div>
        }
      >
        <p className="text-sm">
          Se reinsertará «{restoring ? labelOf(restoring) : ''}» ({restoring?.target_type}) con el mismo identificador. Si ese identificador o su slug ya existen, el servidor lo rechazará.
        </p>
      </Modal>
    </Block>
  );
}

const fmtUptime = (s: number): string => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min ${s % 60} s`);

export function HealthPanel() {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['staff', 'health'], queryFn: () => staffFetch<Health>('/api/admin/health') });
  const clear = useMutation({
    mutationFn: () => staffFetch<{ cleared: number }>('/api/admin/cache/clear', { method: 'POST', json: {} }),
    onSuccess: (r) => {
      toast.ok(`Caché SSR vaciada (${r.cleared} entradas).`);
      void qc.invalidateQueries({ queryKey: ['staff', 'health'] });
    },
    onError: (e) => toast.err(`No se pudo vaciar la caché: ${errMsg(e)}`),
  });
  const h = health.data;
  return (
    <Block id="blk-health" title="Salud del sistema" controls="la disponibilidad de la base de datos y de los servicios que alimentan todas las páginas públicas.">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={health.isFetching} onClick={() => void health.refetch()} className={GHOST}>
          {health.isFetching ? 'Actualizando…' : 'Actualizar'}
        </button>
        <button type="button" disabled={clear.isPending} onClick={() => clear.mutate()} className={GHOST}>
          Vaciar caché SSR
        </button>
      </div>
      <QueryState loading={health.isLoading} error={health.error} empty={false} emptyText="" onRetry={() => void health.refetch()} />
      {h && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <section aria-label="MongoDB" className="rounded-xl bg-white/5 p-3 text-sm">
            <h3 className="font-semibold">MongoDB: {h.mongo.ok ? 'operativo' : 'caído'}</h3>
            <p className="text-vice-text/80">
              Base «{h.mongo.db}» · ping {h.mongo.pingMs} ms · datos {h.mongo.dataSizeKB} KB · almacenamiento {h.mongo.storageSizeKB} KB
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 text-xs">
              {h.mongo.collections.map((c) => (
                <li key={c.name} className="flex justify-between">
                  <span>{c.name}</span>
                  <span className="tabular-nums">{c.count}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Servicios" className="rounded-xl bg-white/5 p-3 text-sm">
            <h3 className="font-semibold">Servicios</h3>
            <ul className="mt-1 flex flex-col gap-1 text-vice-text/80">
              <li>API: {h.status} · Node {h.process.node} · en marcha {fmtUptime(h.process.uptimeS)}</li>
              <li>Memoria: {h.process.rssMB} MB (heap {h.process.heapUsedMB} MB)</li>
              <li>
                Worker de noticias: {h.worker.running ? 'sincronizando' : h.worker.enabled ? 'activo' : 'desactivado'}
                {h.worker.lastFinishedAt ? ` · último ciclo ${new Date(h.worker.lastFinishedAt).toLocaleTimeString('es')}` : ''}
              </li>
              <li>Caché SSR: {h.cache.ssrEntries} entradas (TTL 5 min)</li>
              <li>Caché de API pública: {h.cache.publicJson}</li>
              <li>Compresión: {h.cache.compression}</li>
              <li className="text-xs">Comprobado {new Date(h.checkedAt).toLocaleTimeString('es')}</li>
            </ul>
          </section>
        </div>
      )}
    </Block>
  );
}
