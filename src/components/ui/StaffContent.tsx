// Sección «Contenido público» del panel de gestión (ADMIN+): Catálogo, Mapa interactivo y Módulos.
// Los campos reflejan los schemas Zod del servidor (server/src/models/{Module,Entity,MapMarker}.ts).
// La UI es cosmética: el servidor aplica RBAC (requireStaffRole('ADMIN')) y valida con Zod.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { entityHref, type EntityWithSlug } from '../../data/seed';
import type { MapMarker } from '../../types/database';
import {
  Block,
  ConfirmDelete,
  DANGER_BTN,
  errMsg,
  Field,
  formGet,
  FormModal,
  INPUT,
  Pager,
  PRIMARY,
  PublicLink,
  QueryState,
  ROW,
  SELECT,
  SMALL_BTN,
  staffFetch,
  SubTabs,
  toast,
  useDebounced,
} from './StaffKit';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PER_PAGE = 20;

interface ModuleRow {
  id: string;
  slug: string;
  nombre: string;
  icono: string;
  orden: number;
  activo: boolean;
}
interface EntityPage {
  items: EntityWithSlug[];
  total: number;
  page: number;
  pages: number;
}

/** Tras cualquier cambio de contenido: refresca el panel y las vistas públicas que lo muestran. */
function useRefreshAll(): () => void {
  const qc = useQueryClient();
  return () => {
    for (const key of ['staff', 'world', 'entity', 'config']) void qc.invalidateQueries({ queryKey: [key] });
  };
}

