// Sección «Editorial y automatización» del panel de gestión (ADMIN+): worker de noticias oficiales y guías publicadas.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { relativeTime } from '../../data/seed';
import { CatalogManager } from './StaffContent';
import { Block, errMsg, PRIMARY, QueryState, ROW, staffFetch, toast } from './StaffKit';

interface NewsStatus {
  worker: {
    enabled: boolean;
    schedule: string;
    running: boolean;
    trigger: 'cron' | 'manual' | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastResults: Array<{ source: string; inserted: number; error: string | null }>;
    nextRunAt: string | null;
  };
  sources: Array<{ id: string; url: string; count: number; lastPublishedAt: string | null; lastIngestedAt: string | null }>;
  total: number;
}

const fmt = (iso: string | null): string => (iso ? `${new Date(iso).toLocaleString('es')} (${relativeTime(iso)})` : 'sin datos');

function NewsWorker() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['staff', 'news-status'],
    queryFn: () => staffFetch<NewsStatus>('/api/admin/news/status'),
    // Mientras corre una sincronización se consulta cada 3 s hasta que termina.
    refetchInterval: (q) => (q.state.data?.worker.running ? 3000 : false),
  });
  const sync = useMutation({
    mutationFn: () => staffFetch<{ started: boolean }>('/api/admin/news/sync', { method: 'POST', json: {} }),
    onSuccess: () => {
      toast.ok('Sincronización iniciada.');
      void qc.invalidateQueries({ queryKey: ['staff', 'news-status'] });
    },
    onError: (e) => toast.err(`No se pudo iniciar la sincronización: ${errMsg(e)}`),
  });
  const w = status.data?.worker;
  return (
    <Block
      id="blk-worker"
      title="Noticias oficiales (worker)"
      controls="las noticias de /noticias, que solo vienen de fuentes oficiales de Rockstar Games y Take-Two en lista blanca."
      href="/noticias"
      linkLabel="Abrir noticias"
    >
      <QueryState loading={status.isLoading} error={status.error} empty={false} emptyText="" onRetry={() => void status.refetch()} />
      {w && status.data && (
        <>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">Estado: </dt>
              <dd className="inline">{w.running ? 'sincronizando ahora…' : w.enabled ? 'activo' : 'desactivado (NEWS_WORKER_ENABLED=false)'}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Programación: </dt>
              <dd className="inline">cada 15 min ({w.schedule})</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Última sincronización: </dt>
              <dd className="inline">{fmt(w.lastFinishedAt)}{w.trigger ? ` · ${w.trigger === 'manual' ? 'manual' : 'programada'}` : ''}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Próxima: </dt>
              <dd className="inline">{w.nextRunAt ? new Date(w.nextRunAt).toLocaleTimeString('es') : '—'}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-vice-text/70">El estado del ciclo se guarda en memoria: se reinicia con el servidor.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {status.data.sources.map((s) => {
              const last = w.lastResults.find((r) => r.source === s.id);
              return (
                <li key={s.id} className={ROW}>
                  <span className="min-w-0">
                    <span className="font-semibold">{s.id}</span>
                    <span className="block truncate text-xs text-vice-text/70">{s.url}</span>
                    <span className="block text-xs text-vice-text/70">
                      {s.count} noticias · última publicada: {fmt(s.lastPublishedAt)}
                    </span>
                  </span>
                  <span className={`text-xs font-bold ${last?.error ? 'text-vice-gold' : 'text-vice-cyan'}`}>
                    {last ? (last.error ? `Error: ${last.error}` : `Último ciclo: ${last.inserted} nuevas`) : 'Sin ciclo desde el arranque'}
                  </span>
                </li>
              );
            })}
          </ul>
          <button type="button" disabled={w.running || sync.isPending} onClick={() => sync.mutate()} className={`${PRIMARY} mt-4`}>
            {w.running ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </>
      )}
    </Block>
  );
}

export default function StaffEditorial() {
  return (
    <div className="flex flex-col gap-4">
      <NewsWorker />
      <Block
        id="blk-guias"
        title="Guías publicadas"
        controls="las guías de /guias, con sus pasos (metadata.steps) para los datos estructurados HowTo."
        href="/guias"
        linkLabel="Abrir guías"
      >
        <CatalogManager fixedModule="guias" />
      </Block>
    </div>
  );
}
