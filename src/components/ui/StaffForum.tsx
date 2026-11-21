// Bloque «Moderación del foro» de la sección Comunidad (MODERATOR+): fijar/cerrar hilos, editar hilos y respuestas y
// borrarlos con confirmación. El servidor aplica RBAC (404 uniforme sin rol) y valida con Zod; esta UI es cosmética.
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FORUM_CATEGORIES, forumCategoryLabel } from '../../data/seed';
import type { ForumThread } from '../../types/database';
import { FormModal, SafeDelete, useCrud } from './StaffForms';
import {
  Block,
  DANGER_BTN,
  errMsg,
  Field,
  formGet,
  INPUT,
  Pager,
  QueryState,
  SELECT,
  SMALL_BTN,
  staffFetch,
  toast,
} from './StaffKit';
import { useBlockFilters } from './StaffNav';
import { ObjectHistory } from './StaffHistory';

interface ForumProfile {
  id: string;
  username: string;
}
interface ThreadList {
  threads: ForumThread[];
  profiles: ForumProfile[];
  total: number;
  page: number;
  pages: number;
}
interface PostRow {
  id: string;
  user_id: string;
  contenido: string;
  created_at?: string;
}
interface ThreadDetail {
  thread: ForumThread;
  posts: PostRow[];
  profiles: ForumProfile[];
}

const THREAD_CRUD = {
  draftType: 'thread',
  saveUrl: (id: string | null) => `/api/admin/forum/threads/${id ?? ''}`,
  deleteUrl: (id: string) => `/api/forum/threads/${id}`,
  invalidate: ['forum'],
  messages: { created: 'Hilo creado.', saved: 'Hilo editado.', deleted: 'Hilo eliminado con sus respuestas.' },
} as const;
const POST_CRUD = {
  draftType: 'post',
  saveUrl: (id: string | null) => `/api/admin/forum/posts/${id ?? ''}`,
  deleteUrl: (id: string) => `/api/forum/posts/${id}`,
  invalidate: ['forum'],
  messages: { created: 'Respuesta creada.', saved: 'Respuesta editada.', deleted: 'Respuesta eliminada.' },
} as const;

