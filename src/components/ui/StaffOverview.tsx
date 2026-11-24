// «Resumen operativo»: pantalla de entrada del panel de gestión. Una sola consulta (`GET /api/admin/overview`) con
// contenido filtrado por rol en el servidor; cada tarjeta enlaza a la sección donde se actúa. Solo cifras reales.
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { relativeTime } from '../../data/seed';
import { Block, QueryState, ROW, SMALL_BTN, staffFetch } from './StaffKit';
import { goTo } from './StaffNav';
import StaffSiteMap from './StaffSiteMap';

interface Overview {
  role: string;
  pending: { total: number; oldestAt: string | null; byType: Array<{ type: string; count: number; oldestAt: string }> };
  audit: Array<{ id: string; action: string; target_type: string; target_id: string | null; actor_name: string | null; created_at: string }>;
  worker?: {
    enabled: boolean;
    running: boolean;
    lastFinishedAt: string | null;
    nextRunAt: string | null;
    sources: number;
    lastErrors: Array<{ source: string; error: string }>;
    ranSinceBoot: boolean;
  };
  catalog?: Array<{ module_id: string; slug: string; nombre: string; activo: boolean; entities: number }>;
  pins?: { total: number; withoutEntity: number; mapEntitiesWithoutPin: number };
}

const TYPE_LABEL: Record<string, string> = {
  marker: 'Marcadores',
  entity: 'Fichas',
  correction: 'Correcciones',
  contact: 'Contacto',
  newsletter: 'Boletín',
};

const when = (iso: string): string => `${new Date(iso).toLocaleString('es')} (${relativeTime(iso)})`;
const s = (n: number): string => (n === 1 ? '' : 's');

function Card({ title, children, action }: { title: string; children: ReactNode; action?: { label: string; go: () => void } }) {
  return (
    <section aria-label={title} className="glass flex flex-col gap-2 rounded-2xl p-5">
      <h3 className="font-display text-lg font-bold">{title}</h3>
      <div className="flex flex-1 flex-col gap-2 text-sm">{children}</div>
      {action && (
        <div>
          <button type="button" onClick={action.go} className={SMALL_BTN}>
            {action.label}
          </button>
        </div>
      )}
    </section>
  );
}

/** `canContent` (ADMIN+) añade el «Mapa de la PWA»: su endpoint es ADMIN+, por eso no se monta para moderación. */
export default function StaffOverview({ canAudit, canContent }: { canAudit: boolean; canContent: boolean }) {
  const q = useQuery({
    queryKey: ['staff', 'overview'],
    queryFn: () => staffFetch<Overview>('/api/admin/overview'),
    refetchInterval: 60_000,
  });
  const o = q.data;
  return (
    <div className="flex flex-col gap-4">
      <QueryState loading={q.isLoading} error={q.error} empty={false} emptyText="" onRetry={() => void q.refetch()} />
      {o && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Aportes pendientes" action={{ label: 'Abrir la bandeja', go: () => goTo('comunidad', 'aportes', { st: 'pending' }) }}>
            {o.pending.total === 0 ? (
              <p>No hay aportes pendientes.</p>
            ) : (
              <>
                <p>
                  <strong className="text-xl">{o.pending.total}</strong> pendiente{s(o.pending.total)}
                  {o.pending.oldestAt && <> · el más antiguo, {relativeTime(o.pending.oldestAt)}</>}
                </p>
                <ul className="flex flex-col gap-1">
                  {o.pending.byType.map((t) => (
                    <li key={t.type} className={ROW}>
                      <span>
                        {TYPE_LABEL[t.type] ?? t.type}: <strong>{t.count}</strong>
                      </span>
                      <span className="text-xs text-vice-text/70">el más antiguo, {relativeTime(t.oldestAt)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          {o.worker && (
            <Card title="Worker de noticias" action={{ label: 'Ver el worker', go: () => goTo('editorial') }}>
              <p>
                {o.worker.running ? 'Ejecutándose ahora.' : o.worker.enabled ? 'Programado.' : 'Desactivado.'} {o.worker.sources} fuente
                {s(o.worker.sources)} oficial{o.worker.sources === 1 ? '' : 'es'}.
              </p>
              <p>
                Último ciclo: {o.worker.lastFinishedAt ? when(o.worker.lastFinishedAt) : 'aún no se ejecutó desde el último arranque del servidor'}.
                {o.worker.nextRunAt && <> Próximo: {when(o.worker.nextRunAt)}.</>}
              </p>
              {o.worker.lastErrors.length > 0 ? (
                <ul className="flex flex-col gap-1" aria-label="Últimos errores">
                  {o.worker.lastErrors.map((e) => (
                    <li key={e.source} role="alert" className="rounded-lg bg-vice-rose/20 px-3 py-2">
                      <strong>{e.source}:</strong> {e.error}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-vice-text/80">Sin errores registrados{o.worker.ranSinceBoot ? ' en el último ciclo' : ''}.</p>
              )}
            </Card>
          )}

          {o.catalog && (
            <Card title="Cobertura del catálogo" action={{ label: 'Abrir el catálogo', go: () => goTo('contenido', 'catalogo') }}>
              <ul className="flex flex-col gap-1">
                {o.catalog.map((m) => (
                  <li key={m.module_id} className={ROW}>
                    <button type="button" onClick={() => goTo('contenido', 'catalogo', { m: m.slug })} className="min-h-11 text-left font-semibold underline-offset-2 hover:underline">
                      {m.nombre}
                    </button>
                    <span>
                      <strong>{m.entities}</strong> ficha{s(m.entities)}
                      {!m.activo && <span className="ml-2 text-xs text-vice-gold">inactivo</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {o.pins && (
            <Card title="Mapa: pines y fichas" action={{ label: 'Abrir el mapa', go: () => goTo('contenido', 'mapa') }}>
              <p>
                <strong>{o.pins.total}</strong> pin{o.pins.total === 1 ? '' : 'es'} publicado{s(o.pins.total)}.
              </p>
              <p className={o.pins.withoutEntity > 0 ? 'font-semibold text-vice-gold' : ''}>
                {o.pins.withoutEntity} pin{o.pins.withoutEntity === 1 ? '' : 'es'} sin ficha vinculada.
              </p>
              <p className={o.pins.mapEntitiesWithoutPin > 0 ? 'font-semibold text-vice-gold' : ''}>
                {o.pins.mapEntitiesWithoutPin} ficha{s(o.pins.mapEntitiesWithoutPin)} del módulo mapa sin pin.
              </p>
            </Card>
          )}

          <div className="md:col-span-2">
            <Block id="blk-resumen-auditoria" title="Últimas acciones" controls={canAudit ? 'las 10 acciones más recientes de todo el equipo.' : 'tus 10 acciones más recientes.'}>
              {o.audit.length === 0 ? (
                <p className="text-sm text-vice-text/70">Todavía no hay acciones registradas.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {o.audit.map((a) => (
                    <li key={a.id} className={ROW}>
                      <span className="min-w-0 text-sm">
                        <strong className="font-mono">{a.action}</strong> · {a.target_type}
                        {a.target_id ? ` ${a.target_id.slice(0, 8)}` : ''}
                      </span>
                      <span className="text-xs text-vice-text/70">
                        {a.actor_name ?? 'desconocido'} · {when(a.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canAudit && (
                <div className="mt-3">
                  <button type="button" onClick={() => goTo('control', 'auditoria')} className={SMALL_BTN}>
                    Abrir la auditoría
                  </button>
                </div>
              )}
            </Block>
          </div>
        </div>
      )}
      {canContent && <StaffSiteMap />}
    </div>
  );
}
