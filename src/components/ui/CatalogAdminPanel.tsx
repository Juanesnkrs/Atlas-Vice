// Gestión de catálogo y mapa (ADMIN+): CRUD de Entidades y Marcadores, alta/edición de Módulos.
// Los campos reflejan los schemas Zod del servidor (server/src/models/{Module,Entity,MapMarker}.ts).
// La UI es cosmética: el servidor aplica RBAC (requireRole('ADMIN')) y valida con Zod.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { usePublicConfig, useWorldData, type EntityWithSlug } from '../../data/seed';
import { apiFetch, isApiConfigured } from '../../store/useAuthStore';
import type { MapMarker } from '../../types/database';
import { Modal } from './Modal';

const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
const SELECT = `${INPUT} bg-[#2e1a47]`;
const BTN =
  'flex min-h-11 items-center justify-center rounded-xl px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-50';
const PRIMARY = `${BTN} bg-vice-accent font-bold text-vice-ink`;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Section = 'entidades' | 'marcadores' | 'modulos';
interface ModuleRow {
  id: string;
  slug: string;
  nombre: string;
  icono: string;
  orden: number;
  isActive: boolean;
}
type Editing =
  | { kind: 'entidades'; item: EntityWithSlug | null }
  | { kind: 'marcadores'; item: MapMarker | null }
  | { kind: 'modulos'; item: ModuleRow | null };
type Deleting = { kind: 'entidades' | 'marcadores'; id: string; label: string };

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Error desconocido');

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-vice-text/70">{hint}</p>}
    </div>
  );
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