function useModules() {
  return useQuery({ queryKey: ['staff', 'modules'], queryFn: () => staffFetch<ModuleRow[]>('/api/modules?all=1') });
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

// ---- Catálogo ---------------------------------------------------------------------------------
export function CatalogManager({ fixedModule }: { fixedModule?: string }) {
  const refresh = useRefreshAll();
  const modules = useModules();
  const [moduleFilter, setModuleFilter] = useState(fixedModule ?? '');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ item: EntityWithSlug | null } | null>(null);
  const [deleting, setDeleting] = useState<EntityWithSlug | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const mods = modules.data ?? [];
  const slugOf = (id: string): string => mods.find((m) => m.id === id)?.slug ?? '';
  const nameOf = (id: string): string => mods.find((m) => m.id === id)?.nombre ?? '…';

  const list = useQuery({
    queryKey: ['staff', 'entities', moduleFilter, q, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      staffFetch<EntityPage>(
        `/api/entities?envelope=1&limit=${PER_PAGE}&page=${page}${moduleFilter ? `&module=${encodeURIComponent(moduleFilter)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { cache: 'no-cache' },
      ),
  });

  const save = useMutation({
    mutationFn: (v: { id: string | null; body: Record<string, unknown> }) =>
      staffFetch(v.id ? `/api/entities/${v.id}` : '/api/entities', { method: v.id ? 'PATCH' : 'POST', json: v.body }),
    onSuccess: (_d, v) => {
      toast.ok(v.id ? 'Ficha guardada.' : 'Ficha creada.');
      setEditing(null);
      refresh();
    },
    onError: (e) => setFormErr(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => staffFetch(`/api/entities/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.ok('Ficha borrada.');
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      toast.err(`No se pudo borrar: ${errMsg(e)}`);
      setDeleting(null);
    },
  });

  const onSubmit = (fd: FormData) => {
    if (!editing) return;
    setFormErr(null);
    const { s, n } = formGet(fd);
    if (!s('module_id')) return setFormErr('Elige un módulo.');
    if (!SLUG_RE.test(s('slug'))) return setFormErr('Slug inválido: minúsculas, números y guiones (a-b-c).');
    if (!s('titulo') || !s('categoria')) return setFormErr('Título y categoría son obligatorios.');
    const stats = parseJsonObject(s('stats_json'));
    const meta = parseJsonObject(s('metadata_json'));
    if (!stats || !meta) return setFormErr('Stats y metadatos deben ser un objeto JSON válido.');
    save.mutate({
      id: editing.item?.id ?? null,
      body: {
        module_id: s('module_id'),
        slug: s('slug'),
        titulo: s('titulo'),
        subtitulo: n('subtitulo'),
        categoria: s('categoria'),
        imagen_url: n('imagen_url'),
        stats_json: stats,
        metadata_json: meta,
      },
    });
  };

  const e = editing?.item ?? null;
  const total = list.data?.total ?? 0;
  const fixedName = fixedModule ? mods.find((m) => m.slug === fixedModule)?.nombre : undefined;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {!fixedModule && (
          <select
            aria-label="Filtrar por módulo"
            value={moduleFilter}
            onChange={(ev) => {
              setModuleFilter(ev.target.value);
              setPage(1);
            }}
            className={`${SELECT} sm:w-56`}
          >
            <option value="">Todos los módulos</option>
            {mods.map((m) => (
              <option key={m.id} value={m.slug}>
                {m.nombre}
              </option>
            ))}
          </select>
        )}
        <input
          type="search"
          aria-label="Buscar por nombre o slug"
          placeholder="Buscar por nombre o slug…"
          value={text}
          onChange={(ev) => {
            setText(ev.target.value);
            setPage(1);
          }}
          className={`${INPUT} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={() => {
            setFormErr(null);
            setEditing({ item: null });
          }}
          className={PRIMARY}
        >
          Nueva ficha
        </button>
      </div>
      {fixedName && <p className="mt-2 text-xs text-vice-text/70">Solo fichas del módulo «{fixedName}».</p>}

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
          return (
            <li key={it.id} className={ROW}>
              <span className="min-w-0">
                <span className="font-semibold">{it.titulo}</span>
                <span className="ml-2 text-xs text-vice-text/70">
                  {nameOf(it.module_id)} · {it.categoria} · /{it.slug}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {mSlug && <PublicLink href={entityHref(it, mSlug)}>Ver</PublicLink>}
                <button type="button" onClick={() => { setFormErr(null); setEditing({ item: it }); }} className={SMALL_BTN} aria-label={`Editar ${it.titulo}`}>
                  Editar
                </button>
                <button type="button" onClick={() => setDeleting(it)} className={DANGER_BTN} aria-label={`Borrar ${it.titulo}`}>
                  Borrar
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {list.data && total > 0 && <Pager page={list.data.page} pages={list.data.pages} total={total} onPage={setPage} />}

      <FormModal
        open={editing !== null}
        title={`${e ? 'Editar' : 'Nueva'} ficha`}
        formId="entity-form"
        pending={save.isPending}
        error={formErr}
        onClose={() => setEditing(null)}
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
        </div>
      </FormModal>

      <ConfirmDelete label={deleting?.titulo ?? null} pending={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}

// ---- Mapa interactivo -------------------------------------------------------------------------
function MapManager() {
  const refresh = useRefreshAll();
  const markers = useQuery({
    queryKey: ['staff', 'markers'],
    queryFn: () => staffFetch<MapMarker[]>('/api/markers', { cache: 'no-cache' }),
  });
  const [editing, setEditing] = useState<{ item: MapMarker | null } | null>(null);
  const [deleting, setDeleting] = useState<MapMarker | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  // El selector de entidad vinculada solo se carga al abrir el formulario.
  const entities = useQuery({
    queryKey: ['staff', 'entities-all'],
    enabled: editing !== null,
    queryFn: () => staffFetch<EntityWithSlug[]>('/api/entities?limit=500', { cache: 'no-cache' }),
  });
  const modules = useModules();

  const save = useMutation({
    mutationFn: (v: { id: string | null; body: Record<string, unknown> }) =>
      staffFetch(v.id ? `/api/markers/${v.id}` : '/api/markers', { method: v.id ? 'PATCH' : 'POST', json: v.body }),
    onSuccess: (_d, v) => {
      toast.ok(v.id ? 'Marcador guardado.' : 'Marcador creado.');
      setEditing(null);
      refresh();
    },
    onError: (e) => setFormErr(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => staffFetch(`/api/markers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.ok('Marcador borrado.');
      setDeleting(null);
      refresh();
    },
    onError: (e) => {
      toast.err(`No se pudo borrar: ${errMsg(e)}`);
      setDeleting(null);
    },
  });

  const onSubmit = (fd: FormData) => {
    if (!editing) return;
    setFormErr(null);
    const { s, n } = formGet(fd);
    const x = Number(s('coord_x'));
    const y = Number(s('coord_y'));
    if (!s('region') || !s('titulo')) return setFormErr('Región y título son obligatorios.');
    if (s('coord_x') === '' || s('coord_y') === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return setFormErr('Indica coordenadas numéricas válidas.');
    }
    if (x < 0 || x > 1000 || y < 0 || y > 700) return setFormErr('Coordenadas fuera del lienzo: X de 0 a 1000, Y de 0 a 700.');
    save.mutate({
      id: editing.item?.id ?? null,
      body: { entity_id: n('entity_id'), region: s('region'), titulo: s('titulo'), descripcion: n('descripcion'), coord_x: x, coord_y: y, media_url: n('media_url') },
    });
  };

  const groups = (modules.data ?? [])
    .slice()
    .sort((a, b) => Number(b.slug === 'mapa') - Number(a.slug === 'mapa') || a.orden - b.orden)
    .map((m) => ({ id: m.id, nombre: m.nombre, items: (entities.data ?? []).filter((en) => en.module_id === m.id) }))
    .filter((g) => g.items.length > 0);
  const m = editing?.item ?? null;
  const rows = markers.data ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setFormErr(null); setEditing({ item: null }); }} className={PRIMARY}>
          Nuevo marcador
        </button>
        <PublicLink href="/mapa?editor=1">Abrir el Modo Editor del mapa</PublicLink>
        <span className="text-sm text-vice-text/70">{rows.length} marcadores publicados</span>
      </div>
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
              <button type="button" onClick={() => { setFormErr(null); setEditing({ item: it }); }} className={SMALL_BTN} aria-label={`Editar ${it.titulo}`}>
                Editar
              </button>
              <button type="button" onClick={() => setDeleting(it)} className={DANGER_BTN} aria-label={`Borrar ${it.titulo}`}>
                Borrar
              </button>
            </span>
          </li>
        ))}
      </ul>

      <FormModal
        open={editing !== null}
        title={`${m ? 'Editar' : 'Nuevo'} marcador`}
        formId="marker-form"
        pending={save.isPending}
        error={formErr}
        onClose={() => setEditing(null)}
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
          <Field id="k-ent" label="Entidad vinculada (opcional)">
            <select id="k-ent" name="entity_id" defaultValue={m?.entity_id ?? ''} className={SELECT}>
              <option value="">Ninguna</option>
              {groups.map((g) => (
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
            <input id="k-media" name="media_url" defaultValue={m?.media_url ?? ''} className={INPUT} />
          </Field>
        </div>
      </FormModal>

      <ConfirmDelete label={deleting?.titulo ?? null} pending={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}

// ---- Módulos ----------------------------------------------------------------------------------
function ModulesManager() {
  const refresh = useRefreshAll();
  const modules = useModules();
  const [editing, setEditing] = useState<{ item: ModuleRow | null } | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const rows = (modules.data ?? []).slice().sort((a, b) => a.orden - b.orden);

  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => staffFetch(`/api/modules/${v.id}`, { method: 'PATCH', json: v.body }),
    onError: (e) => toast.err(`No se pudo guardar el módulo: ${errMsg(e)}`),
  });
  const save = useMutation({
    mutationFn: (v: { id: string | null; body: Record<string, unknown> }) =>
      staffFetch(v.id ? `/api/modules/${v.id}` : '/api/modules', { method: v.id ? 'PATCH' : 'POST', json: v.body }),
    onSuccess: (_d, v) => {
      toast.ok(v.id ? 'Módulo guardado.' : 'Módulo creado.');
      setEditing(null);
      refresh();
    },
    onError: (e) => setFormErr(errMsg(e)),
  });

  const toggle = (m: ModuleRow, activo: boolean) =>
    patch.mutate(
      { id: m.id, body: { activo } },
      {
        onSuccess: () => {
          toast.ok(activo ? `«${m.nombre}» activado.` : `«${m.nombre}» desactivado: desaparece de la navegación.`);
          refresh();
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
      await Promise.all(
        next.flatMap((m, i) => (m.orden === i + 1 ? [] : [patch.mutateAsync({ id: m.id, body: { orden: i + 1 } })])),
      );
      toast.ok('Orden actualizado.');
    } catch {
      /* el aviso de error ya lo emite la mutación */
    }
    refresh();
  };

  const onSubmit = (fd: FormData) => {
    if (!editing) return;
    setFormErr(null);
    const { s } = formGet(fd);
    const orden = Number(s('orden'));
    if (!s('slug') || !s('nombre') || !s('icono')) return setFormErr('Slug, nombre e icono son obligatorios.');
    if (!SLUG_RE.test(s('slug'))) return setFormErr('Slug inválido: minúsculas, números y guiones.');
    if (!Number.isInteger(orden)) return setFormErr('El orden debe ser un entero.');
    save.mutate({ id: editing.item?.id ?? null, body: { slug: s('slug'), nombre: s('nombre'), icono: s('icono'), orden, activo: fd.get('activo') === 'on' } });
  };
  const m = editing?.item ?? null;

  return (
    <div>
      <p className="text-sm text-vice-text/80">Un módulo inactivo se oculta de la navegación y sus rutas dejan de estar disponibles.</p>
      <div className="mt-3">
        <button type="button" onClick={() => { setFormErr(null); setEditing({ item: null }); }} className={PRIMARY}>
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
              <button type="button" onClick={() => { setFormErr(null); setEditing({ item: it }); }} className={SMALL_BTN} aria-label={`Editar ${it.nombre}`}>
                Editar
              </button>
            </span>
          </li>
        ))}
      </ul>

      <FormModal
        open={editing !== null}
        title={`${m ? 'Editar' : 'Nuevo'} módulo`}
        formId="module-form"
        pending={save.isPending}
        error={formErr}
        onClose={() => setEditing(null)}
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
        </div>
      </FormModal>
    </div>
  );
}

// ---- Sección ----------------------------------------------------------------------------------
type Sub = 'catalogo' | 'mapa' | 'modulos';
const SUBS: ReadonlyArray<{ id: Sub; label: string }> = [
  { id: 'catalogo', label: 'Catálogo' },
  { id: 'mapa', label: 'Mapa interactivo' },
  { id: 'modulos', label: 'Módulos' },
];

export default function StaffContent() {
  const [sub, setSub] = useState<Sub>('catalogo');
  return (
    <div className="flex flex-col gap-4">
      <SubTabs label="Contenido público" tabs={SUBS} value={sub} onChange={setSub} />
      {sub === 'catalogo' && (
        <Block
          id="blk-catalogo"
          title="Catálogo por categorías"
          controls="las fichas de armas, vehículos, coleccionables, guías y mapa que se ven en el Catálogo y el Inspector."
          href="/catalogo"
          linkLabel="Abrir el catálogo"
        >
          <CatalogManager />
        </Block>
      )}
      {sub === 'mapa' && (
        <Block
          id="blk-mapa"
          title="Mapa interactivo"
          controls="los marcadores del mapa de Leonida: posición, región y ficha vinculada. Un marcador existente está publicado."
          href="/mapa"
          linkLabel="Abrir el mapa"
        >
          <MapManager />
        </Block>
      )}
      {sub === 'modulos' && (
        <Block
          id="blk-modulos"
          title="Módulos del catálogo"
          controls="qué categorías aparecen en la navegación y en qué orden, y su nombre, icono y URL."
          href="/catalogo"
          linkLabel="Ver la navegación"
        >
          <ModulesManager />
        </Block>
      )}
    </div>
  );
}
