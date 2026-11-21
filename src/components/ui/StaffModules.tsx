// Gestor de módulos del catálogo (ADMIN+): visibilidad, orden, nombre, icono y URL. Los campos reflejan
// server/src/models/Module.ts; la UI es cosmética (el servidor aplica RBAC y valida con Zod).
import { useMutation, useQuery } from '@tanstack/react-query';
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
  const rows = (modules.data ?? []).slice().sort((a, b) => a.orden - b.orden);

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => staffFetch(`/api/modules/${v.id}`, { method: 'PATCH', json: v.body }),
    onError: (e) => toast.err(`No se pudo guardar el módulo: ${errMsg(e)}`),
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
        {rows.map((it, i) => (
          <li key={it.id} className={ROW}>
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
              <input
                type="checkbox"
                role="switch"
                checked={it.activo}
                disabled={patch.isPending}
                onChange={(ev) => toggle(it, ev.target.checked)}
                className="h-5 w-5 accent-[#E1307E]"
              />
              <span className="min-w-0">
                <span className="font-semibold">{it.nombre}</span>
                <span className="ml-2 text-xs text-vice-text/70">
                  /{it.slug} · orden {it.orden} · {it.activo ? 'activo' : 'inactivo'}
                </span>
              </span>
            </label>
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
        ))}
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
