// Bloque «Auditoría y salud» de Control Total (chunk `staff-ctl-*`, solo SUPER_ADMIN): bitácora filtrable de cambios
// administrativos y métricas reales del servicio (MongoDB, proceso, worker y caché).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Block, errMsg, GHOST, INPUT, Pager, QueryState, SELECT, SMALL_BTN, staffFetch, SubTabs, toast } from './StaffKit';

interface AuditEntry {
  id: string;
  actor_id: string;
  actor_name: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
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

function AuditLog() {
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [actor, setActor] = useState<{ id: string; name: string } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const qs = new URLSearchParams({ limit: '25', page: String(page) });
  if (action) qs.set('action', action);
  if (target) qs.set('target_type', target);
  if (actor) qs.set('actor_id', actor.id);
  if (from) qs.set('from', dayStart(from));
  if (to) qs.set('to', dayEnd(to));
  const logs = useQuery({
    queryKey: ['staff', 'audit', qs.toString()],
    placeholderData: keepPreviousData,
    queryFn: () => staffFetch<AuditPage>(`/api/admin/audit-logs?${qs.toString()}`),
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const rows = logs.data?.logs ?? [];
  const f = logs.data?.facets;

  return (
    <Block id="blk-audit" title="Bitácora de auditoría" controls="nada directamente: registra quién cambió qué en la app pública (catálogo, mapa, foro, configuración, roles)." >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select aria-label="Acción" value={action} onChange={(e) => reset(setAction)(e.target.value)} className={SELECT}>
          <option value="">Todas las acciones</option>
          {(f?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select aria-label="Tipo de objetivo" value={target} onChange={(e) => reset(setTarget)(e.target.value)} className={SELECT}>
          <option value="">Todos los objetivos</option>
          {(f?.targetTypes ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          Desde
          <input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} className={INPUT} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Hasta
          <input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} className={INPUT} />
        </label>
      </div>
      {(actor || action || target || from || to) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {actor && <span>Actor: {actor.name}</span>}
          <button
            type="button"
            onClick={() => {
              setAction('');
              setTarget('');
              setActor(null);
              setFrom('');
              setTo('');
              setPage(1);
            }}
            className={SMALL_BTN}
          >
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
                <button type="button" onClick={() => reset(setActor)({ id: l.actor_id, name: l.actor_name ?? l.actor_id.slice(0, 8) })} className="ml-2 underline">
                  Filtrar por este actor
                </button>
              )}
            </p>
            {Object.keys(l.metadata ?? {}).length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-vice-gold">Detalle</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 text-xs">{JSON.stringify(l.metadata, null, 2)}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
      {logs.data && logs.data.total > 0 && <Pager page={logs.data.page} pages={logs.data.pages} total={logs.data.total} onPage={setPage} />}
    </Block>
  );
}

const fmtUptime = (s: number): string => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min ${s % 60} s`);

function HealthPanel() {
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

type Sub = 'auditoria' | 'salud';
const SUBS: ReadonlyArray<{ id: Sub; label: string }> = [
  { id: 'auditoria', label: 'Bitácora' },
  { id: 'salud', label: 'Salud' },
];

export default function StaffAudit() {
  const [sub, setSub] = useState<Sub>('auditoria');
  return (
    <div className="flex flex-col gap-4">
      <SubTabs label="Auditoría y salud" tabs={SUBS} value={sub} onChange={setSub} />
      {sub === 'auditoria' ? <AuditLog /> : <HealthPanel />}
    </div>
  );
}