export function CatalogAdminPanel() {
  const qc = useQueryClient();
  const { data: world } = useWorldData();
  const cfg = usePublicConfig();
  const [section, setSection] = useState<Section>('entidades');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const online = isApiConfigured;

  const modules: ModuleRow[] = (
    cfg.modules ??
    world.modules.map((m) => ({ id: m.id, slug: m.slug, nombre: m.nombre, icono: m.icono, orden: m.orden, isActive: m.activo }))
  )
    .slice()
    .sort((a, b) => a.orden - b.orden);
  const moduleName = (id: string): string => modules.find((m) => m.id === id)?.nombre ?? id.slice(0, 8);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['world'] });
    void qc.invalidateQueries({ queryKey: ['entity'] });
    void qc.invalidateQueries({ queryKey: ['config'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const save = useMutation({
    mutationFn: (v: { path: string; id: string | null; body: Record<string, unknown> }) =>
      apiFetch(v.id ? `${v.path}/${v.id}` : v.path, { method: v.id ? 'PATCH' : 'POST', json: v.body }),
    onSuccess: (_d, v) => {
      setMsg({ ok: true, text: v.id ? 'Cambios guardados.' : 'Creado correctamente.' });
      setEditing(null);
      refresh();
    },
    onError: (e) => setFormErr(errMsg(e)),
  });

  const remove = useMutation({
    mutationFn: (d: Deleting) => apiFetch(`/api/${d.kind === 'entidades' ? 'entities' : 'markers'}/${d.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Elemento borrado.' });
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      setMsg({ ok: false, text: `No se pudo borrar: ${errMsg(e)}` });
      setDeleting(null);
    },
  });

  // Entidades agrupadas por módulo; 'mapa' primero para vincular pines rápidamente.
  const entityGroups = [...world.modules]
    .sort((a, b) => Number(b.slug === 'mapa') - Number(a.slug === 'mapa') || a.orden - b.orden)
    .map((m) => ({ id: m.id, nombre: m.nombre, items: world.entities.filter((en) => en.module_id === m.id) }))
    .filter((g) => g.items.length > 0);

  const open = (e: Editing) => {
    setFormErr(null);
    setMsg(null);
    setEditing(e);
  };

  const onSubmit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!editing) return;
    setFormErr(null);
    const fd = new FormData(ev.currentTarget);
    const get = (k: string): string => String(fd.get(k) ?? '').trim();
    const orNull = (k: string): string | null => get(k) || null;
    const id = editing.item?.id ?? null;

    if (editing.kind === 'modulos') {
      const orden = Number(get('orden'));
      if (!get('slug') || !get('nombre') || !get('icono')) return setFormErr('Slug, nombre e icono son obligatorios.');
      if (!Number.isInteger(orden)) return setFormErr('El orden debe ser un entero.');
      save.mutate({
        path: '/api/modules',
        id,
        body: { slug: get('slug'), nombre: get('nombre'), icono: get('icono'), orden, activo: fd.get('activo') === 'on' },
      });
    } else if (editing.kind === 'entidades') {
      if (!get('module_id')) return setFormErr('Elige un módulo.');
      if (!SLUG_RE.test(get('slug'))) return setFormErr('Slug inválido: minúsculas, números y guiones (a-b-c).');
      if (!get('titulo') || !get('categoria')) return setFormErr('Título y categoría son obligatorios.');
      const stats = parseJsonObject(get('stats_json'));
      const meta = parseJsonObject(get('metadata_json'));
      if (!stats || !meta) return setFormErr('Stats y metadatos deben ser un objeto JSON válido.');
      save.mutate({
        path: '/api/entities',
        id,
        body: {
          module_id: get('module_id'),
          slug: get('slug'),
          titulo: get('titulo'),
          subtitulo: orNull('subtitulo'),
          categoria: get('categoria'),
          imagen_url: orNull('imagen_url'),
          stats_json: stats,
          metadata_json: meta,
        },
      });
    } else {
      const x = Number(get('coord_x'));
      const y = Number(get('coord_y'));
      if (!get('region') || !get('titulo')) return setFormErr('Región y título son obligatorios.');
      if (get('coord_x') === '' || get('coord_y') === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
        return setFormErr('Indica coordenadas numéricas válidas.');
      }
      save.mutate({
        path: '/api/markers',
        id,
        body: {
          entity_id: orNull('entity_id'),
          region: get('region'),
          titulo: get('titulo'),
          descripcion: orNull('descripcion'),
          coord_x: x,
          coord_y: y,
          media_url: orNull('media_url'),
        },
      });
    }
  };

  const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
    { id: 'entidades', label: `Entidades (${world.entities.length})` },
    { id: 'marcadores', label: `Marcadores (${world.markers.length})` },
    { id: 'modulos', label: `Módulos (${modules.length})` },
  ];

  const rowCls = 'flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2';
  const smallBtn = `${BTN} bg-white/10 px-3 text-sm hover:bg-white/20`;
  const dangerBtn = `${BTN} border border-vice-rose/60 px-3 text-sm text-vice-rose hover:bg-white/10`;

  const e = editing;
  const modalTitle = e ? `${e.item ? 'Editar' : 'Nuevo'} ${e.kind === 'entidades' ? 'entidad' : e.kind === 'marcadores' ? 'marcador' : 'módulo'}` : '';

  return (
    <section aria-labelledby="catadmin-title" className="glass rounded-2xl p-5">
      <h2 id="catadmin-title" className="font-display text-xl font-bold">
        Catálogo y mapa
      </h2>
      <p className="mt-1 text-sm text-vice-text/80">Alta, edición y borrado de contenido publicado. Cada cambio queda en el registro de auditoría.</p>
      {!online && (
        <p role="status" className="mt-2 text-sm text-vice-gold">
          Sin API configurada: la edición no está disponible.
        </p>
      )}

      <div role="group" aria-label="Tipo de contenido" className="mt-3 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={section === s.id}
            onClick={() => setSection(s.id)}
            className={`${BTN} ${section === s.id ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/20'}`}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          disabled={!online}
          onClick={() => open({ kind: section, item: null } as Editing)}
          className={`${PRIMARY} sm:ml-auto`}
        >
          Nuevo
        </button>
      </div>

      <div aria-live="polite" className="min-h-[1.25rem] pt-2 text-sm">
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-vice-cyan' : 'text-vice-gold'}>
            {msg.text}
          </p>
        )}
      </div>

      <ul className="mt-1 flex max-h-[480px] flex-col gap-2 overflow-y-auto">
        {section === 'entidades' &&
          (world.entities as EntityWithSlug[]).map((it) => (
            <li key={it.id} className={rowCls}>
              <span className="min-w-0">
                <span className="font-semibold">{it.titulo}</span>
                <span className="ml-2 text-xs text-vice-text/70">
                  {moduleName(it.module_id)} · {it.categoria} · /{it.slug}
                </span>
              </span>
              <span className="flex gap-2">
                <button type="button" disabled={!online} onClick={() => open({ kind: 'entidades', item: it })} className={smallBtn} aria-label={`Editar ${it.titulo}`}>
                  Editar
                </button>
                <button type="button" disabled={!online} onClick={() => setDeleting({ kind: 'entidades', id: it.id, label: it.titulo })} className={dangerBtn} aria-label={`Borrar ${it.titulo}`}>
                  Borrar
                </button>
              </span>
            </li>
          ))}
        {section === 'marcadores' &&
          world.markers.map((it) => (
            <li key={it.id} className={rowCls}>
              <span className="min-w-0">
                <span className="font-semibold">{it.titulo}</span>
                <span className="ml-2 text-xs text-vice-text/70">
                  {it.region} · ({it.coord_x}, {it.coord_y})
                </span>
              </span>
              <span className="flex gap-2">
                <button type="button" disabled={!online} onClick={() => open({ kind: 'marcadores', item: it })} className={smallBtn} aria-label={`Editar ${it.titulo}`}>
                  Editar
                </button>
                <button type="button" disabled={!online} onClick={() => setDeleting({ kind: 'marcadores', id: it.id, label: it.titulo })} className={dangerBtn} aria-label={`Borrar ${it.titulo}`}>
                  Borrar
                </button>
              </span>
            </li>
          ))}
        {section === 'modulos' &&
          modules.map((it) => (
            <li key={it.id} className={rowCls}>
              <span className="min-w-0">
                <span className="font-semibold">{it.nombre}</span>
                <span className="ml-2 text-xs text-vice-text/70">
                  /{it.slug} · orden {it.orden} · {it.isActive ? 'activo' : 'inactivo'}
                </span>
              </span>
              <button type="button" disabled={!online} onClick={() => open({ kind: 'modulos', item: it })} className={smallBtn} aria-label={`Editar ${it.nombre}`}>
                Editar
              </button>
            </li>
          ))}
      </ul>

      <Modal
        open={e !== null}
        onClose={() => setEditing(null)}
        title={modalTitle}
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setEditing(null)} className={`${BTN} flex-1 bg-white/10 hover:bg-white/20`}>
              Cancelar
            </button>
            <button type="submit" form="catadmin-form" disabled={save.isPending} className={`${PRIMARY} flex-1`}>
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        }
      >
        {e && (
          <form id="catadmin-form" key={`${e.kind}-${e.item?.id ?? 'new'}`} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
            {e.kind === 'modulos' && (
              <>
                <Field id="m-slug" label="Slug">
                  <input id="m-slug" name="slug" required maxLength={60} defaultValue={e.item?.slug ?? ''} className={INPUT} />
                </Field>
                <Field id="m-nombre" label="Nombre">
                  <input id="m-nombre" name="nombre" required maxLength={80} defaultValue={e.item?.nombre ?? ''} className={INPUT} />
                </Field>
                <Field id="m-icono" label="Icono">
                  <input id="m-icono" name="icono" required maxLength={60} defaultValue={e.item?.icono ?? ''} className={INPUT} />
                </Field>
                <Field id="m-orden" label="Orden (entero)">
                  <input id="m-orden" name="orden" type="number" step={1} defaultValue={e.item?.orden ?? 0} className={INPUT} />
                </Field>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" name="activo" defaultChecked={e.item?.isActive ?? true} className="h-5 w-5 accent-[#E1307E]" />
                  Activo
                </label>
              </>
            )}
            {e.kind === 'entidades' && (
              <>
                <Field id="e-mod" label="Módulo">
                  <select id="e-mod" name="module_id" required defaultValue={e.item?.module_id ?? ''} className={SELECT}>
                    <option value="" disabled>
                      Elige un módulo
                    </option>
                    {modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="e-slug" label="Slug" hint="Minúsculas, números y guiones. Máx. 120.">
                  <input id="e-slug" name="slug" required maxLength={120} defaultValue={e.item?.slug ?? ''} className={INPUT} />
                </Field>
                <Field id="e-titulo" label="Título">
                  <input id="e-titulo" name="titulo" required maxLength={160} defaultValue={e.item?.titulo ?? ''} className={INPUT} />
                </Field>
                <Field id="e-sub" label="Subtítulo (opcional)">
                  <input id="e-sub" name="subtitulo" maxLength={240} defaultValue={e.item?.subtitulo ?? ''} className={INPUT} />
                </Field>
                <Field id="e-cat" label="Categoría">
                  <input id="e-cat" name="categoria" required maxLength={80} defaultValue={e.item?.categoria ?? ''} className={INPUT} />
                </Field>
                <Field id="e-img" label="URL de imagen (opcional)">
                  <input id="e-img" name="imagen_url" defaultValue={e.item?.imagen_url ?? ''} className={INPUT} />
                </Field>
                <Field id="e-stats" label="Stats (JSON)">
                  <textarea id="e-stats" name="stats_json" rows={3} defaultValue={JSON.stringify(e.item?.stats_json ?? {}, null, 2)} className={`${INPUT} py-2 font-mono text-sm`} />
                </Field>
                <Field id="e-meta" label="Metadatos (JSON)">
                  <textarea id="e-meta" name="metadata_json" rows={3} defaultValue={JSON.stringify(e.item?.metadata_json ?? {}, null, 2)} className={`${INPUT} py-2 font-mono text-sm`} />
                </Field>
              </>
            )}
            {e.kind === 'marcadores' && (
              <>
                <Field id="k-region" label="Región">
                  <input id="k-region" name="region" required maxLength={80} defaultValue={e.item?.region ?? ''} className={INPUT} />
                </Field>
                <Field id="k-titulo" label="Título">
                  <input id="k-titulo" name="titulo" required maxLength={160} defaultValue={e.item?.titulo ?? ''} className={INPUT} />
                </Field>
                <Field id="k-desc" label="Descripción (opcional)">
                  <textarea id="k-desc" name="descripcion" rows={3} maxLength={2000} defaultValue={e.item?.descripcion ?? ''} className={`${INPUT} py-2`} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="k-x" label="Coordenada X" hint="Mapa: 0 a 1000">
                    <input id="k-x" name="coord_x" type="number" step="any" required defaultValue={e.item?.coord_x ?? ''} className={INPUT} />
                  </Field>
                  <Field id="k-y" label="Coordenada Y" hint="Mapa: 0 a 700">
                    <input id="k-y" name="coord_y" type="number" step="any" required defaultValue={e.item?.coord_y ?? ''} className={INPUT} />
                  </Field>
                </div>
                <Field id="k-ent" label="Entidad vinculada (opcional)">
                  <select id="k-ent" name="entity_id" defaultValue={e.item?.entity_id ?? ''} className={SELECT}>
                    <option value="">Ninguna</option>
                    {entityGroups.map((g) => (
                      <optgroup key={g.id} label={g.nombre}>
                        {g.items.map((en) => (
                          <option key={en.id} value={en.id}>
                            {en.titulo}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field id="k-media" label="URL de medio (opcional)">
                  <input id="k-media" name="media_url" defaultValue={e.item?.media_url ?? ''} className={INPUT} />
                </Field>
              </>
            )}
            <div aria-live="assertive" className="min-h-[1.25rem] text-sm">
              {formErr && (
                <p role="alert" className="text-vice-gold">
                  {formErr}
                </p>
              )}
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Confirmar borrado"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setDeleting(null)} className={`${BTN} flex-1 bg-white/10 hover:bg-white/20`}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting)}
              className={`${BTN} flex-1 bg-vice-rose font-bold text-vice-ink`}
            >
              {remove.isPending ? 'Borrando…' : 'Borrar'}
            </button>
          </div>
        }
      >
        <p className="text-sm">
          Se borrará «{deleting?.label}». Esta acción no se puede deshacer.
        </p>
      </Modal>
    </section>
  );
}

export default CatalogAdminPanel;
