// Gestor de módulos del catálogo (ADMIN+): visibilidad, orden, nombre, icono y URL. Los campos reflejan
// server/src/models/Module.ts; la UI es cosmética (el servidor aplica RBAC y valida con Zod).
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../store/useAuthStore';
import { Field, errMsg, formGet, INPUT, PRIMARY, QueryState, ROW, SMALL_BTN, DANGER_BTN, staffFetch, toast } from './StaffKit';
import { FormModal, SafeDelete, useCrud } from './StaffForms';
import { ObjectHistory } from './StaffHistory';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Raíces de queryKey (además de `staff`) que dependen del contenido público y se refrescan tras cada cambio. */
export const CONTENT_INVALIDATE: readonly string[] = ['world', 'entity', 'config'];

export interface ModuleRow {
  id: string;
  slug: string;
  nombre: string;
  icono: string;
  orden: number;
  activo: boolean;
}

export function useModules() {
  return useQuery({ queryKey: ['staff', 'modules'], queryFn: () => staffFetch<ModuleRow[]>('/api/modules?all=1') });
}

/** Fila de GET /api/admin/modules/overview (ADMIN+): módulo + ruta pública + conteos reales. */
export interface ModuleOverview {
  id: string;
  slug: string;
  nombre: string;
  activo: boolean;
  orden: number;
  tipo: 'seccion' | 'categoria' | 'sin_pantalla';
  ruta_publica: string | null;
  staff_seccion: string | null;
  fichas: number;
  pines: number;
  visible_en_publico: boolean;
}

export function useModulesOverview() {
  return useQuery({
    queryKey: ['staff', 'modules-overview'],
    queryFn: () => staffFetch<{ modules: ModuleOverview[] }>('/api/admin/modules/overview').then((r) => r.modules),
  });
}

export const TIPO_LABEL: Record<ModuleOverview['tipo'], string> = {
  seccion: 'Sección',
  categoria: 'Categoría',
  sin_pantalla: 'Sin pantalla pública',
};
const NO_SCREEN_REASON = 'No se puede activar: aún no tiene pantalla pública';

const MESSAGES = { created: 'Módulo creado.', saved: 'Módulo guardado.', deleted: 'Módulo borrado.' };

