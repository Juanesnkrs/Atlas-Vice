// Bloque «Aportes» de la sección Comunidad y moderación (MODERATOR+): bandeja de /aportar con moderación transparente.
// Cada aporte muestra su contenido completo antes de decidir; aprobar crea o actualiza la ficha o el pin (lo hace el
// servidor, con auditoría) y rechazar cierra el aporte con un motivo opcional. El servidor decide; esta UI es cosmética.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { entityHref, mediaSrc, type EntityWithSlug } from '../../data/seed';
import { ApiError, API_URL, apiFetch, useAuthStore } from '../../store/useAuthStore';
import { useStaffStore } from '../../store/useStaffStore';
import type { MapMarker, Module } from '../../types/database';
import { CompareDialog } from './StaffCompare';
import { FormModal } from './StaffForms';
import {
  Block,
  DOCK_STICKY,
  BTN,
  errLines,
  errMsg,
  Field,
  formGet,
  GHOST,
  INPUT,
  isUniform404,
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

// ---- Aportes del pipeline: destino en la PWA, ficha, origen del dato -----------------------------
const REASON: Record<string, { label: string; tone: string; hint: string }> = {
  nueva: { label: 'Nueva', tone: 'bg-vice-cyan text-vice-ink', hint: 'Se creará la ficha al aprobar.' },
  actualizada: { label: 'Actualizada', tone: 'bg-vice-gold text-vice-ink', hint: 'Se actualizará la ficha existente al aprobar.' },
  conflicto: {
    label: 'Conflicto',
    tone: 'bg-vice-rose text-vice-ink',
    hint: 'Hay campos editados a mano que el lote quiere cambiar: revisa el cuadro «Actual vs. Propuesto».',
  },
};
const REASON_FILTERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '', label: 'Todos los cambios' },
  { id: 'nueva', label: 'Nuevas' },
  { id: 'actualizada', label: 'Actualizadas' },
  { id: 'conflicto', label: 'En conflicto' },
];
const ORIGINS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '', label: 'Todos' },
  { id: 'user', label: 'Usuarios' },
  { id: 'pipeline', label: 'Pipeline' },
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_MODULES = ['armas', 'vehiculos', 'coleccionables'];
const shortId = (id: string): string => id.slice(0, 8);