function Badge({ children, tone }: { children: string; tone: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-vice-ink ${tone}`}>{children}</span>;
}

function ThreadPosts({ id, onEditPost, onDeletePost }: { id: string; onEditPost: (p: PostRow) => void; onDeletePost: (p: PostRow, author: string) => void }) {
  const detail = useQuery({
    queryKey: ['staff', 'forum-thread', id],
    queryFn: () => staffFetch<ThreadDetail>(`/api/admin/forum/threads/${id}`),
  });
  const names = new Map((detail.data?.profiles ?? []).map((p) => [p.id, p.username]));
  const posts = detail.data?.posts ?? [];
  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <QueryState
        loading={detail.isLoading}
        error={detail.error}
        empty={!detail.isLoading && !detail.error && posts.length === 0}
        emptyText="Este hilo no tiene respuestas."
        onRetry={() => void detail.refetch()}
      />
      <ul className="flex flex-col gap-2">
        {posts.map((p) => {
          const author = names.get(p.user_id) ?? p.user_id.slice(0, 8);
          return (
            <li key={p.id} className="rounded-lg bg-white/5 p-2">
              <p className="text-xs text-vice-text/70">{author}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{p.contenido}</p>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => onEditPost(p)} className={SMALL_BTN}>
                  Editar respuesta
                </button>
                <button type="button" onClick={() => onDeletePost(p, author)} className={DANGER_BTN}>
                  Borrar respuesta
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function StaffForum() {
  const { f, set, search, page, setPage } = useBlockFilters('foro', { q: '', c: '', p: '1' });
  const [open, setOpen] = useState<string | null>(null);
  const thread = useCrud<ForumThread>(THREAD_CRUD);
  const post = useCrud<PostRow>(POST_CRUD);

  const list = useQuery({
    queryKey: ['staff', 'forum', f.q, f.c, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      staffFetch<ThreadList>(
        `/api/admin/forum/threads?page=${page}&limit=20${f.q ? `&q=${encodeURIComponent(f.q)}` : ''}${f.c ? `&categoria=${encodeURIComponent(f.c)}` : ''}`,
      ),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown>; ok: string }) =>
      staffFetch(`/api/admin/forum/threads/${v.id}`, { method: 'PATCH', json: v.body }),
    onSuccess: (_d, v) => {
      toast.ok(v.ok);
      thread.refresh();
    },
    onError: (e) => toast.err(`No se pudo actualizar el hilo: ${errMsg(e)}`),
  });

  const names = new Map((list.data?.profiles ?? []).map((p) => [p.id, p.username]));
  const rows = list.data?.threads ?? [];
  const editing = thread.item;

  const onSubmitThread = (fd: FormData) => {
    if (!editing) return;
    thread.setFormErr(null);
    const { s } = formGet(fd);
    if (s('titulo').length < 3) return thread.setFormErr('El título necesita al menos 3 caracteres.');
    if (!s('contenido')) return thread.setFormErr('El contenido no puede quedar vacío.');
    thread.save(editing.id, { titulo: s('titulo'), contenido: s('contenido'), categoria: s('categoria'), is_spoiler: fd.get('is_spoiler') === 'on' });
  };
  const onSubmitPost = (fd: FormData) => {
    if (!post.item) return;
    post.setFormErr(null);
    const { s } = formGet(fd);
    if (!s('contenido')) return post.setFormErr('La respuesta no puede quedar vacía.');
    post.save(post.item.id, { contenido: s('contenido') });
  };

  return (
    <Block
      id="blk-foro"
      title="Moderación del foro"
      controls="los hilos y respuestas de /foro: fijar un hilo, cerrarlo a nuevas respuestas, editar su texto o eliminarlo."
      href="/foro"
      linkLabel="Abrir el foro"
    >
      <div className="flex flex-wrap gap-2">
        <select aria-label="Categoría" value={f.c} onChange={(e) => set({ c: e.target.value, p: '1' })} className={`${SELECT} sm:w-56`}>
          <option value="">Todas las categorías</option>
          {FORUM_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input type="search" aria-label="Buscar hilo por título" placeholder="Buscar hilo por título…" {...search} className={`${INPUT} min-w-0 flex-1`} />
      </div>
      <QueryState
        loading={list.isLoading}
        error={list.error}
        empty={!list.isLoading && !list.error && rows.length === 0}
        emptyText="No hay hilos con ese filtro."
        onRetry={() => void list.refetch()}
      />
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((t) => (
          <li key={t.id} className="rounded-xl bg-white/5 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-semibold">{t.titulo}</span>
                <span className="ml-2 text-xs text-vice-text/70">
                  {forumCategoryLabel(t.categoria)} · {names.get(t.user_id) ?? t.user_id.slice(0, 8)} · {t.replies_count ?? 0} respuestas
                </span>
                <span className="ml-2 inline-flex gap-1 align-middle">
                  {t.is_pinned && <Badge tone="bg-vice-gold">Fijado</Badge>}
                  {t.is_locked && <Badge tone="bg-vice-rose">Cerrado</Badge>}
                  {t.is_spoiler && <Badge tone="bg-vice-cyan">Spoiler</Badge>}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: t.id, body: { is_pinned: !t.is_pinned }, ok: t.is_pinned ? 'Hilo desfijado.' : 'Hilo fijado.' })}
                  className={SMALL_BTN}
                >
                  {t.is_pinned ? 'Desfijar' : 'Fijar'}
                </button>
                <button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: t.id, body: { is_locked: !t.is_locked }, ok: t.is_locked ? 'Hilo reabierto.' : 'Hilo cerrado a nuevas respuestas.' })}
                  className={SMALL_BTN}
                >
                  {t.is_locked ? 'Abrir' : 'Cerrar'}
                </button>
                <button type="button" onClick={() => thread.openEdit(t)} className={SMALL_BTN} aria-label={`Editar ${t.titulo}`}>
                  Editar
                </button>
                <button type="button" data-staff-detail aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)} className={SMALL_BTN}>
                  Respuestas
                </button>
                <button
                  type="button"
                  onClick={() => thread.askDelete({ type: 'thread', id: t.id, label: t.titulo, confirmText: t.id.slice(0, 8), confirmKind: 'id' })}
                  className={DANGER_BTN}
                  aria-label={`Eliminar ${t.titulo}`}
                >
                  Eliminar
                </button>
              </span>
            </div>
            {open === t.id && (
              <ThreadPosts
                id={t.id}
                onEditPost={post.openEdit}
                onDeletePost={(p, author) => post.askDelete({ type: 'post', id: p.id, label: `Respuesta de ${author}`, confirmText: null })}
              />
            )}
          </li>
        ))}
      </ul>
      {list.data && list.data.total > 0 && <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}

      <FormModal open={editing !== null} title="Editar hilo" formId="thread-form" draftKey={thread.draftKey} pending={thread.saving} error={thread.formErr} onClose={thread.closeForm} onSubmit={onSubmitThread}>
        <div key={editing?.id ?? 'x'} className="flex flex-col gap-3">
          <Field id="t-titulo" label="Título">
            <input id="t-titulo" name="titulo" required maxLength={160} defaultValue={editing?.titulo ?? ''} className={INPUT} />
          </Field>
          <Field id="t-cat" label="Categoría">
            <select id="t-cat" name="categoria" defaultValue={editing?.categoria ?? 'General'} className={SELECT}>
              {FORUM_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="t-cont" label="Contenido">
            <textarea id="t-cont" name="contenido" rows={6} maxLength={10000} defaultValue={editing?.contenido ?? ''} className={`${INPUT} py-2`} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="is_spoiler" defaultChecked={editing?.is_spoiler ?? false} className="h-5 w-5 accent-[#E1307E]" />
            Marcar como spoiler
          </label>
          {editing && <ObjectHistory targetType="ForumThread" targetId={editing.id} />}
        </div>
      </FormModal>

      <FormModal open={post.item !== null} title="Editar respuesta" formId="post-form" draftKey={post.draftKey} pending={post.saving} error={post.formErr} onClose={post.closeForm} onSubmit={onSubmitPost}>
        <div key={post.item?.id ?? 'x'}>
          <Field id="p-cont" label="Contenido">
            <textarea id="p-cont" name="contenido" rows={6} maxLength={10000} defaultValue={post.item?.contenido ?? ''} className={`${INPUT} py-2`} />
          </Field>
        </div>
      </FormModal>

      <SafeDelete target={thread.deleting} pending={thread.removing} onCancel={thread.cancelDelete} onConfirm={thread.confirmDelete} />
      <SafeDelete target={post.deleting} pending={post.removing} onCancel={post.cancelDelete} onConfirm={post.confirmDelete} />
    </Block>
  );
}
