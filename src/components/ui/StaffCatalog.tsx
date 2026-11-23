// Gestor del catálogo por categorías (ADMIN+). Los campos reflejan server/src/models/Entity.ts; la UI es cosmética
// (el servidor aplica RBAC y valida con Zod). Con `fixedModule` (guías en Editorial) el módulo no es filtrable.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { entityHref, entitySlug, type EntityWithSlug } from '../../data/seed';
import { FormModal, SafeDelete, useCrud } from './StaffForms';
import { ObjectHistory } from './StaffHistory';
import { CONTENT_INVALIDATE, SLUG_RE, useModules } from './StaffModules';
import { useMarkers } from './StaffMap';
import { useBlockFilters } from './StaffNav';
import { DANGER_BTN, Field, formGet, INPUT, Pager, PRIMARY, PublicLink, QueryState, ROW, SELECT, SMALL_BTN, staffFetch, toast } from './StaffKit';

const PER_PAGE = 20;
const FILTER_DEFAULTS = { q: '', m: '', p: '1', prov: '' };
const REPLACE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const REPLACE_MAX_BYTES = 12 * 1024 * 1024;

interface EntityPage {
  items: EntityWithSlug[];
  total: number;
  page: number;
  pages: number;
}

const parseJsonObject = (raw: string): Record<string, unknown> | null => {
  const t = raw.trim();
  if (t === '') return {};
  try {
    const v: unknown = JSON.parse(t);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Botón «Reemplazar imagen»: envía el original (JPG/PNG/WebP) y el servidor lo optimiza a WebP ≤ 400 KB. */
function ReplaceImageButton({ entity, onDone }: { entity: EntityWithSlug; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!REPLACE_TYPES.includes(file.type)) return toast.err('Usa una imagen JPG, PNG o WebP.');
    if (file.size > REPLACE_MAX_BYTES) return toast.err('La imagen pesa más de 12 MB.');
    setBusy(true);
    try {
      await staffFetch(`/api/admin/entities/${entity.id}/image`, { method: 'POST', body: file, headers: { 'content-type': file.type } });
      toast.ok(`Imagen de «${entity.titulo}» reemplazada.`);
      onDone();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : 'No se pudo reemplazar la imagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={REPLACE_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(ev) => void onFile(ev.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={SMALL_BTN}
        aria-label={`Reemplazar imagen de ${entity.titulo}`}
      >
        {busy ? 'Subiendo…' : 'Reemplazar imagen'}
      </button>
    </>
  );
}

export function CatalogManager({ fixedModule }: { fixedModule?: string }) {
  const modules = useModules();
  const markers = useMarkers();
  const { f, set, search, page, setPage } = useBlockFilters(fixedModule ?? 'catalogo', FILTER_DEFAULTS);
  const qc = useQueryClient();
  const crud = useCrud<EntityWithSlug>({
    draftType: 'entity',
    saveUrl: (id) => (id ? `/api/entities/${id}` : '/api/entities'),
    deleteUrl: (id) => `/api/entities/${id}`,
    invalidate: CONTENT_INVALIDATE,
    messages: { created: 'Ficha creada.', saved: 'Ficha guardada.', deleted: 'Ficha borrada.' },
  });

  const moduleFilter = fixedModule ?? f.m;
  const q = f.q;
  const provisional = f.prov === '1';
  const refreshContent = () => {
    for (const key of ['staff', ...CONTENT_INVALIDATE]) void qc.invalidateQueries({ queryKey: [key] });
  };
  const mods = modules.data ?? [];
  const slugOf = (id: string): string => mods.find((m) => m.id === id)?.slug ?? '';
  const nameOf = (id: string): string => mods.find((m) => m.id === id)?.nombre ?? '…';
  const withPin = new Set((markers.data ?? []).flatMap((mk) => (mk.entity_id ? [mk.entity_id] : [])));

  const list = useQuery({
    queryKey: ['staff', 'entities', moduleFilter, q, page, provisional],
    placeholderData: keepPreviousData,
    queryFn: () =>
      staffFetch<EntityPage>(
        `/api/entities?envelope=1&limit=${PER_PAGE}&page=${page}${moduleFilter ? `&module=${encodeURIComponent(moduleFilter)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${provisional ? '&provisional=1' : ''}`,
        { cache: 'no-cache' },
      ),
  });

  const onSubmit = (fd: FormData) => {
    if (!crud.editing) return;
    crud.setFormErr(null);
    const { s, n } = formGet(fd);
    if (!s('module_id')) return crud.setFormErr('Elige un módulo.');
    if (!SLUG_RE.test(s('slug'))) return crud.setFormErr('Slug inválido: minúsculas, números y guiones (a-b-c).');
    if (!s('titulo') || !s('categoria')) return crud.setFormErr('Título y categoría son obligatorios.');
    const stats = parseJsonObject(s('stats_json'));
    const meta = parseJsonObject(s('metadata_json'));
    if (!stats || !meta) return crud.setFormErr('Stats y metadatos deben ser un objeto JSON válido.');
    crud.save(crud.item?.id ?? null, {
      module_id: s('module_id'),
      slug: s('slug'),
      titulo: s('titulo'),
      subtitulo: n('subtitulo'),
      categoria: s('categoria'),
      imagen_url: n('imagen_url'),
      stats_json: stats,
      metadata_json: meta,
    });
  };

  const e = crud.item;
  const total = list.data?.total ?? 0;
  const fixedName = fixedModule ? mods.find((m) => m.slug === fixedModule)?.nombre : undefined;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {!fixedModule && (
          <select
            aria-label="Filtrar por módulo"
            value={f.m}
            onChange={(ev) => set({ m: ev.target.value, p: '1' })}
            className={`${SELECT} sm:w-56`}
          >
            <option value="">Todos los módulos</option>
            {mods.map((m) => (
              <option key={m.id} value={m.slug}>
                {m.slug === 'mapa' ? `${m.nombre} · fichas de lugares` : m.nombre}
              </option>
            ))}
          </select>
        )}
        <input type="search" aria-label="Buscar por nombre o slug" placeholder="Buscar por nombre o slug…" {...search} className={`${INPUT} min-w-0 flex-1`} />
        <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 text-sm">
          <input
            type="checkbox"
            checked={provisional}
            onChange={(ev) => set({ prov: ev.target.checked ? '1' : '', p: '1' })}
            className="h-4 w-4 accent-vice-cyan"
          />
          Imagen provisional
        </label>
        <button type="button" onClick={crud.openNew} className={PRIMARY}>
          Nueva ficha
        </button>
      </div>
      {fixedName && <p className="mt-2 text-xs text-vice-text/70">Solo fichas del módulo «{fixedName}».</p>}
      {moduleFilter === 'mapa' && (
        <p className="mt-2 text-xs text-vice-text/70">
          Estas fichas son el contenido editorial de cada lugar (texto, SEO). Su pin y sus coordenadas se sitúan en Mapa interactivo; aquí solo se edita la ficha.
        </p>
      )}

      <QueryState
        loading={list.isLoading}
        error={list.error}
        empty={!list.isLoading && !list.error && (list.data?.items.length ?? 0) === 0}
        emptyText="Sin fichas con ese filtro."
        onRetry={() => void list.refetch()}
      />
      <ul className="mt-3 flex flex-col gap-2">
        {(list.data?.items ?? []).map((it) => {
          const mSlug = slugOf(it.module_id);
          const slug = entitySlug(it);
          const hasPin = withPin.has(it.id);
          return (
            <li key={it.id} className={ROW}>
              <span className="min-w-0">
                <span className="font-semibold">{it.titulo}</span>
                <span className="ml-2 text-xs text-vice-text/70">
                  {nameOf(it.module_id)} · {it.categoria} · /{slug}
                </span>
                {it.capturaPropiaPendiente === true && (
                  <span className="ml-2 rounded-full border border-vice-gold/50 px-2 py-0.5 text-[11px] font-bold">Imagen provisional</span>
                )}
                {markers.data && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${hasPin ? 'bg-vice-cyan text-vice-ink' : 'bg-white/10'}`}>
                    Pin: {hasPin ? 'sí' : 'no'}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-2">
                {mSlug && <PublicLink href={entityHref(it, mSlug)}>Ver</PublicLink>}
                {markers.data && <PublicLink href={`/mapa?editor=1&entity=${encodeURIComponent(slug)}`}>{hasPin ? 'Ver pin' : 'Situar pin'}</PublicLink>}
                <ReplaceImageButton entity={it} onDone={refreshContent} />
                <button type="button" onClick={() => crud.openEdit(it)} className={SMALL_BTN} aria-label={`Editar ${it.titulo}`}>
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => crud.askDelete({ type: 'entity', id: it.id, label: it.titulo, confirmText: slug, confirmKind: 'slug' })}
                  className={DANGER_BTN}
                  aria-label={`Borrar ${it.titulo}`}
                >
                  Borrar
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {list.data && total > 0 && <Pager page={list.data.page} pages={list.data.pages} total={total} onPage={setPage} />}

      <FormModal
        open={crud.editing !== null}
        title={`${e ? 'Editar' : 'Nueva'} ficha`}
        formId="entity-form"
        draftKey={crud.draftKey}
        pending={crud.saving}
        error={crud.formErr}
        onClose={crud.closeForm}
        onSubmit={onSubmit}
      >
        <div key={e?.id ?? 'new'} className="flex flex-col gap-3">
          <Field id="e-mod" label="Módulo">
            <select id="e-mod" name="module_id" required defaultValue={e?.module_id ?? mods.find((m) => m.slug === fixedModule)?.id ?? ''} className={SELECT}>
              <option value="" disabled>
                Elige un módulo
              </option>
              {mods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </Field>
          <Field id="e-slug" label="Slug" hint="Minúsculas, números y guiones. Máx. 120.">
            <input id="e-slug" name="slug" required maxLength={120} defaultValue={e?.slug ?? ''} className={INPUT} />
          </Field>
          <Field id="e-titulo" label="Título">
            <input id="e-titulo" name="titulo" required maxLength={160} defaultValue={e?.titulo ?? ''} className={INPUT} />
          </Field>
          <Field id="e-sub" label="Subtítulo (opcional)">
            <input id="e-sub" name="subtitulo" maxLength={240} defaultValue={e?.subtitulo ?? ''} className={INPUT} />
          </Field>
          <Field id="e-cat" label="Categoría">
            <input id="e-cat" name="categoria" required maxLength={80} defaultValue={e?.categoria ?? ''} className={INPUT} />
          </Field>
          <Field id="e-img" label="URL de imagen (opcional)">
            <input id="e-img" name="imagen_url" defaultValue={e?.imagen_url ?? ''} className={INPUT} />
          </Field>
          <Field id="e-stats" label="Stats (JSON)">
            <textarea id="e-stats" name="stats_json" rows={3} defaultValue={JSON.stringify(e?.stats_json ?? {}, null, 2)} className={`${INPUT} py-2 font-mono text-sm`} />
          </Field>
          <Field id="e-meta" label="Metadatos (JSON; las guías usan metadata.steps)">
            <textarea id="e-meta" name="metadata_json" rows={3} defaultValue={JSON.stringify(e?.metadata_json ?? {}, null, 2)} className={`${INPUT} py-2 font-mono text-sm`} />
          </Field>
          {e && <ObjectHistory targetType="Entity" targetId={e.id} />}
        </div>
      </FormModal>

      <SafeDelete target={crud.deleting} pending={crud.removing} onCancel={crud.cancelDelete} onConfirm={crud.confirmDelete} />
    </div>
  );
}
