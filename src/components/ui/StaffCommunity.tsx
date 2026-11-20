// Sección «Comunidad y moderación» del panel de gestión (MODERATOR+): bandeja de aportes y moderación del foro.
// El servidor aplica RBAC (404 uniforme sin rol) y valida con Zod; esta UI es cosmética.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FORUM_CATEGORIES, forumCategoryLabel } from '../../data/seed';
import type { ForumCategoria, ForumThread } from '../../types/database';
import StaffModeration from './StaffModeration';
import {
  Block,
  ConfirmDelete,
  DANGER_BTN,
  errMsg,
  Field,
  FormModal,
  formGet,
  INPUT,
  Pager,
  QueryState,
  SELECT,
  SMALL_BTN,
  staffFetch,
  SubTabs,
  toast,
  useDebounced,
} from './StaffKit';

interface ForumProfile {
  id: string;
  username: string;
}
interface ThreadRow extends ForumThread {
  is_locked?: boolean;
}
interface ThreadList {
  threads: ThreadRow[];
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
  thread: ThreadRow;
  posts: PostRow[];
  profiles: ForumProfile[];
}

function Badge({ children, tone }: { children: string; tone: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-vice-ink ${tone}`}>{children}</span>;
}

function ThreadPosts({ id, onEditPost, onDeletePost }: { id: string; onEditPost: (p: PostRow) => void; onDeletePost: (p: PostRow) => void }) {
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
        {posts.map((p) => (
          <li key={p.id} className="rounded-lg bg-white/5 p-2">
            <p className="text-xs text-vice-text/70">{names.get(p.user_id) ?? p.user_id.slice(0, 8)}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{p.contenido}</p>
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => onEditPost(p)} className={SMALL_BTN}>
                Editar respuesta
              </button>
              <button type="button" onClick={() => onDeletePost(p)} className={DANGER_BTN}>
                Borrar respuesta
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ForumModeration() {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 250);
  const [categoria, setCategoria] = useState<ForumCategoria | ''>('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [editThread, setEditThread] = useState<ThreadRow | null>(null);
  const [editPost, setEditPost] = useState<PostRow | null>(null);
  const [delThread, setDelThread] = useState<ThreadRow | null>(null);
  const [delPost, setDelPost] = useState<PostRow | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['staff', 'forum', q, categoria, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      staffFetch<ThreadList>(
        `/api/admin/forum/threads?page=${page}&limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}${categoria ? `&categoria=${encodeURIComponent(categoria)}` : ''}`,
      ),
  });

  const refresh = () => {
    for (const key of ['staff', 'forum']) void qc.invalidateQueries({ queryKey: [key] });
  };
  const patchThread = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown>; ok: string }) =>
      staffFetch(`/api/admin/forum/threads/${v.id}`, { method: 'PATCH', json: v.body }),
    onSuccess: (_d, v) => {
      toast.ok(v.ok);
      setEditThread(null);
      refresh();
    },
    onError: (e) => {
      setFormErr(errMsg(e));
      toast.err(`No se pudo actualizar el hilo: ${errMsg(e)}`);
    },
  });
  const patchPost = useMutation({
    mutationFn: (v: { id: string; contenido: string }) =>
      staffFetch(`/api/admin/forum/posts/${v.id}`, { method: 'PATCH', json: { contenido: v.contenido } }),
    onSuccess: () => {
      toast.ok('Respuesta editada.');
      setEditPost(null);
      refresh();
    },
    onError: (e) => setFormErr(errMsg(e)),
  });
  const removeThread = useMutation({
    mutationFn: (id: string) => staffFetch(`/api/forum/threads/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.ok('Hilo eliminado con sus respuestas.');
      setDelThread(null);
      refresh();
    },
    onError: (e) => {
      toast.err(`No se pudo eliminar el hilo: ${errMsg(e)}`);
      setDelThread(null);
    },
  });
  const removePost = useMutation({
    mutationFn: (id: string) => staffFetch(`/api/forum/posts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.ok('Respuesta eliminada.');
      setDelPost(null);
      refresh();
    },
    onError: (e) => {
      toast.err(`No se pudo eliminar la respuesta: ${errMsg(e)}`);
      setDelPost(null);
    },
  });

  const names = new Map((list.data?.profiles ?? []).map((p) => [p.id, p.username]));
  const rows = list.data?.threads ?? [];

  const onSubmitThread = (fd: FormData) => {
    if (!editThread) return;
    setFormErr(null);
    const { s } = formGet(fd);
    if (s('titulo').length < 3) return setFormErr('El título necesita al menos 3 caracteres.');
    if (!s('contenido')) return setFormErr('El contenido no puede quedar vacío.');
    patchThread.mutate({
      id: editThread.id,
      ok: 'Hilo editado.',
      body: { titulo: s('titulo'), contenido: s('contenido'), categoria: s('categoria'), is_spoiler: fd.get('is_spoiler') === 'on' },
    });
  };
  const onSubmitPost = (fd: FormData) => {
    if (!editPost) return;
    setFormErr(null);
    const { s } = formGet(fd);
    if (!s('contenido')) return setFormErr('La respuesta no puede quedar vacía.');
    patchPost.mutate({ id: editPost.id, contenido: s('contenido') });
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
        <select
          aria-label="Categoría"
          value={categoria}
          onChange={(e) => {
            setCategoria(e.target.value as ForumCategoria | '');
            setPage(1);
          }}
          className={`${SELECT} sm:w-56`}
        >
          <option value="">Todas las categorías</option>
          {FORUM_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Buscar hilo por título"
          placeholder="Buscar hilo por título…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPage(1);
          }}
          className={`${INPUT} min-w-0 flex-1`}
        />
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
                  disabled={patchThread.isPending}
                  onClick={() => patchThread.mutate({ id: t.id, body: { is_pinned: !t.is_pinned }, ok: t.is_pinned ? 'Hilo desfijado.' : 'Hilo fijado.' })}
                  className={SMALL_BTN}
                >
                  {t.is_pinned ? 'Desfijar' : 'Fijar'}
                </button>
                <button
                  type="button"
                  disabled={patchThread.isPending}
                  onClick={() => patchThread.mutate({ id: t.id, body: { is_locked: !t.is_locked }, ok: t.is_locked ? 'Hilo reabierto.' : 'Hilo cerrado a nuevas respuestas.' })}
                  className={SMALL_BTN}
                >
                  {t.is_locked ? 'Abrir' : 'Cerrar'}
                </button>
                <button type="button" onClick={() => { setFormErr(null); setEditThread(t); }} className={SMALL_BTN} aria-label={`Editar ${t.titulo}`}>
                  Editar
                </button>
                <button type="button" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)} className={SMALL_BTN}>
                  Respuestas
                </button>
                <button type="button" onClick={() => setDelThread(t)} className={DANGER_BTN} aria-label={`Eliminar ${t.titulo}`}>
                  Eliminar
                </button>
              </span>
            </div>
            {open === t.id && <ThreadPosts id={t.id} onEditPost={(p) => { setFormErr(null); setEditPost(p); }} onDeletePost={setDelPost} />}
          </li>
        ))}
      </ul>
      {list.data && list.data.total > 0 && <Pager page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}

      <FormModal open={editThread !== null} title="Editar hilo" formId="thread-form" pending={patchThread.isPending} error={formErr} onClose={() => setEditThread(null)} onSubmit={onSubmitThread}>
        <div key={editThread?.id ?? 'x'} className="flex flex-col gap-3">
          <Field id="t-titulo" label="Título">
            <input id="t-titulo" name="titulo" required maxLength={160} defaultValue={editThread?.titulo ?? ''} className={INPUT} />
          </Field>
          <Field id="t-cat" label="Categoría">
            <select id="t-cat" name="categoria" defaultValue={editThread?.categoria ?? 'General'} className={SELECT}>
              {FORUM_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="t-cont" label="Contenido">
            <textarea id="t-cont" name="contenido" rows={6} maxLength={10000} defaultValue={editThread?.contenido ?? ''} className={`${INPUT} py-2`} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="is_spoiler" defaultChecked={editThread?.is_spoiler ?? false} className="h-5 w-5 accent-[#E1307E]" />
            Marcar como spoiler
          </label>
        </div>
      </FormModal>

      <FormModal open={editPost !== null} title="Editar respuesta" formId="post-form" pending={patchPost.isPending} error={formErr} onClose={() => setEditPost(null)} onSubmit={onSubmitPost}>
        <div key={editPost?.id ?? 'x'}>
          <Field id="p-cont" label="Contenido">
            <textarea id="p-cont" name="contenido" rows={6} maxLength={10000} defaultValue={editPost?.contenido ?? ''} className={`${INPUT} py-2`} />
          </Field>
        </div>
      </FormModal>

      <ConfirmDelete label={delThread?.titulo ?? null} pending={removeThread.isPending} onCancel={() => setDelThread(null)} onConfirm={() => delThread && removeThread.mutate(delThread.id)} />
      <ConfirmDelete label={delPost ? 'esta respuesta' : null} pending={removePost.isPending} onCancel={() => setDelPost(null)} onConfirm={() => delPost && removePost.mutate(delPost.id)} />
    </Block>
  );
}

type Sub = 'aportes' | 'foro';
const SUBS: ReadonlyArray<{ id: Sub; label: string }> = [
  { id: 'aportes', label: 'Aportes' },
  { id: 'foro', label: 'Foro' },
];

export default function StaffCommunity() {
  const [sub, setSub] = useState<Sub>('aportes');
  return (
    <div className="flex flex-col gap-4">
      <SubTabs label="Comunidad y moderación" tabs={SUBS} value={sub} onChange={setSub} />
      {sub === 'aportes' ? <StaffModeration /> : <ForumModeration />}
    </div>
  );
}
