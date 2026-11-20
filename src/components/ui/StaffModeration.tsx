// Bloque «Aportes» de la sección Comunidad y moderación (MODERATOR+): bandeja de /aportar con moderación transparente.
// Cada aporte muestra su contenido completo antes de decidir; aprobar crea o actualiza la ficha o el pin (lo hace el
// servidor, con auditoría) y rechazar cierra el aporte con un motivo opcional. El servidor decide; esta UI es cosmética.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { entityHref, type EntityWithSlug } from '../../data/seed';
import { useAuthStore } from '../../store/useAuthStore';
import { useStaffStore } from '../../store/useStaffStore';
import type { MapMarker, Module } from '../../types/database';
import { FormModal } from './StaffForms';
import {
  Block,
  BTN,
  errLines,
  errMsg,
  Field,
  formGet,
  GHOST,
  INPUT,
  Pager,
  PRIMARY,
  PublicLink,
  QueryState,
  rankOf,
  SELECT,
  STATUS_LABEL,
  staffFetch,
  StatusBadge,
  SubTabs,
  TIPOS,
  toast,
  type SubmissionDTO,
  type SubStatus,
} from './StaffKit';
import { useBlockFilters } from './StaffNav';

const TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(TIPOS.map((t) => [t.value, t.label])),
  contact: 'Mensaje de contacto',
  newsletter: 'Suscripción al boletín',
};
const STATES: ReadonlyArray<{ id: SubStatus; label: string }> = (['pending', 'approved', 'rejected'] as const).map((id) => ({
  id,
  label: STATUS_LABEL[id],
}));
const FOOTER_TYPES = ['contact', 'newsletter'];
const PAGE_SIZE = 20;
const CONCURRENCY = 3;

const FIELD_LABEL: Record<string, string> = {
  titulo: 'Título',
  subtitulo: 'Subtítulo',
  categoria: 'Categoría',
  imagen_url: 'Imagen',
  stats_json: 'Estadísticas',
  metadata_json: 'Metadatos',
  region: 'Región',
  descripcion: 'Descripción',
  slug: 'Slug',
  coord_x: 'Coordenada X',
  coord_y: 'Coordenada Y',
  media_url: 'Medio asociado',
  entity_id: 'Ficha vinculada',
  email: 'Correo',
  message: 'Mensaje',
  name: 'Nombre',
  steps: 'Pasos',
  body: 'Texto',
  title: 'Título',
  marker: 'Pin vinculado',
};
const labelOf = (k: string): string => FIELD_LABEL[k] ?? k;