/** Etiquetas en español de las claves canónicas de `metadata_json` (Datos §2.4). */
const META_LABEL: Record<string, string> = {
  marca: 'Marca',
  plazas: 'Plazas',
  municion: 'Munición',
  ubicacion: 'Ubicación',
  clase: 'Clase',
  traccion: 'Tracción',
  marchas: 'Marchas',
  peso_kg: 'Peso (kg)',
  basado_en: 'Basado en',
  apariciones: 'Apariciones',
  carroceria: 'Carrocería',
  precio: 'Precio',
  velocidad_punta: 'Velocidad punta',
  aceleracion: 'Aceleración',
  adquisicion: 'Adquisición',
  slot: 'Ranura',
  dano: 'Daño',
  cadencia: 'Cadencia',
  alcance: 'Alcance',
  genero: 'Género',
  presentador: 'Presentador',
  num_pistas: 'Número de pistas',
  numero_mision: 'Número de misión',
  tipo_mision: 'Tipo de misión',
  capitulo: 'Capítulo',
  protagonistas: 'Protagonistas',
  requisito_100: 'Requisito para el 100 %',
  recompensa_dinero: 'Recompensa (dinero)',
  recompensa_logro: 'Recompensa (logro)',
  region: 'Región',
  stats_juego: 'Estadísticas de juego',
};
const ORIGIN_KEYS = ['fuente', 'fuente_url', 'confianza', 'evidencia', 'notas'];
const PAYLOAD_KNOWN = [
  'slug', 'titulo', 'subtitulo', 'categoria', 'imagen_url', 'stats_json', 'metadata_json', 'marker', 'tarjeta',
  'contentHash', 'capturaPropiaPendiente', 'pipeline_reason', 'pipeline_run_id', 'conflict_fields',
];
const humanize = (k: string): string => {
  const t = k.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Ruta pública exacta del destino (Rutas §1): solo armas/vehículos/coleccionables, guías y mapa tienen vista. */
function publicRoute(modulo: string, slug: string, pinSlug: string): { href: string; text: string } | null {
  if (modulo === 'guias' && slug) return { href: `/guias/${slug}`, text: `/guias/${slug}` };
  if (ENTITY_MODULES.includes(modulo) && slug) return { href: `/catalogo/${modulo}/${slug}`, text: `/catalogo/${modulo}/${slug}` };
  if (modulo === 'mapa' && (pinSlug || slug)) {
    const href = `/mapa?pin=${pinSlug || slug}`;
    return { href, text: href };
  }
  return null;
}

function ReasonChip({ reason }: { reason: string | null | undefined }) {
  const r = reason ? REASON[reason] : undefined;
  if (!r) return null;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.tone}`}>{r.label}</span>;
}

/** Ficha vigente (API pública por módulo/slug) de un aporte «actualizada» o «conflicto». `null` = no existe. */
function useCurrentEntity(s: SubmissionDTO) {
  const slug = typeof s.payload.slug === 'string' ? s.payload.slug : '';
  const modulo = s.moduleSlug;
  const wanted =
    (s.pipeline_reason === 'actualizada' || s.pipeline_reason === 'conflicto') && slug !== '' && (modulo === 'guias' || ENTITY_MODULES.includes(modulo));
  return useQuery({
    queryKey: ['staff', 'pipeline-current', modulo, slug],
    enabled: wanted,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, unknown> | null> => {
      try {
        // API pública (no staffFetch): un 404 de ficha inexistente no debe confundirse con el 404 uniforme de staff.
        return await apiFetch<Record<string, unknown>>(`/api/modules/${encodeURIComponent(modulo)}/entities/${encodeURIComponent(slug)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

function ConflictDiff({ s, current }: { s: SubmissionDTO; current: ReturnType<typeof useCurrentEntity> }) {
  const p = s.payload;
  const meta = isRecord(p.metadata_json) ? p.metadata_json : {};
  const cur = current.data ?? null;
  const curMeta = cur && isRecord(cur['metadata_json']) ? cur['metadata_json'] : {};
  const fields = s.conflict_fields ?? [];
  const proposed = (k: string): unknown => (k in p ? p[k] : meta[k]);
  const actual = (k: string): unknown => (cur ? (k in cur ? cur[k] : curMeta[k]) : undefined);
  const loaded = current.isSuccess && cur !== null;
  return (
    <Section title="Actual vs. Propuesto (campos en conflicto)">
      {current.isLoading && <p role="status">Cargando la ficha actual…</p>}
      {current.isError && (
        <p role="alert" className="text-vice-gold">
          No se pudo cargar la ficha actual ({errMsg(current.error)}). Se muestran solo los valores propuestos.
        </p>
      )}
      {current.isSuccess && cur === null && <p className="text-vice-gold">La ficha actual no existe en el catálogo; se muestran solo los valores propuestos.</p>}
      {!current.isFetching && !current.isSuccess && !current.isError && (
        <p className="text-vice-gold">Este módulo no tiene ficha consultable; se muestran solo los valores propuestos.</p>
      )}
      {fields.length === 0 ? (
        <p className="text-vice-gold">El servidor no indicó qué campos están en conflicto.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <caption className="sr-only">Valores actuales frente a los propuestos por el lote</caption>
            <thead>
              <tr className="border-b border-white/15 text-vice-text/80">
                <th scope="col" className="py-1 pr-3">Campo</th>
                <th scope="col" className="py-1 pr-3">Actual</th>
                <th scope="col" className="py-1">Propuesto</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((k) => {
                const changes = loaded ? !sameValue(actual(k), proposed(k)) : true;
                return (
                  <tr key={k} className={`border-b border-white/10 align-top ${changes ? 'bg-vice-gold/10' : ''}`}>
                    <th scope="row" className="py-1 pr-3 font-semibold">{META_LABEL[k] ?? labelOf(k)}</th>
                    <td className="py-1 pr-3">{loaded ? <Value v={actual(k)} /> : '—'}</td>
                    <td className={`py-1 ${changes ? 'font-bold' : ''}`}>
                      <Value v={proposed(k)} />
                      {loaded && !changes && <span className="ml-2 text-xs font-normal text-vice-text/70">(sin cambios)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function PipelineDetail({ s }: { s: SubmissionDTO }) {
  const p = s.payload;
  const meta = isRecord(p.metadata_json) ? p.metadata_json : {};
  const stats = isRecord(p.stats_json) ? p.stats_json : {};
  const mk = isRecord(p.marker) ? p.marker : null;
  const slug = typeof p.slug === 'string' ? p.slug : '';
  const reason = s.pipeline_reason ?? '';
  const pinSlug = mk && typeof mk.slug === 'string' ? mk.slug : '';
  const route = publicRoute(s.moduleSlug, slug, pinSlug);
  const current = useCurrentEntity(s);
  const [imgFailed, setImgFailed] = useState(false);
  const card = isRecord(p.tarjeta) ? p.tarjeta : null;
  const imageUrl = typeof p.imagen_url === 'string' && p.imagen_url !== '' ? p.imagen_url : null;
  const cardSrc = `${API_URL}/api/admin/submissions/${s.id}/tarjeta.webp`;
  const pending = p.capturaPropiaPendiente === true;
  const canViewCurrent = reason !== 'nueva' && route !== null && (s.moduleSlug === 'mapa' || (current.isSuccess && current.data !== null));

  const fichaRows = Object.entries(meta)
    .filter(([k]) => k in META_LABEL && !ORIGIN_KEYS.includes(k))
    .map(([k, v]) => [META_LABEL[k] ?? k, v] as const);
  const unknownMeta = Object.entries(meta)
    .filter(([k]) => !(k in META_LABEL) && k !== 'descripcion' && k !== 'steps' && !ORIGIN_KEYS.includes(k))
    .map(([k, v]) => [`metadata_json.${k}`, v] as const);
  const statRows = Object.entries(stats).map(([k, v]) => [humanize(k), v] as const);
  const steps = Array.isArray(meta.steps) ? meta.steps.filter(isRecord) : [];
  const description = typeof meta.descripcion === 'string' && meta.descripcion !== '' ? meta.descripcion : mk && typeof mk.descripcion === 'string' ? mk.descripcion : '';
  const evidencia = meta.evidencia;
  const originRows: Array<readonly [string, unknown]> = [
    ['Fuente', meta.fuente],
    ['Enlace de la fuente', meta.fuente_url],
    ['Confianza', meta.confianza],
    ['Notas editoriales', meta.notas],
  ];
  const extra = rest(p, PAYLOAD_KNOWN);
  const imgCls = 'aspect-video w-full max-w-xs rounded-lg border border-white/15 bg-black/30 object-cover';

  return (
    <div className="flex flex-col gap-2">
      <Section title="Destino en la PWA">
        <div className="flex flex-wrap items-center gap-2">
          <ReasonChip reason={reason} />
          {s.pipeline_run_id && (
            <span title={s.pipeline_run_id} className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold">
              Lote {shortId(s.pipeline_run_id)}
            </span>
          )}
          {pending && <span className="rounded-full bg-vice-gold px-2 py-0.5 text-xs font-bold text-vice-ink">Captura propia pendiente</span>}
        </div>
        {REASON[reason] && <p className="mt-1 text-vice-text/85">{REASON[reason]?.hint}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {route ? (
            <>
              <code className="break-all rounded bg-black/30 px-2 py-1 text-xs">{route.text}</code>
              {canViewCurrent && <PublicLink href={route.href}>Ver ficha actual</PublicLink>}
            </>
          ) : (
            <p className="font-semibold text-vice-gold">Sin vista pública todavía (el módulo «{s.moduleSlug}» no tiene ruta en la PWA).</p>
          )}
        </div>
        {current.isError && <p className="mt-1 text-xs text-vice-gold">No se pudo comprobar si la ficha ya existe.</p>}
        <div className="mt-2">
          {card && !imgFailed ? (
            <img
              src={cardSrc}
              alt={`Tarjeta provisional de «${s.title}»`}
              width={320}
              height={180}
              loading="lazy"
              crossOrigin={API_URL ? 'use-credentials' : undefined}
              onError={() => setImgFailed(true)}
              className={imgCls}
            />
          ) : imageUrl ? (
            <img src={mediaSrc(imageUrl)} alt={`Imagen de «${s.title}»`} width={320} height={180} loading="lazy" referrerPolicy="no-referrer" className={imgCls} />
          ) : (
            <p className="text-vice-gold">{card ? 'No se pudo cargar la tarjeta.' : 'Sin imagen: se verá el icono genérico.'}</p>
          )}
          {card && <p className="mt-1 text-xs text-vice-text/70">Tarjeta provisional WebP que se publicará con la ficha.</p>}
        </div>
        <div className="mt-2">
          <Rows rows={[['Módulo', s.moduleSlug], ['Título', p.titulo ?? s.title], ['Subtítulo', p.subtitulo], ['Categoría', p.categoria], ['Slug', slug]]} />
        </div>
      </Section>

      {reason === 'conflicto' && <ConflictDiff s={s} current={current} />}

      {description !== '' && (
        <Section title="Descripción">
          <p className="whitespace-pre-wrap break-words">{description}</p>
        </Section>
      )}

      {(fichaRows.length > 0 || statRows.length > 0) && (
        <Section title="Ficha técnica">
          <Rows rows={fichaRows} />
          {statRows.length > 0 && (
            <>
              <h5 className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide text-vice-text/70">Estadísticas del comparador</h5>
              <Rows rows={statRows} />
            </>
          )}
        </Section>
      )}

      {steps.length > 0 && (
        <Section title={`Pasos (${steps.length})`}>
          <ol className="ml-5 list-decimal space-y-2">
            {steps.map((st, i) => (
              <li key={typeof st.id === 'string' ? st.id : i}>
                <span className="font-semibold">{typeof st.title === 'string' ? st.title : `Paso ${i + 1}`}</span>
                {typeof st.body === 'string' && <p className="whitespace-pre-wrap break-words text-vice-text/90">{st.body}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {mk && (
        <Section title="Pin en el mapa (se crea al aprobar)">
          <Rows
            rows={[
              ['Región', mk.region],
              ['Coordenadas', `X ${String(mk.coord_x ?? '—')} · Y ${String(mk.coord_y ?? '—')}`],
              ['Descripción', mk.descripcion],
              ['Slug del pin', mk.slug],
            ]}
          />
        </Section>
      )}

      <Section title="Origen del dato">
        <Rows rows={originRows} />
        {!isEmpty(evidencia) && (
          <div className="mt-1">
            <h5 className="text-xs font-bold uppercase tracking-wide text-vice-text/70">Evidencia</h5>
            <Value v={evidencia} />
          </div>
        )}
        {originRows.every(([, v]) => isEmpty(v)) && isEmpty(evidencia) && <p className="text-vice-gold">El lote no trae fuente ni evidencia.</p>}
      </Section>

      <details className="rounded-lg bg-white/5 p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-vice-gold">Datos técnicos</summary>
        <div className="mt-1">
          <Rows
            rows={[
              ['Hash del contenido', p.contentHash],
              ['Identificador del lote', s.pipeline_run_id],
              ['Tipo de cambio', s.pipeline_reason],
              ['Campos en conflicto', s.conflict_fields],
              ['Tarjeta (bytes)', card?.bytes],
              ['Tarjeta (sha256)', card?.sha256],
              ...unknownMeta,
              ...extra,
            ]}
          />
        </div>
      </details>
    </div>
  );
}

function Detail({ s }: { s: SubmissionDTO }) {
  if (s.origin === 'pipeline' && (s.type === 'entity' || s.type === 'marker')) return <PipelineDetail s={s} />;
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
/** Filtro del endpoint de lote (solo aportes pendientes del pipeline). */
interface BulkFilter {
  origin: 'pipeline';
  status: 'pending';
  runId?: string;
  reason?: string;
}
interface BulkResponse {
  action: 'approve' | 'reject';
  requested: number;
  ok: number;
  failed: number;
  truncated: boolean;
  results: Array<{ id: string; ok: boolean; error?: string }>;
}
interface RejectTarget {
  ids: string[];
  key: string;
  filter?: BulkFilter;
  /** Aportes que alcanza (null si el filtro no permite saberlo antes). */
  count: number | null;
}
interface ApproveConfirm {
  ids: string[];
  filter?: BulkFilter;
  count: number | null;
  label: string;
  conflicts: number;
}
const BULK_IDS = 200;

const bulkErrMsg = (e: unknown): string => {
  if (e instanceof ApiError && e.status === 429) return 'Demasiadas operaciones en lote seguidas (máximo 10 por minuto). Espera un momento y repite.';
  if (isUniform404(e)) return 'Sin acceso o sesión caducada: vuelve a iniciar sesión.';
  return errMsg(e);
};

export default function StaffModeration() {
  const qc = useQueryClient();
  const rank = rankOf(useAuthStore((a) => a.role));
  const { f, set, page, setPage } = useBlockFilters('aportes', { st: 'pending', ty: '', p: '1', origin: '', runId: '', reason: '' });
  const st: SubStatus = STATES.some((x) => x.id === f.st) ? (f.st as SubStatus) : 'pending';
  // Un lote o un tipo de cambio solo existen en el pipeline: fuerzan ese origen aunque la URL diga otra cosa.
  const runId = UUID_RE.test(f.runId) ? f.runId : '';
  const reasonF = REASON[f.reason] ? f.reason : '';
  const origin: '' | 'user' | 'pipeline' = runId || reasonF ? 'pipeline' : f.origin === 'user' || f.origin === 'pipeline' ? f.origin : '';
  const bulkFilter: BulkFilter | null =
    origin === 'pipeline' && st === 'pending'
      ? { origin: 'pipeline', status: 'pending', ...(runId ? { runId } : {}), ...(reasonF ? { reason: reasonF } : {}) }
      : null;

  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** `true` = «todos los que coinciden con el filtro» (se envía `filter`, no ids). */
  const [selectAll, setSelectAll] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errs, setErrs] = useState<Readonly<Record<string, string[]>>>({});
  const [published, setPublished] = useState<SubmissionDTO[]>([]);
  const [bulk, setBulk] = useState<(BulkResponse & { titles: Readonly<Record<string, string>> }) | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ApproveConfirm | null>(null);
  const [reject, setReject] = useState<RejectTarget | null>(null);
  const [compare, setCompare] = useState<{ id: string; title: string } | null>(null);
  const [running, setRunning] = useState(false);
  const lock = useRef(false);
  const approveBtn = useRef<HTMLButtonElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const confirmWasOpen = useRef(false);
  /** Coordenadas escritas al aprobar un lugar que llegó sin ubicación (se envían con la aprobación). */
  const [pinXY, setPinXY] = useState<Readonly<Record<string, { x: string; y: string }>>>({});

  // Foco del diálogo de confirmación: entra en «Confirmar y aprobar» y vuelve a «Aprobar N» al cerrarlo.
  useEffect(() => {
    if (confirm) confirmBtn.current?.focus();
    else if (confirmWasOpen.current) approveBtn.current?.focus();
    confirmWasOpen.current = confirm !== null;
  }, [confirm]);

  const queue = useQuery({
    queryKey: ['staff', 'submissions', st, f.ty, origin, runId, reasonF, page],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const q = new URLSearchParams({ status: st, page: String(page), limit: String(PAGE_SIZE), envelope: '1' });
      if (f.ty) q.set('type', f.ty);
      if (origin) q.set('origin', origin);
      if (origin === 'pipeline' && runId) q.set('runId', runId);
      if (origin === 'pipeline' && reasonF) q.set('reason', reasonF);
      return staffFetch<Envelope>(`/api/admin/submissions?${q.toString()}`);
    },
  });
  const rows = queue.data?.items ?? [];
  const total = queue.data?.total ?? 0;
  const pendingRows = rows.filter((r) => r.status === 'pending');
  const typeOptions = Object.entries(TYPE_LABEL).filter(([k]) => rank >= 2 || !FOOTER_TYPES.includes(k));
  const filtered = origin !== '' || f.ty !== '' || st !== 'pending';
  const selCount = selectAll ? total : selected.size;

  const toggleBusy = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const coordsBody = (id: string): { coords?: { x: number; y: number } } => {
    const c = pinXY[id];
    if (!c || c.x.trim() === '' || c.y.trim() === '') return {};
    const x = Number(c.x);
    const y = Number(c.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { coords: { x, y } } : {};
  };

  /** Revisa un aporte: solo bloquea su fila; el error 422 queda junto al aporte. */
  const reviewOne = async (id: string, status: Verdict, note: string): Promise<SubmissionDTO | null> => {
    toggleBusy(id, true);
    setErrs((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
    try {
      return await staffFetch<SubmissionDTO>(`/api/admin/submissions/${id}`, {
        method: 'PATCH',
        json: status === 'rejected' ? (note ? { status, reviewNote: note } : { status }) : { status, ...coordsBody(id) },
      });
    } catch (e) {
      const lines = errLines(e);
      setErrs((prev) => ({ ...prev, [id]: lines.length > 0 ? lines : [errMsg(e)] }));
      return null;
    } finally {
      toggleBusy(id, false);
    }
  };

  /** Flujo individual (PATCH de un aporte). El lote real usa `runBulk`. */
  const run = async (id: string, status: Verdict, note = ''): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setRunning(true);
    const r = await reviewOne(id, status, note);
    for (const key of ['staff', 'world', 'entity']) void qc.invalidateQueries({ queryKey: [key] });
    if (r) {
      setSelected((prev) => new Set([...prev].filter((x) => x !== id)));
      if (status === 'approved') setPublished((prev) => [r, ...prev].slice(0, 20));
      toast.ok(status === 'approved' ? 'Aporte aprobado y publicado.' : 'Aporte rechazado.');
    } else toast.err('No se pudo actualizar el aporte; el detalle está junto a él.');
    setRunning(false);
    lock.current = false;
  };

  /** Lote real: UNA petición `POST /api/admin/submissions/bulk` (por ids en bloques de 200, o por `filter`). */
  const runBulk = async (action: 'approve' | 'reject', target: { ids: readonly string[]; filter?: BulkFilter }, note = ''): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setRunning(true);
    setBulk(null);
    setBulkErr(null);
    const extra = action === 'reject' && note ? { reviewNote: note } : {};
    const send = (body: Record<string, unknown>) => staffFetch<BulkResponse>('/api/admin/submissions/bulk', { method: 'POST', json: { action, ...body, ...extra } });
    const acc: BulkResponse = { action, requested: 0, ok: 0, failed: 0, truncated: false, results: [] };
    const merge = (r: BulkResponse) => {
      acc.requested += r.requested;
      acc.ok += r.ok;
      acc.failed += r.failed;
      acc.truncated = acc.truncated || r.truncated;
      acc.results.push(...r.results);
    };
    try {
      if (target.filter) merge(await send({ filter: target.filter }));
      else {
        for (let i = 0; i < target.ids.length; i += BULK_IDS) {
          const chunk = target.ids.slice(i, i + BULK_IDS);
          try {
            merge(await send({ ids: chunk }));
          } catch (e) {
            const msg = bulkErrMsg(e);
            const rest = target.ids.slice(i);
            acc.requested += rest.length;
            acc.failed += rest.length;
            acc.results.push(...rest.map((id) => ({ id, ok: false, error: msg })));
            setBulkErr(msg);
            break;
          }
        }
      }
    } catch (e) {
      setBulkErr(bulkErrMsg(e));
    }
    for (const key of ['staff', 'world', 'entity']) void qc.invalidateQueries({ queryKey: [key] });
    const okIds = new Set(acc.results.filter((r) => r.ok).map((r) => r.id));
    setSelected((prev) => new Set([...prev].filter((x) => !okIds.has(x))));
    if (acc.requested > 0 && acc.failed === 0) setSelectAll(false);
    if (acc.requested > 0) {
      setBulk({ ...acc, titles: Object.fromEntries(rows.map((r) => [r.id, r.title])) });
      toast[acc.failed === 0 ? 'ok' : 'err'](`${acc.ok} ${action === 'approve' ? 'aprobados' : 'rechazados'}${acc.failed > 0 ? ` · ${acc.failed} con error` : ''}.`);
    }
    setRunning(false);
    lock.current = false;
  };

  const flip = (id: string) => {
    if (selectAll) {
      // Pasar de «todos los del filtro» a una selección manual: se conservan los visibles menos el desmarcado.
      setSelectAll(false);
      setSelected(new Set(pendingRows.map((r) => r.id).filter((x) => x !== id)));
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allOnPage = pendingRows.length > 0 && (selectAll || pendingRows.every((r) => selected.has(r.id)));
  const toggleAll = () => {
    if (selectAll) {
      setSelectAll(false);
      setSelected(new Set());
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pendingRows) {
        if (allOnPage) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  };
  const clearSelection = () => {
    setSelected(new Set());
    setSelectAll(false);
    setConfirm(null);
  };
  const changeFilter = (patch: Partial<Record<'st' | 'ty' | 'origin' | 'runId' | 'reason', string>>) => {
    clearSelection();
    setOpen(null);
    setBulk(null);
    setBulkErr(null);
    set({ ...patch, p: '1' });
  };
  const setOrigin = (id: string) => changeFilter(id === 'pipeline' ? { origin: id } : { origin: id, runId: '', reason: '' });

  /** Pide confirmación para aprobar la selección actual (por filtro o por ids). */
  const askApprove = () => {
    if (selectAll && bulkFilter) {
      setConfirm({ ids: [], filter: bulkFilter, count: total, label: 'que coinciden con el filtro', conflicts: 0 });
      return;
    }
    const ids = [...selected];
    const conflicts = rows.filter((r) => selected.has(r.id) && r.pipeline_reason === 'conflicto').length;
    setConfirm({ ids, count: ids.length, label: 'seleccionados', conflicts });
  };
  const askApproveNewOfRun = () => {
    if (!bulkFilter || !runId) return;
    setConfirm({
      ids: [],
      filter: { origin: 'pipeline', status: 'pending', runId, reason: 'nueva' },
      count: null,
      label: `nuevos del lote ${shortId(runId)}`,
      conflicts: 0,
    });
  };
  const askReject = () => {
    if (selectAll && bulkFilter) setReject({ ids: [], filter: bulkFilter, key: 'reject:bulk', count: total });
    else setReject({ ids: [...selected], key: 'reject:bulk', count: selected.size });
  };
  const doApprove = () => {
    if (!confirm) return;
    const c = confirm;
    setConfirm(null);
    void runBulk('approve', { ids: c.ids, ...(c.filter ? { filter: c.filter } : {}) });
  };

  const onReject = async (fd: FormData) => {
    if (!reject) return;
    const { ids, key, filter } = reject;
    const note = formGet(fd).s('nota');
    if (filter || ids.length > 1) await runBulk('reject', { ids, ...(filter ? { filter } : {}) }, note);
    else if (ids[0]) await run(ids[0], 'rejected', note);
    useStaffStore.getState().clearDraft(key);
    setReject(null);
  };

  const showBar = pendingRows.length > 0 || (bulkFilter !== null && total > 0);
  const rejectCount = reject?.count ?? reject?.ids.length ?? 0;

  return (
    <Block
      id="blk-aportes"
      title="Bandeja de aportes"
      controls="las sugerencias enviadas desde Aportar y las fichas propuestas por el pipeline. Al aprobar un aporte se publica la ficha o el pin en el catálogo y el mapa."
      href="/aportar"
      linkLabel="Abrir Aportar"
    >
      <div className="flex flex-col gap-2">
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
        <div className="flex flex-wrap items-center gap-2">
          <SubTabs label="Origen" tabs={ORIGINS} value={origin} onChange={setOrigin} />
          {origin === 'pipeline' && (
            <select aria-label="Tipo de cambio del pipeline" value={reasonF} onChange={(e) => changeFilter({ reason: e.target.value })} className={`${SELECT} sm:w-56`}>
              {REASON_FILTERS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          {runId && (
            <span className="flex min-h-11 items-center gap-2 rounded-xl bg-white/10 pl-3 text-sm font-semibold" title={runId}>
              Lote {shortId(runId)}
              <button
                type="button"
                aria-label={`Quitar el filtro del lote ${shortId(runId)}`}
                onClick={() => changeFilter({ runId: '' })}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-vice-gold"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </span>
          )}
        </div>
      </div>

      {bulkErr && (
        <p role="alert" className="mt-3 rounded-xl bg-vice-rose/20 px-3 py-2 text-sm font-semibold">
          {bulkErr}
        </p>
      )}

      {bulk && (
        <section aria-label="Resultado del lote" className="mt-3 rounded-xl bg-white/10 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="font-bold">
              Lote de {bulk.action === 'approve' ? 'aprobación' : 'rechazo'}: {bulk.ok} de {bulk.requested} {bulk.action === 'approve' ? 'aprobados' : 'rechazados'}
              {bulk.failed > 0 ? ` · ${bulk.failed} con error` : ''}.
            </p>
            <button type="button" onClick={() => setBulk(null)} className={`${GHOST} px-3 text-sm`}>
              Cerrar
            </button>
          </div>
          {bulk.truncated && (
            <p className="mt-1 text-vice-gold">El filtro tenía más de 500 coincidencias: se procesaron las primeras 500. Repite la acción para el resto.</p>
          )}
          {bulk.failed > 0 && (
            <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5">
              {bulk.results
                .filter((r) => !r.ok)
                .slice(0, 100)
                .map((r) => (
                  <li key={r.id}>
                    <span className="font-semibold">{bulk.titles[r.id] ?? shortId(r.id)}</span>: {r.error ?? 'Error desconocido'}
                  </li>
                ))}
            </ul>
          )}
        </section>
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

      {showBar && (
        <div className={`${DOCK_STICKY} mt-3 flex flex-col gap-2 rounded-xl border border-white/15 bg-[rgba(20,14,36,0.96)] p-2 backdrop-blur-md`}>
          <div className="flex flex-wrap items-center gap-2">
            {pendingRows.length > 0 && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={allOnPage} onChange={toggleAll} className="h-5 w-5 accent-[#E1307E]" />
                Seleccionar todos los de esta página
              </label>
            )}
            {bulkFilter && total > pendingRows.length && !selectAll && (
              <button type="button" disabled={running} onClick={() => setSelectAll(true)} className={`${GHOST} px-3 text-sm`}>
                Seleccionar los {total} que coinciden con el filtro
              </button>
            )}
            {bulkFilter && runId && (
              <button type="button" disabled={running} onClick={askApproveNewOfRun} className={`${GHOST} px-3 text-sm`}>
                Aprobar todas las nuevas de este lote
              </button>
            )}
          </div>
          {selCount > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="text-sm font-semibold">
                {selectAll ? `${total} que coinciden con el filtro` : `${selCount} seleccionados`}
              </p>
              <button ref={approveBtn} type="button" disabled={running || confirm !== null} onClick={askApprove} className={`${PRIMARY} px-5`}>
                Aprobar {selCount}
              </button>
              <button type="button" disabled={running} onClick={askReject} className={GHOST}>
                Rechazar {selCount} (con motivo)
              </button>
              <button type="button" disabled={running} onClick={clearSelection} className={GHOST}>
                Limpiar selección
              </button>
            </div>
          )}
          {confirm && (
            <div
              role="alertdialog"
              aria-labelledby="bulk-confirm-t"
              aria-describedby="bulk-confirm-d"
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !running) {
                  e.stopPropagation();
                  setConfirm(null);
                }
              }}
              className="rounded-xl bg-vice-gold/15 p-3 text-sm">
              <p id="bulk-confirm-t" className="font-bold">
                {confirm.count !== null ? `Aprobar ${confirm.filter ? 'hasta ' : ''}${confirm.count} aportes ${confirm.label}` : `Aprobar todos los aportes ${confirm.label}`}
              </p>
              <p id="bulk-confirm-d" className="mt-1">
                Se publicarán las fichas y los pines en la PWA, con auditoría.{' '}
                {confirm.filter
                  ? confirm.filter.reason === 'conflicto'
                    ? 'Estás aprobando expresamente conflictos: se aplicarán sobre las ediciones manuales.'
                    : 'Los aportes en conflicto quedan excluidos salvo que filtres expresamente por «En conflicto». Máximo 500 por operación.'
                  : confirm.conflicts > 0
                    ? `Atención: la selección incluye ${confirm.conflicts} en conflicto (los marcaste expresamente).`
                    : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button ref={confirmBtn} type="button" disabled={running} onClick={doApprove} className={`${PRIMARY} px-5`}>
                  {running ? 'Procesando…' : 'Confirmar y aprobar'}
                </button>
                <button type="button" disabled={running} onClick={() => setConfirm(null)} className={GHOST}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <QueryState
        loading={queue.isLoading}
        error={queue.error}
        empty={!queue.isLoading && !queue.error && rows.length === 0}
        emptyText={
          filtered
            ? 'No hay aportes que coincidan con estos filtros. Prueba a cambiar el estado, el tipo, el origen o el lote.'
            : 'No hay aportes pendientes.'
        }
        onRetry={() => void queue.refetch()}
      />
      {!queue.isLoading && !queue.error && rows.length === 0 && (origin !== '' || runId !== '') && (
        <button type="button" onClick={() => changeFilter({ origin: '', runId: '', reason: '' })} className={`${GHOST} px-3 text-sm`}>
          Quitar los filtros de origen y lote
        </button>
      )}
      <ul className="mt-3 flex flex-col gap-2 pb-4">
        {rows.map((s) => {
          const isBusy = busy.has(s.id);
          const expanded = open === s.id;
          const problems = errs[s.id];
          return (
            <li key={s.id} aria-busy={isBusy} className="scroll-mb-[calc(var(--dock-reserve)+5rem)] scroll-mt-16 rounded-xl bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                  {s.status === 'pending' && (
                    <label className="flex min-h-11 min-w-11 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selectAll || selected.has(s.id)}
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
                <div className="flex flex-wrap items-center gap-1">
                  {s.origin === 'pipeline' && (
                    <>
                      <ReasonChip reason={s.pipeline_reason} />
                      {s.pipeline_run_id && (
                        <span title={s.pipeline_run_id} className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold">
                          Lote {shortId(s.pipeline_run_id)}
                        </span>
                      )}
                    </>
                  )}
                  <StatusBadge status={s.status} />
                </div>
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
                {s.origin === 'pipeline' && (s.type === 'entity' || s.type === 'marker') && s.moduleSlug !== 'mapa' && (
                  <button
                    type="button"
                    onClick={() => setCompare({ id: s.id, title: s.title })}
                    className={`flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                      s.pipeline_reason === 'conflicto' ? 'bg-vice-gold font-bold text-vice-ink' : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    Comparar
                  </button>
                )}
                <PromotedLinks sub={s} />
              </div>
              {s.status === 'pending' && s.type === 'marker' && s.coords === null && (
                <div className="mt-2 grid max-w-sm grid-cols-2 gap-2">
                  <p className="col-span-2 text-sm text-vice-text/85">Este lugar llegó sin ubicación. Indica dónde va el pin para aprobarlo.</p>
                  {(['x', 'y'] as const).map((axis) => (
                    <label key={axis} className="text-xs font-medium">
                      {axis === 'x' ? 'Coordenada X (0-1000)' : 'Coordenada Y (0-700)'}
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max={axis === 'x' ? 1000 : 700}
                        value={pinXY[s.id]?.[axis] ?? ''}
                        onChange={(e) => setPinXY((prev) => ({ ...prev, [s.id]: { x: prev[s.id]?.x ?? '', y: prev[s.id]?.y ?? '', [axis]: e.target.value } }))}
                        className={`${INPUT} mt-1`}
                      />
                    </label>
                  ))}
                </div>
              )}
              {expanded && (
                <div
                  id={`sub-${s.id}`}
                  role="region"
                  aria-label={`Detalle de «${s.title}»`}
                  tabIndex={0}
                  className="mt-1 max-h-[min(60dvh,34rem)] overflow-y-auto overscroll-contain rounded-lg pr-1 text-sm focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  <Detail s={s} />
                </div>
              )}
              {s.status === 'pending' && (
                <div
                  className={`mt-2 flex gap-2 ${expanded ? `${DOCK_STICKY} -mx-3 rounded-b-xl bg-[rgba(20,14,36,0.96)] px-3 py-2 backdrop-blur-md` : ''}`}
                >
                  <button type="button" disabled={isBusy || running} onClick={() => void run(s.id, 'approved')} className={`${PRIMARY} px-5`}>
                    {isBusy ? 'Procesando…' : 'Aprobar'}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || running}
                    onClick={() => setReject({ ids: [s.id], key: `reject:${s.id}`, count: 1 })}
                    className={`${BTN} bg-white/10 hover:bg-white/20`}
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {queue.data && queue.data.total > 0 && <Pager page={queue.data.page} pages={queue.data.pages} total={queue.data.total} onPage={setPage} />}

      {compare && (
        <CompareDialog
          id={compare.id}
          title={compare.title}
          onClose={() => setCompare(null)}
          onResolved={() => {
            for (const key of ['staff', 'world', 'entity']) void qc.invalidateQueries({ queryKey: [key] });
          }}
        />
      )}

      <FormModal
        open={reject !== null}
        title={rejectCount > 1 || reject?.filter ? 'Rechazar aportes' : 'Rechazar aporte'}
        formId="reject-form"
        draftKey={reject?.key ?? 'reject:none'}
        pending={running}
        error={null}
        onClose={() => setReject(null)}
        onSubmit={(fd) => void onReject(fd)}
      >
        <div key={reject?.key ?? 'x'} className="flex flex-col gap-3">
          {reject && (reject.filter || reject.ids.length > 1) && (
            <p className="text-sm font-semibold">
              Se rechazarán {reject.filter ? `${reject.count ?? 'todos'} aportes que coinciden con el filtro` : `${reject.ids.length} aportes seleccionados`}.
              {reject.filter && reject.filter.reason !== 'conflicto' ? ' Incluye los aportes en conflicto.' : ''}
            </p>
          )}
          <Field id="r-nota" label="Motivo del rechazo (opcional)" hint="Se guarda con el aporte y lo verá el equipo de moderación. Máximo 500 caracteres.">
            <textarea id="r-nota" name="nota" rows={4} maxLength={500} defaultValue="" className={`${INPUT} py-2`} />
          </Field>
        </div>
      </FormModal>
    </Block>
  );
}