export function ModulesManager() {
  const modules = useModules();
  const crud = useCrud<ModuleRow>({
    draftType: 'module',
    saveUrl: (id) => (id ? `/api/modules/${id}` : '/api/modules'),
    deleteUrl: (id) => `/api/modules/${id}`,
    invalidate: CONTENT_INVALIDATE,
    messages: MESSAGES,
  });
  const overview = useModulesOverview();
  const info = new Map((overview.data ?? []).map((o) => [o.id, o]));
  const rows = (modules.data ?? []).slice().sort((a, b) => a.orden - b.orden);

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => staffFetch(`/api/modules/${v.id}`, { method: 'PATCH', json: v.body }),
    onError: (e) =>
      toast.err(
        e instanceof ApiError && e.code === 'MODULE_WITHOUT_PUBLIC_ROUTE' ? e.message : `No se pudo guardar el módulo: ${errMsg(e)}`,
      ),
  });

  const toggle = (m: ModuleRow, activo: boolean) =>
    patch.mutate(
      { id: m.id, body: { activo } },
      {
        onSuccess: () => {
          toast.ok(activo ? `«${m.nombre}» activado.` : `«${m.nombre}» desactivado: desaparece de la navegación.`);
          crud.refresh();
        },
      },
    );

  // Reordena renumerando toda la secuencia 1..n (sin depender de valores repetidos).
  const move = async (index: number, dir: -1 | 1) => {
    const next = rows.slice();
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    try {
      await Promise.all(next.flatMap((m, i) => (m.orden === i + 1 ? [] : [patch.mutateAsync({ id: m.id, body: { orden: i + 1 } })])));
      toast.ok('Orden actualizado.');
    } catch {
      /* el aviso de error ya lo emite la mutación */
    }
    crud.refresh();
  };

  const onSubmit = (fd: FormData) => {
    if (!crud.editing) return;
    crud.setFormErr(null);
    const { s } = formGet(fd);
    const orden = Number(s('orden'));
    if (!s('slug') || !s('nombre') || !s('icono')) return crud.setFormErr('Slug, nombre e icono son obligatorios.');
    if (!SLUG_RE.test(s('slug'))) return crud.setFormErr('Slug inválido: minúsculas, números y guiones.');
    if (!Number.isInteger(orden)) return crud.setFormErr('El orden debe ser un entero.');
    crud.save(crud.item?.id ?? null, { slug: s('slug'), nombre: s('nombre'), icono: s('icono'), orden, activo: fd.get('activo') === 'on' });
  };
  const m = crud.item;

  return (
    <div>
      <p className="text-sm text-vice-text/80">Un módulo inactivo se oculta de la navegación y sus rutas dejan de estar disponibles.</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-vice-text/80">
        <li>
          <strong className="font-semibold text-vice-text">Sección</strong>: el interruptor enciende o apaga una pantalla propia de la app (Mapa, Foro).
        </li>
        <li>
          <strong className="font-semibold text-vice-text">Categoría</strong>: el interruptor controla una pestaña del catálogo (o las Guías); solo se
          muestra si está activa y tiene fichas.
        </li>
        <li>
          <strong className="font-semibold text-vice-text">Sin pantalla pública</strong>: todavía no se ve en la app y no se puede activar.
        </li>
      </ul>
      <div className="mt-3">
        <button type="button" onClick={crud.openNew} className={PRIMARY}>
          Nuevo módulo
        </button>
      </div>
      <QueryState
        loading={modules.isLoading}
        error={modules.error}
        empty={!modules.isLoading && !modules.error && rows.length === 0}
        emptyText="No hay módulos."
        onRetry={() => void modules.refetch()}
      />
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((it, i) => {
          const o = info.get(it.id);
          const blocked = o?.tipo === 'sin_pantalla' && !it.activo;
          const reasonId = `mod-reason-${it.id}`;
          return (
          <li key={it.id} className={ROW}>
            <div className="min-w-0 flex-1">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  role="switch"
                  checked={it.activo}
                  disabled={patch.isPending || blocked}
                  aria-describedby={blocked ? reasonId : undefined}
                  onChange={(ev) => toggle(it, ev.target.checked)}
                  className="h-5 w-5 accent-[#E1307E]"
                />
                <span className="min-w-0">
                  <span className="font-semibold">{it.nombre}</span>
                  <span className="ml-2 text-xs text-vice-text/70">
                    /{it.slug} · orden {it.orden} · {it.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </span>
              </label>
              {o && (
                <dl className="ml-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-vice-text/80">
                  <div className="flex gap-1">
                    <dt className="text-vice-text/60">Tipo:</dt>
                    <dd className="font-semibold">{TIPO_LABEL[o.tipo]}</dd>
                  </div>
                  <div className="flex items-center gap-1">
                    <dt className="text-vice-text/60">Dónde se ve:</dt>
                    <dd>
                      {o.ruta_publica ? (
                        <a href={o.ruta_publica} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center font-semibold text-vice-gold underline-offset-2 hover:underline">
                          {o.ruta_publica}
                        </a>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-vice-text/60">Fichas:</dt>
                    <dd className="font-semibold">{o.fichas}</dd>
                  </div>
                </dl>
              )}
              {blocked && (
                <p id={reasonId} className="ml-8 text-xs font-semibold text-vice-gold">
                  {NO_SCREEN_REASON}
                </p>
              )}
            </div>
            <span className="flex flex-wrap gap-2">
              <button type="button" disabled={i === 0 || patch.isPending} onClick={() => void move(i, -1)} className={SMALL_BTN} aria-label={`Subir ${it.nombre}`}>
                Subir
              </button>
              <button type="button" disabled={i === rows.length - 1 || patch.isPending} onClick={() => void move(i, 1)} className={SMALL_BTN} aria-label={`Bajar ${it.nombre}`}>
                Bajar
              </button>
              <button type="button" onClick={() => crud.openEdit(it)} className={SMALL_BTN} aria-label={`Editar ${it.nombre}`}>
                Editar
              </button>
              <button
                type="button"
                onClick={() => crud.askDelete({ type: 'module', id: it.id, label: it.nombre, confirmText: it.slug, confirmKind: 'slug' })}
                className={DANGER_BTN}
                aria-label={`Borrar ${it.nombre}`}
              >
                Borrar
              </button>
            </span>
          </li>
          );
        })}
      </ul>

      <FormModal
        open={crud.editing !== null}
        title={`${m ? 'Editar' : 'Nuevo'} módulo`}
        formId="module-form"
        draftKey={crud.draftKey}
        pending={crud.saving}
        error={crud.formErr}
        onClose={crud.closeForm}
        onSubmit={onSubmit}
      >
        <div key={m?.id ?? 'new'} className="flex flex-col gap-3">
          <Field id="m-slug" label="Slug" hint="Cambiarlo cambia la URL pública del módulo.">
            <input id="m-slug" name="slug" required maxLength={60} defaultValue={m?.slug ?? ''} className={INPUT} />
          </Field>
          <Field id="m-nombre" label="Nombre">
            <input id="m-nombre" name="nombre" required maxLength={80} defaultValue={m?.nombre ?? ''} className={INPUT} />
          </Field>
          <Field id="m-icono" label="Icono">
            <input id="m-icono" name="icono" required maxLength={60} defaultValue={m?.icono ?? ''} className={INPUT} />
          </Field>
          <Field id="m-orden" label="Orden (entero)">
            <input id="m-orden" name="orden" type="number" step={1} defaultValue={m?.orden ?? rows.length + 1} className={INPUT} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="activo" defaultChecked={m?.activo ?? true} className="h-5 w-5 accent-[#E1307E]" />
            Activo
          </label>
          {m && <ObjectHistory targetType="Module" targetId={m.id} />}
        </div>
      </FormModal>

      <SafeDelete target={crud.deleting} pending={crud.removing} onCancel={crud.cancelDelete} onConfirm={crud.confirmDelete} />
    </div>
  );
}