interface Envelope {
  items: SubmissionDTO[];
  total: number;
  page: number;
  pages: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Pool de promesas: ejecuta `worker` sobre todos los elementos con un máximo de `size` peticiones a la vez. */
async function pool<T>(items: readonly T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) await worker(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}

// ---- Presentación del contenido ---------------------------------------------------------------
/** Valor legible de cualquier JSON: texto, listas numeradas u objetos anidados. */
function Value({ v }: { v: unknown }) {
  if (isEmpty(v)) return <span className="text-vice-text/60">—</span>;
  if (typeof v === 'boolean') return <>{v ? 'Sí' : 'No'}</>;
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) return <>{v.map(String).join(', ')}</>;
    return (
      <ol className="ml-5 list-decimal space-y-1">
        {v.map((x, i) => (
          <li key={i}>
            <Value v={x} />
          </li>
        ))}
      </ol>
    );
  }
  if (isRecord(v)) {
    return (
      <dl className="space-y-0.5">
        {Object.entries(v).map(([k, x]) => (
          <div key={k} className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">{labelOf(k)}:</dt>
            <dd className="min-w-0 break-words">
              <Value v={x} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{String(v)}</span>;
}

function Rows({ rows }: { rows: ReadonlyArray<readonly [string, unknown]> }) {
  const shown = rows.filter(([, v]) => !isEmpty(v));
  if (shown.length === 0) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-vice-text/80">{k}</dt>
          <dd className="min-w-0 break-words">
            <Value v={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Pares del payload que no están en `known`: el detalle nunca omite datos del aporte. */
const rest = (payload: Record<string, unknown>, known: readonly string[]): Array<readonly [string, unknown]> =>
  Object.entries(payload)
    .filter(([k]) => !known.includes(k))
    .map(([k, v]) => [labelOf(k), v] as const);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white/5 p-3">
      <h4 className="mb-1 text-sm font-bold">{title}</h4>
      {children}
    </section>
  );
}

// ---- Corrección: tabla Actual vs Propuesto ----------------------------------------------------
function CorrectionDiff({ s }: { s: SubmissionDTO }) {
  const target = s.payload.target === 'MapMarker' ? 'MapMarker' : 'Entity';
  const id = typeof s.payload.id === 'string' ? s.payload.id : '';
  const patch = isRecord(s.payload.patch) ? s.payload.patch : {};
  const current = useQuery({
    queryKey: ['staff', 'correction-target', target, id],
    enabled: id !== '',
    queryFn: async (): Promise<Record<string, unknown> | null> => {
      if (target === 'Entity') {
        const r = await staffFetch<Array<Record<string, unknown>>>(`/api/entities?id=${encodeURIComponent(id)}&limit=1`);
        return r[0] ?? null;
      }
      const all = await staffFetch<MapMarker[]>('/api/markers');
      return (all.find((m) => m.id === id) as Record<string, unknown> | undefined) ?? null;
    },
  });
  const keys = Object.keys(patch);
  return (
    <div className="flex flex-col gap-2">
      <Rows
        rows={[
          ['Destino', target === 'Entity' ? 'Ficha del catálogo' : 'Pin del mapa'],
          ['Identificador', id],
        ]}
      />
      <QueryState loading={current.isLoading} error={current.error} empty={false} emptyText="" onRetry={() => void current.refetch()} />
      {current.isSuccess && current.data === null && <p className="text-vice-gold">El destino ya no existe: no se podrá aplicar la corrección.</p>}
      {keys.length === 0 ? (
        <p className="text-vice-gold">La corrección no propone ningún cambio.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <caption className="sr-only">Valores actuales frente a los propuestos</caption>
            <thead>
              <tr className="border-b border-white/15 text-vice-text/80">
                <th scope="col" className="py-1 pr-3">Campo</th>
                <th scope="col" className="py-1 pr-3">Actual</th>
                <th scope="col" className="py-1">Propuesto</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const now = current.data?.[k];
                const changes = current.data ? !sameValue(now, patch[k]) : true;
                return (
                  <tr key={k} className={`border-b border-white/10 align-top ${changes ? 'bg-vice-gold/10' : ''}`}>
                    <th scope="row" className="py-1 pr-3 font-semibold">{labelOf(k)}</th>
                    <td className="py-1 pr-3">{current.data ? <Value v={now} /> : '…'}</td>
                    <td className={`py-1 ${changes ? 'font-bold' : ''}`}>
                      <Value v={patch[k]} />
                      {current.data && !changes && <span className="ml-2 text-xs font-normal text-vice-text/70">(sin cambios)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Detail({ s }: { s: SubmissionDTO }) {
  const p = s.payload;
  const coords = s.coords ? `X ${s.coords.x} · Y ${s.coords.y}` : null;
  const mk = isRecord(p.marker) ? p.marker : null;
  switch (s.type) {
    case 'marker':
      return (
        <Rows
          rows={[
            ['Módulo', s.moduleSlug],
            ['Región', p.region],
            ['Título', p.titulo ?? s.title],
            ['Descripción', p.descripcion],
            ['Coordenadas', coords],
            ...rest(p, ['region', 'titulo', 'descripcion']),
          ]}
        />
      );
    case 'entity':
      return (
        <div className="flex flex-col gap-2">
          <Rows
            rows={[
              ['Módulo', s.moduleSlug],
              ['Título', p.titulo ?? s.title],
              ['Subtítulo', p.subtitulo],
              ['Categoría', p.categoria],
              ['Imagen', p.imagen_url],
              ['Slug', p.slug],
              ['Estadísticas', p.stats_json],
              ['Metadatos', p.metadata_json],
              ...rest(p, ['titulo', 'subtitulo', 'categoria', 'imagen_url', 'slug', 'stats_json', 'metadata_json', 'marker']),
            ]}
          />
          {mk && (
            <Section title="Pin vinculado (se crea al aprobar)">
              <Rows rows={[['Región', mk.region], ['Coordenada X', mk.coord_x], ['Coordenada Y', mk.coord_y], ['Descripción', mk.descripcion], ['Slug', mk.slug]]} />
            </Section>
          )}
        </div>
      );
    case 'correction':
      return <CorrectionDiff s={s} />;
    default:
      return <Rows rows={[['Tipo', TYPE_LABEL[s.type] ?? s.type], ['Título', s.title], ['Correo', p.email], ['Mensaje', p.message], ...rest(p, ['email', 'message'])]} />;
  }
}

// ---- Enlaces tras aprobar ---------------------------------------------------------------------
function EntityLinks({ sub, entityId }: { sub: SubmissionDTO; entityId: string }) {
  const hasPin = sub.type === 'entity' && isRecord(sub.payload.marker);
  const entity = useQuery({
    queryKey: ['staff', 'promoted-entity', entityId],
    queryFn: async () => (await staffFetch<EntityWithSlug[]>(`/api/entities?id=${encodeURIComponent(entityId)}&limit=1`))[0] ?? null,
  });
  const modules = useQuery({ queryKey: ['staff', 'modules-public'], staleTime: 60_000, queryFn: () => staffFetch<Module[]>('/api/modules') });
  const markers = useQuery({
    queryKey: ['staff', 'markers-public'],
    enabled: hasPin,
    queryFn: () => staffFetch<MapMarker[]>('/api/markers'),
  });
  const slug = modules.data?.find((m) => m.id === entity.data?.module_id)?.slug;
  const pin = markers.data?.find((m) => m.entity_id === entityId);
  return (
    <>
      {entity.data && slug && <PublicLink href={entityHref(entity.data, slug)}>Ver ficha</PublicLink>}
      {pin && <PublicLink href={`/mapa?marker=${pin.id}`}>Ver pin</PublicLink>}
    </>
  );
}

function PromotedLinks({ sub }: { sub: SubmissionDTO }) {
  const to = sub.promotedTo;
  if (sub.status !== 'approved' || !to) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {to.collection === 'MapMarker' ? <PublicLink href={`/mapa?marker=${to.id}`}>Ver pin</PublicLink> : <EntityLinks sub={sub} entityId={to.id} />}
    </span>
  );
}

// ---- Bandeja -----------------------------------------------------------------------------------
type Verdict = 'approved' | 'rejected';
interface RejectTarget {
  ids: string[];
  key: string;
}

export default function StaffModeration() {
  const qc = useQueryClient();
  const rank = rankOf(useAuthStore((a) => a.role));
  const { f, set, page, setPage } = useBlockFilters('aportes', { st: 'pending', ty: '', p: '1' });
  const st: SubStatus = STATES.some((x) => x.id === f.st) ? (f.st as SubStatus) : 'pending';
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errs, setErrs] = useState<Readonly<Record<string, string[]>>>({});
  const [published, setPublished] = useState<SubmissionDTO[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [reject, setReject] = useState<RejectTarget | null>(null);
  const [running, setRunning] = useState(false);

  const queue = useQuery({
    queryKey: ['staff', 'submissions', st, f.ty, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      staffFetch<Envelope>(`/api/admin/submissions?status=${st}${f.ty ? `&type=${encodeURIComponent(f.ty)}` : ''}&page=${page}&limit=${PAGE_SIZE}&envelope=1`),
  });
  const rows = queue.data?.items ?? [];
  const pendingRows = rows.filter((r) => r.status === 'pending');
  const typeOptions = Object.entries(TYPE_LABEL).filter(([k]) => rank >= 2 || !FOOTER_TYPES.includes(k));

  const toggleBusy = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Revisa un aporte: solo bloquea su fila; el error 422 queda junto al aporte. */
  const reviewOne = async (id: string, status: Verdict, note: string): Promise<SubmissionDTO | null> => {
    toggleBusy(id, true);
    setErrs((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
    try {
      return await staffFetch<SubmissionDTO>(`/api/admin/submissions/${id}`, {
        method: 'PATCH',
        json: status === 'rejected' && note ? { status, reviewNote: note } : { status },
      });
    } catch (e) {
      const lines = errLines(e);
      setErrs((prev) => ({ ...prev, [id]: lines.length > 0 ? lines : [errMsg(e)] }));
      return null;
    } finally {
      toggleBusy(id, false);
    }
  };

  const run = async (ids: readonly string[], status: Verdict, note = ''): Promise<void> => {
    setRunning(true);
    setSummary(null);
    const done: SubmissionDTO[] = [];
    const failed: string[] = [];
    await pool(ids, CONCURRENCY, async (id) => {
      const r = await reviewOne(id, status, note);
      if (r) done.push(r);
      else failed.push(id);
    });
    for (const key of ['staff', 'world', 'entity']) void qc.invalidateQueries({ queryKey: [key] });
    const okIds = new Set(done.map((d) => d.id));
    setSelected((prev) => new Set([...prev].filter((x) => !okIds.has(x))));
    if (status === 'approved') setPublished((prev) => [...done, ...prev].slice(0, 20));
    const verb = status === 'approved' ? 'aprobados' : 'rechazados';
    const text = `${done.length} ${verb}${failed.length > 0 ? ` · ${failed.length} con error (siguen seleccionados)` : ''}.`;
    if (ids.length > 1) setSummary(text);
    else if (done.length === 1) toast.ok(status === 'approved' ? 'Aporte aprobado y publicado.' : 'Aporte rechazado.');
    else toast.err('No se pudo actualizar el aporte; el detalle está junto a él.');
    setRunning(false);
  };

  const flip = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = pendingRows.length > 0 && pendingRows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pendingRows) {
        if (allOnPage) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  const changeFilter = (patch: { st?: string; ty?: string }) => {
    setSelected(new Set());
    setOpen(null);
    set({ ...patch, p: '1' });
  };

  const onReject = async (fd: FormData) => {
    if (!reject) return;
    const { ids, key } = reject;
    await run(ids, 'rejected', formGet(fd).s('nota'));
    useStaffStore.getState().clearDraft(key);
    setReject(null);
  };

  return (
    <Block
      id="blk-aportes"
      title="Bandeja de aportes"
      controls="las sugerencias enviadas desde Aportar. Al aprobar un aporte se publica la ficha o el pin en el catálogo y el mapa."
      href="/aportar"
      linkLabel="Abrir Aportar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SubTabs label="Estado" tabs={STATES} value={st} onChange={(id) => changeFilter({ st: id })} />
        <select aria-label="Tipo de aporte" value={f.ty} onChange={(e) => changeFilter({ ty: e.target.value })} className={`${SELECT} sm:w-64`}>
          <option value="">Todos los tipos</option>
          {typeOptions.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {summary && (
        <p role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold">
          {summary}
          <button type="button" onClick={() => setSummary(null)} className={`${GHOST} px-3 text-sm`}>
            Cerrar
          </button>
        </p>
      )}

      {published.length > 0 && (
        <section aria-label="Publicados en esta sesión" className="mt-3 rounded-xl bg-vice-cyan/10 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Publicados en esta sesión</h3>
            <button type="button" onClick={() => setPublished([])} className={`${GHOST} px-3 text-sm`}>
              Ocultar
            </button>
          </div>
          <ul className="mt-1 flex flex-col">
            {published.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3">
                <span className="font-semibold">{p.title}</span>
                <PromotedLinks sub={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingRows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={allOnPage} onChange={toggleAll} className="h-5 w-5 accent-[#E1307E]" />
            Seleccionar los de esta página
          </label>
          {selected.size > 0 && (
            <>
              <button type="button" disabled={running} onClick={() => void run([...selected], 'approved')} className={`${PRIMARY} px-5`}>
                Aprobar {selected.size}
              </button>
              <button type="button" disabled={running} onClick={() => setReject({ ids: [...selected], key: 'reject:bulk' })} className={GHOST}>
                Rechazar {selected.size}
              </button>
              <button type="button" disabled={running} onClick={() => setSelected(new Set())} className={GHOST}>
                Limpiar selección
              </button>
            </>
          )}
        </div>
      )}

      <QueryState
        loading={queue.isLoading}
        error={queue.error}
        empty={!queue.isLoading && !queue.error && rows.length === 0}
        emptyText="No hay aportes con este filtro."
        onRetry={() => void queue.refetch()}
      />
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((s) => {
          const isBusy = busy.has(s.id);
          const expanded = open === s.id;
          const problems = errs[s.id];
          return (
            <li key={s.id} aria-busy={isBusy} className="rounded-xl bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                  {s.status === 'pending' && (
                    <label className="flex min-h-11 min-w-11 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => flip(s.id)}
                        aria-label={`Seleccionar «${s.title}»`}
                        className="h-5 w-5 accent-[#E1307E]"
                      />
                    </label>
                  )}
                  <p className="min-w-0 font-semibold">
                    {s.title}{' '}
                    <span className="text-xs font-normal text-vice-text/70">
                      · {TYPE_LABEL[s.type] ?? s.type} · {s.moduleSlug}
                    </span>
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </div>
              {s.status === 'rejected' && s.reviewNote && (
                <p className="mt-1 rounded-lg bg-vice-rose/15 px-3 py-1 text-sm">
                  <strong>Motivo del rechazo:</strong> {s.reviewNote}
                </p>
              )}
              {problems && (
                <div role="alert" className="mt-2 rounded-lg bg-vice-rose/20 px-3 py-2 text-sm">
                  <p className="font-semibold">No se pudo aprobar o rechazar este aporte{problems.length > 1 ? ':' : '.'}</p>
                  <ul className="ml-5 list-disc">
                    {problems.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-3">
                <button
                  type="button"
                  data-staff-detail
                  aria-expanded={expanded}
                  aria-controls={`sub-${s.id}`}
                  onClick={() => setOpen(expanded ? null : s.id)}
                  className="min-h-11 text-sm font-semibold text-vice-gold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  {expanded ? 'Ocultar detalle' : 'Ver detalle completo'}
                </button>
                <PromotedLinks sub={s} />
              </div>
              {expanded && (
                <div id={`sub-${s.id}`} className="mt-1 text-sm">
                  <Detail s={s} />
                </div>
              )}
              {s.status === 'pending' && (
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={isBusy} onClick={() => void run([s.id], 'approved')} className={`${PRIMARY} px-5`}>
                    {isBusy ? 'Procesando…' : 'Aprobar'}
                  </button>
                  <button type="button" disabled={isBusy} onClick={() => setReject({ ids: [s.id], key: `reject:${s.id}` })} className={`${BTN} bg-white/10 hover:bg-white/20`}>
                    Rechazar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {queue.data && queue.data.total > 0 && <Pager page={queue.data.page} pages={queue.data.pages} total={queue.data.total} onPage={setPage} />}

      <FormModal
        open={reject !== null}
        title={reject && reject.ids.length > 1 ? `Rechazar ${reject.ids.length} aportes` : 'Rechazar aporte'}
        formId="reject-form"
        draftKey={reject?.key ?? 'reject:none'}
        pending={running}
        error={null}
        onClose={() => setReject(null)}
        onSubmit={(fd) => void onReject(fd)}
      >
        <div key={reject?.key ?? 'x'}>
          <Field id="r-nota" label="Motivo del rechazo (opcional)" hint="Se guarda con el aporte y lo verá el equipo de moderación. Máximo 500 caracteres.">
            <textarea id="r-nota" name="nota" rows={4} maxLength={500} defaultValue="" className={`${INPUT} py-2`} />
          </Field>
        </div>
      </FormModal>
    </Block>
  );
}
