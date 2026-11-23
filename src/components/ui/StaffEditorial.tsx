// Sección «Editorial y automatización» del panel de gestión (ADMIN+): worker de noticias oficiales y guías publicadas.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { relativeTime } from '../../data/seed';
import { useState } from 'react';
import { ApiError, useAuthStore } from '../../store/useAuthStore';
import { CatalogManager } from './StaffCatalog';
import { Block, errMsg, PRIMARY, QueryState, rankOf, ROW, SMALL_BTN, staffFetch, toast } from './StaffKit';
import { goTo } from './StaffNav';

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

interface PipelineRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'queued' | 'running' | 'ok' | 'error';
  trigger: 'push' | 'manual';
  source: string;
  modulo: string;
  archivo: string | null;
  dryRun: boolean;
  counts: { created: number; updated: number; unchanged: number; conflicts: number; rejected: number };
  rejected: Array<{ slug: string; reason: string }>;
}
interface PipelineRuns {
  runs: PipelineRun[];
  estado: {
    activo: boolean;
    ventanaHoras: number;
    ultimoLoteAt: string | null;
    enCurso: boolean;
    webhookConfigurado: boolean;
    ingestaConfigurada: boolean;
  };
}

const triggerMsg = (e: unknown): string => {
  if (e instanceof ApiError) {
    if (e.code === 'PIPELINE_BUSY') return 'Ya hay una sincronización en curso. Espera a que termine.';
    if (e.code === 'PIPELINE_WEBHOOK_UNSET') return 'La variable PIPELINE_WEBHOOK_URL no está configurada en el servidor.';
    if (e.code === 'PIPELINE_WEBHOOK_FAILED' || e.status === 502) return 'El servicio del pipeline no respondió (PIPELINE_WEBHOOK_FAILED). Inténtalo de nuevo más tarde.';
  }
  return errMsg(e);
};

function PipelineCard() {
  const qc = useQueryClient();
  const isSuper = rankOf(useAuthStore((s) => s.role)) >= 3;
  const [openRejected, setOpenRejected] = useState(false);
  const q = useQuery({
    queryKey: ['staff', 'pipeline-runs'],
    queryFn: () => staffFetch<PipelineRuns>('/api/admin/pipeline/runs?limit=20'),
    // Mientras hay un lote en curso se consulta cada 3 s.
    refetchInterval: (query) => (query.state.data?.estado.enCurso ? 3000 : false),
  });
  const trigger = useMutation({
    mutationFn: () => staffFetch<PipelineRun>('/api/admin/pipeline/trigger', { method: 'POST', json: {} }),
    onSuccess: () => toast.ok('Sincronización del pipeline encolada.'),
    onError: (e) => toast.err(`No se pudo sincronizar: ${triggerMsg(e)}`),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['staff', 'pipeline-runs'] }),
  });
  const est = q.data?.estado;
  const last = q.data?.runs[0];
  const blocked = !est || !est.webhookConfigurado || est.enCurso || trigger.isPending;
  const metrics: Array<[string, number]> = last
    ? [
        ['Creados', last.counts.created],
        ['Actualizados', last.counts.updated],
        ['Sin cambios', last.counts.unchanged],
        ['Conflictos', last.counts.conflicts],
      ]
    : [];
  return (
    <Block
      id="blk-pipeline"
      title="Pipeline de datos y catálogo (ETL)"
      controls="las fichas del catálogo (/catalogo), las guías y los marcadores del mapa, sincronizados desde fuentes estructuradas."
      href="/catalogo"
      linkLabel="Abrir catálogo"
    >
      <QueryState loading={q.isLoading} error={q.error} empty={false} emptyText="" onRetry={() => void q.refetch()} />
      {est && (
        <>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">Estado: </dt>
              <dd className={`inline font-bold ${est.activo ? 'text-vice-cyan' : 'text-vice-gold'}`}>
                {est.enCurso ? 'sincronizando ahora…' : est.activo ? 'activo' : 'en espera'}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Último lote: </dt>
              <dd className="inline">{fmt(est.ultimoLoteAt)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-vice-text/70">«En espera» significa que no ha llegado ningún lote en las últimas {est.ventanaHoras} h.</p>
          {!last ? (
            <p className="mt-3 text-sm text-vice-text/80">Aún no ha llegado ningún lote.</p>
          ) : (
            <div className="mt-3">
              <p className="text-sm">
                <span className="font-semibold">{last.source}</span> · {last.modulo}
                {last.archivo ? ` · ${last.archivo}` : ''} · {new Date(last.startedAt).toLocaleString('es')}
                {last.dryRun && <span className="ml-2 rounded-full bg-vice-gold px-2 py-0.5 text-xs font-bold text-vice-ink">simulación</span>}
                {last.status === 'error' && <span className="ml-2 text-xs font-bold text-vice-rose">terminó con error</span>}
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {metrics.map(([label, n]) => (
                  <li key={label} className="rounded-xl bg-white/5 px-3 py-2 text-sm">
                    <span className="block text-xs text-vice-text/70">{label}</span>
                    <span className="text-lg font-bold">{n}</span>
                  </li>
                ))}
                <li className="rounded-xl bg-white/5 text-sm">
                  <button
                    type="button"
                    aria-expanded={openRejected}
                    aria-controls="pipeline-rejected"
                    disabled={last.counts.rejected === 0}
                    onClick={() => setOpenRejected((v) => !v)}
                    className="flex min-h-11 w-full flex-col items-start rounded-xl px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-vice-gold disabled:cursor-default"
                  >
                    <span className="text-xs text-vice-text/70">Rechazados {last.counts.rejected > 0 ? (openRejected ? '▾' : '▸') : ''}</span>
                    <span className="text-lg font-bold">{last.counts.rejected}</span>
                  </button>
                </li>
              </ul>
              {openRejected && last.counts.rejected > 0 && (
                <ul id="pipeline-rejected" className="mt-2 max-h-60 overflow-y-auto rounded-xl bg-black/30 p-2 text-xs">
                  {last.rejected.map((r, i) => (
                    <li key={`${r.slug}-${i}`} className="py-1">
                      <span className="font-mono text-vice-gold">{r.slug}</span> — {r.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!est.ingestaConfigurada && (
            <p className="mt-3 text-xs text-vice-text/70">La ingesta por lotes no está configurada en el servidor; solo se muestran los datos existentes.</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" disabled={blocked} onClick={() => trigger.mutate()} className={PRIMARY}>
              {est.enCurso || trigger.isPending ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
            {isSuper && (
              <button type="button" onClick={() => goTo('control', 'auditoria', { label: 'system:pipeline', p: '1' })} className={SMALL_BTN}>
                Ver en Auditoría
              </button>
            )}
          </div>
          {!est.webhookConfigurado && (
            <p role="status" className="mt-2 text-sm text-vice-gold">
              La variable PIPELINE_WEBHOOK_URL no está configurada en el servidor: configúrala para sincronizar desde aquí.
            </p>
          )}
        </>
      )}
    </Block>
  );
}

export default function StaffEditorial() {
  return (
    <div className="flex flex-col gap-4">
      <NewsWorker />
      <PipelineCard />
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
