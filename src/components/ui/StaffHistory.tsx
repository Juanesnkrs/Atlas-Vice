// Historial legible de cambios del panel de gestión (chunk `staff-panel`, MODERATOR+): DiffView muestra los metadatos
// de una entrada de auditoría (antes/después, parches antiguos o claves sueltas) y ObjectHistory lista los cambios de
// un objeto concreto. El nivel máximo ve todo; el resto solo sus propias entradas (lo decide el servidor).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BTN, QueryState, staffFetch } from './StaffKit';

const FOLD_AT = 120;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Texto de un valor: escalares tal cual; objetos y listas como JSON compacto; vacío como «—». */
const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  return typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
};

/** Valor con plegado: los textos largos se recortan con un control para verlos completos. */
function Val({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = show(value);
  if (text.length <= FOLD_AT) return <span className="break-words">{text}</span>;
  return (
    <span className="break-words">
      {open ? text : `${text.slice(0, FOLD_AT)}…`}{' '}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="font-semibold text-vice-gold underline underline-offset-2">
        {open ? 'Ver menos' : 'Ver más'}
      </button>
    </span>
  );
}

function PairList({ entries, arrow }: { entries: Array<[string, unknown]>; arrow: boolean }) {
  return (
    <dl className="flex flex-col gap-1 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">{k}{arrow ? ' →' : ':'}</dt>
          <dd className="min-w-0">
            <Val value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Diff legible de los metadatos de una entrada de auditoría (convención before/after, parche antiguo o claves sueltas). */
export function DiffView({ metadata }: { metadata: Record<string, unknown> }) {
  const { before, after, patch, ...rest } = metadata;
  const diff = isRecord(before) && isRecord(after) ? { before, after } : null;
  const old = isRecord(patch) ? patch : null;
  // Si before/after/patch no tienen la forma esperada, se muestran como una clave más.
  const extra = Object.entries(rest);
  if (!diff && before !== undefined) extra.push(['before', before]);
  if (!diff && after !== undefined) extra.push(['after', after]);
  if (!old && patch !== undefined) extra.push(['patch', patch]);

  if (!diff && !old && extra.length === 0) return <p className="text-xs text-vice-text/70">Sin detalle.</p>;
  const fields = diff ? [...new Set([...Object.keys(diff.before), ...Object.keys(diff.after)])] : [];
  return (
    <div className="flex flex-col gap-2">
      {diff && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-vice-text/70">
                <th scope="col" className="py-1 pr-3 font-semibold">Campo</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Antes</th>
                <th scope="col" className="py-1 font-semibold">Después</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((k) => (
                <tr key={k} className="border-t border-white/10 align-top">
                  <th scope="row" className="py-1 pr-3 font-semibold">{k}</th>
                  <td className="max-w-[16rem] py-1 pr-3"><Val value={diff.before[k]} /></td>
                  <td className="max-w-[16rem] py-1"><Val value={diff.after[k]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {old && <PairList entries={Object.entries(old)} arrow />}
      {extra.length > 0 && <PairList entries={extra} arrow={false} />}
    </div>
  );
}

interface HistoryLog {
  id: string;
  action: string;
  actor_id: string;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
interface HistoryPage {
  scope: 'all' | 'own';
  logs: HistoryLog[];
}

/** Sección colapsable «Historial de este objeto»: carga la lista solo al desplegarla. */
export function ObjectHistory({ targetType, targetId }: { targetType: string; targetId: string }) {
  const [open, setOpen] = useState(false);
  const q = new URLSearchParams({ target_type: targetType, target_id: targetId, limit: '20' });
  const history = useQuery({
    queryKey: ['staff', 'history', targetType, targetId],
    enabled: open,
    queryFn: () => staffFetch<HistoryPage>(`/api/admin/history?${q.toString()}`),
  });
  const logs = history.data?.logs ?? [];
  return (
    <section aria-label="Historial de este objeto" className="rounded-xl bg-white/5 p-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${BTN} w-full justify-between bg-white/5 hover:bg-white/10`}>
        <span>Historial de este objeto</span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2">
          {history.data?.scope === 'own' && <p className="text-xs text-vice-text/70">Solo se muestran tus propios cambios.</p>}
          <QueryState
            loading={history.isLoading}
            error={history.error}
            empty={history.isSuccess && logs.length === 0}
            emptyText="Sin cambios registrados."
            onRetry={() => void history.refetch()}
          />
          <ul className="mt-2 flex flex-col gap-2">
            {logs.map((l) => (
              <li key={l.id} className="rounded-xl bg-white/5 px-3 py-2 text-sm">
                <p className="font-semibold">{l.action}</p>
                <p className="text-xs text-vice-text/70">
                  {l.actor_name ?? l.actor_id.slice(0, 8)} · {new Date(l.created_at).toLocaleString('es')}
                </p>
                {Object.keys(l.metadata).length > 0 && (
                  <div className="mt-1">
                    <DiffView metadata={l.metadata} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
