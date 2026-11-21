// Gestor de marcadores del mapa interactivo (ADMIN+). Los campos reflejan server/src/models/MapMarker.ts; la UI es
// cosmética (el servidor aplica RBAC y valida con Zod).
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../store/useAuthStore';
import type { MapMarker } from '../../types/database';
import { EntityPicker, type PickedEntity } from './EntityPicker';
import { FormModal, SafeDelete, useCrud } from './StaffForms';
import { ObjectHistory } from './StaffHistory';
import { CONTENT_INVALIDATE } from './StaffModules';
import { goTo } from './StaffNav';
import { DANGER_BTN, Field, formGet, INPUT, PRIMARY, PublicLink, QueryState, ROW, SMALL_BTN, staffFetch } from './StaffKit';

/** Marcadores publicados; también los usa el catálogo para saber qué fichas ya tienen pin. */
export function useMarkers() {
  return useQuery({ queryKey: ['staff', 'markers'], queryFn: () => staffFetch<MapMarker[]>('/api/markers', { cache: 'no-cache' }) });
}

/** Lleva al catálogo filtrado por la ficha vinculada (misma consulta que EntityPicker: queryKey compartida). */
function OpenEntityButton({ entityId }: { entityId: string }) {
  const ficha = useQuery({
    queryKey: ['entity-pick', entityId],
    staleTime: 60_000,
    queryFn: async () => (await apiFetch<PickedEntity[]>(`/api/entities?id=${encodeURIComponent(entityId)}&limit=1`))[0] ?? null,
  });
  return (
    <button
      type="button"
      disabled={!ficha.data}
      onClick={() => ficha.data && goTo('contenido', 'catalogo', { q: ficha.data.slug, m: '', p: '1' })}
      className={SMALL_BTN}
    >
      Abrir ficha
    </button>
  );
}

export function MapManager() {
  const markers = useMarkers();
  const crud = useCrud<MapMarker>({
    draftType: 'marker',
    saveUrl: (id) => (id ? `/api/markers/${id}` : '/api/markers'),
    deleteUrl: (id) => `/api/markers/${id}`,
    invalidate: CONTENT_INVALIDATE,
    messages: { created: 'Marcador creado.', saved: 'Marcador guardado.', deleted: 'Marcador borrado.' },
  });

  const onSubmit = (fd: FormData) => {
    if (!crud.editing) return;
    crud.setFormErr(null);
    const { s, n } = formGet(fd);
    const x = Number(s('coord_x'));
    const y = Number(s('coord_y'));
    if (!s('region') || !s('titulo')) return crud.setFormErr('Región y título son obligatorios.');
    if (s('coord_x') === '' || s('coord_y') === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return crud.setFormErr('Indica coordenadas numéricas válidas.');
    }
    if (x < 0 || x > 1000 || y < 0 || y > 700) return crud.setFormErr('Coordenadas fuera del lienzo: X de 0 a 1000, Y de 0 a 700.');
    crud.save(crud.item?.id ?? null, {
      entity_id: n('entity_id'),
      region: s('region'),
      titulo: s('titulo'),
      descripcion: n('descripcion'),
      coord_x: x,
      coord_y: y,
      media_url: n('media_url'),
    });
  };

  const m = crud.item;
  const rows = markers.data ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={crud.openNew} className={PRIMARY}>
          Nuevo marcador
        </button>
        <PublicLink href="/mapa?editor=1">Abrir el Modo Editor del mapa</PublicLink>
        <span className="text-sm text-vice-text/70">{rows.length} marcadores publicados</span>
      </div>
      <p className="mt-2 text-xs text-vice-text/70">
        Cada marcador es solo el pin (coordenadas y región). El texto del lugar vive en su ficha del catálogo: usa «Abrir ficha» para editarlo.
      </p>
      <QueryState
        loading={markers.isLoading}
        error={markers.error}
        empty={!markers.isLoading && !markers.error && rows.length === 0}
        emptyText="No hay marcadores."
        onRetry={() => void markers.refetch()}
      />
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((it) => (
          <li key={it.id} className={ROW}>
            <span className="min-w-0">
              <span className="font-semibold">{it.titulo}</span>
              <span className="ml-2 rounded-full bg-vice-cyan px-2 py-0.5 text-[11px] font-bold text-vice-ink">Publicado</span>
              <span className="block text-xs text-vice-text/70">
                {it.region} · X {it.coord_x} · Y {it.coord_y}
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              <PublicLink href={`/mapa?marker=${it.id}`}>Ver</PublicLink>
              {it.entity_id && <OpenEntityButton entityId={it.entity_id} />}
              <button type="button" onClick={() => crud.openEdit(it)} className={SMALL_BTN} aria-label={`Editar ${it.titulo}`}>
                Editar
              </button>
              <button
                type="button"
                onClick={() =>
                  crud.askDelete(
                    it.slug
                      ? { type: 'marker', id: it.id, label: it.titulo, confirmText: it.slug, confirmKind: 'slug' }
                      : { type: 'marker', id: it.id, label: it.titulo, confirmText: it.id.slice(0, 8), confirmKind: 'id' },
                  )
                }
                className={DANGER_BTN}
                aria-label={`Borrar ${it.titulo}`}
              >
                Borrar
              </button>
            </span>
          </li>
        ))}
      </ul>

      <FormModal
        open={crud.editing !== null}
        title={`${m ? 'Editar' : 'Nuevo'} marcador`}
        formId="marker-form"
        draftKey={crud.draftKey}
        pending={crud.saving}
        error={crud.formErr}
        onClose={crud.closeForm}
        onSubmit={onSubmit}
      >
        <div key={m?.id ?? 'new'} className="flex flex-col gap-3">
          <Field id="k-region" label="Región">
            <input id="k-region" name="region" required maxLength={80} defaultValue={m?.region ?? ''} className={INPUT} />
          </Field>
          <Field id="k-titulo" label="Título">
            <input id="k-titulo" name="titulo" required maxLength={160} defaultValue={m?.titulo ?? ''} className={INPUT} />
          </Field>
          <Field id="k-desc" label="Descripción (opcional)">
            <textarea id="k-desc" name="descripcion" rows={3} maxLength={2000} defaultValue={m?.descripcion ?? ''} className={`${INPUT} py-2`} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="k-x" label="Coordenada X" hint="Lienzo: 0 a 1000">
              <input id="k-x" name="coord_x" type="number" step="any" required defaultValue={m?.coord_x ?? ''} className={INPUT} />
            </Field>
            <Field id="k-y" label="Coordenada Y" hint="Lienzo: 0 a 700">
              <input id="k-y" name="coord_y" type="number" step="any" required defaultValue={m?.coord_y ?? ''} className={INPUT} />
            </Field>
          </div>
          <EntityPicker id="k-ent" name="entity_id" defaultValue={m?.entity_id ?? null} label="Entidad vinculada (opcional)" />
          <Field id="k-media" label="URL de medio (opcional)">
            <input id="k-media" name="media_url" defaultValue={m?.media_url ?? ''} className={INPUT} />
          </Field>
          {m && <ObjectHistory targetType="MapMarker" targetId={m.id} />}
        </div>
      </FormModal>

      <SafeDelete target={crud.deleting} pending={crud.removing} onCancel={crud.cancelDelete} onConfirm={crud.confirmDelete} />
    </div>
  );
}
