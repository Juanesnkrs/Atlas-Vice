// P07 - Foro y Comunidad (Forum.dc.html + pestaña Foro de Mobile.dc.html).
// Invitado: escaparate en vivo (solo lista en formato preview, DesignSpec §7.5). Cualquier control
// abre el muro de registro; ningún contenido de hilo llega a renderizarse. Con sesión: foro completo.
// La restricción real la aplica el servidor: aquí solo se evita pedir/mostrar lo que no corresponde.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { ApiErrorState } from '../components/ui/ApiErrorState';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Modal } from '../components/ui/Modal';
import { PalmButton } from '../components/ui/PalmButton';
import {
  DISCORD_URL,
  entityHref,
  FORUM_CATEGORIES,
  forumCategoryLabel,
  relativeTime,
  useForumData,
  useWorldData,
  type ForumData,
} from '../data/seed';
import { apiFetch, isApiConfigured, useAuthStore } from '../store/useAuthStore';
import { navigate } from '../store/useRouteStore';
import type { ForumCategoria, ForumPost, ForumThread } from '../types/database';

type SortMode = 'trend' | 'recent';

const LOGIN_HREF = '/entrar?next=/foro';
const WALL_TITLE = 'Crea tu cuenta gratis para leer la conversación';
const INPUT =
  'min-h-11 w-full rounded-xl border border-vice-orange/30 bg-white/[0.07] px-4 text-base text-vice-text placeholder:text-vice-text/60 focus-visible:outline-2 focus-visible:outline-vice-gold';
const BTN =
  'flex min-h-11 items-center justify-center rounded-xl px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFC09A]';

const TAG_BG: Record<ForumCategoria, string> = {
  General: 'bg-white/20',
  'Guias/Ayuda': 'bg-vice-cyan/45',
  Secretos: 'bg-vice-lilac/50',
  Crews: 'bg-vice-gold/45',
};
const AVATARS = ['#FF9CC4', '#8FE3EC', '#CDBBFF', '#FFD98A', '#A7EEBF'];
const avatarOf = (name: string): string => AVATARS[(name.charCodeAt(0) + name.length) % AVATARS.length] ?? '#FF9CC4';

function CategoryTag({ categoria }: { categoria: ForumCategoria }) {
  return (
    <span className={`rounded-[10px] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-white md:text-[11px] ${TAG_BG[categoria]}`}>
      {forumCategoryLabel(categoria).toUpperCase()}
    </span>
  );
}

function SpoilerTag() {
  return <span className="rounded-[10px] bg-vice-gold px-2.5 py-0.5 text-[10px] font-bold tracking-[0.06em] text-vice-ink md:text-[11px]">SPOILER</span>;
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] text-[#5CE08F]">
      <span aria-hidden="true" className="h-2 w-2 animate-vice-pulse rounded-full bg-[#5CE08F]" />
      EN VIVO
    </span>
  );
}

function LockIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 018 0v2.5" />
    </svg>
  );
}

export default function ForumPage({ params }: { params: URLSearchParams }) {
  const { data: forum, error, isPreview, unavailable, retry } = useForumData();
  // Las fichas solo se descargan si algún hilo (o el enlace) apunta a una; los marcadores y módulos son ligeros.
  const wantEntities = params.has('entity') || forum.threads.some((t) => t.entity_id !== null);
  const { data: world } = useWorldData({ entities: wantEntities ? 'all' : [], markers: true });
  const qc = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);

  const guest = isPreview;
  const canWrite = !guest && status === 'authenticated' && user !== null;
  const remote = isApiConfigured;

  const deepLink = params.has('thread') || params.has('entity') || params.has('marker');
  const [wallRequested, setWallRequested] = useState(deepLink);
  const wallOpen = wallRequested && guest && status !== 'loading';
  const openWall = () => setWallRequested(true);
  const closeWall = () => {
    setWallRequested(false);
    // El enlace profundo (?hilo= / ?entity= / ?marker=) no debe reabrir el muro al refrescar.
    if (deepLink) navigate('/foro', { replace: true });
  };

  const [cat, setCat] = useState<'all' | ForumCategoria>('all');
  const [sort, setSort] = useState<SortMode>('trend');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('thread'));
  const [mobileDetail, setMobileDetail] = useState(params.get('thread') !== null && !guest);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canModerate = useAuthStore((s) => s.isStaff());
  const [confirmDel, setConfirmDel] = useState<{ kind: 'thread' | 'post'; id: string } | null>(null);

  // Contexto (P07.3): hilos de una entidad o de un marcador (solo con sesión).
  const ctxEntity = guest ? null : params.get('entity');
  const ctxMarker = guest ? null : params.get('marker');
  const ctxLabel = ctxEntity
    ? world.entities.find((e) => e.id === ctxEntity)?.titulo
    : ctxMarker
      ? world.markers.find((m) => m.id === ctxMarker)?.titulo
      : undefined;
  const hasContext = Boolean(ctxEntity || ctxMarker);

  const names = useMemo(() => {
    const m = new Map(forum.profiles.map((p) => [p.id, p.username]));
    if (user && profile) m.set(user.id, profile.username);
    return m;
  }, [forum.profiles, user, profile]);
  const nameOf = (id: string): string => names.get(id) ?? 'Jugador';

  const replyCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of forum.posts) c.set(p.thread_id, (c.get(p.thread_id) ?? 0) + 1);
    return c;
  }, [forum.posts]);
  const repliesOf = (t: ForumThread): number => t.replies_count ?? replyCount.get(t.id) ?? 0;

  const sortShown: SortMode = guest ? 'recent' : sort;
  const threads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = forum.threads.filter(
      (t) =>
        guest ||
        ((cat === 'all' || t.categoria === cat) &&
          (!ctxEntity || t.entity_id === ctxEntity) &&
          (!ctxMarker || t.marker_id === ctxMarker) &&
          (!q || `${t.titulo} ${t.contenido}`.toLowerCase().includes(q))),
    );
    return list.sort((a, b) => {
      if (guest) return Date.parse(b.created_at) - Date.parse(a.created_at);
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return sort === 'trend'
        ? b.upvotes_count - a.upvotes_count
        : Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  }, [forum.threads, guest, cat, sort, search, ctxEntity, ctxMarker]);

  const selected: ForumThread | null = guest
    ? null
    : (forum.threads.find((t) => t.id === selectedId) ?? threads[0] ?? null);
  const posts = selected ? forum.posts.filter((p) => p.thread_id === selected.id) : [];
  // Enlazado cruzado (chips): el destino solo se muestra si existe.
  const selectedEntity = selected?.entity_id ? world.entities.find((e) => e.id === selected.entity_id) : undefined;
  const selectedEntityModule = selectedEntity ? world.modules.find((m) => m.id === selectedEntity.module_id) : undefined;
  const selectedEntityLink =
    selectedEntity && selectedEntityModule
      ? { title: selectedEntity.titulo, href: entityHref(selectedEntity, selectedEntityModule.slug) }
      : null;
  const selectedMarker = selected?.marker_id ? world.markers.find((m) => m.id === selected.marker_id) : undefined;

  // Respuestas en orden de lectura (DFS) con su profundidad.
  const flatPosts = useMemo(() => {
    const byParent = new Map<string | null, ForumPost[]>();
    for (const p of posts) {
      const arr = byParent.get(p.parent_post_id) ?? [];
      arr.push(p);
      byParent.set(p.parent_post_id, arr);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const out: Array<{ post: ForumPost; depth: number }> = [];
    const walk = (parent: string | null, depth: number) => {
      for (const p of byParent.get(parent) ?? []) {
        out.push({ post: p, depth });
        walk(p.id, Math.min(depth + 1, 3));
      }
    };
    walk(null, 0);
    return out;
  }, [posts]);

  // ---- Votos --------------------------------------------------------------------------
  const votesKey = ['votes', user?.id ?? 'anon', remote];
  const votesQ = useQuery({
    queryKey: votesKey,
    enabled: canWrite && remote,
    initialData: [] as string[],
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<string[]> => {
      const { votes } = await apiFetch<{ votes: Array<{ target_type: string; target_id: string }> }>('/api/forum/votes');
      return votes.map((v) => `${v.target_type}:${v.target_id}`);
    },
  });
  const myVotes = new Set(votesQ.data);

  const patchForum = (fn: (d: ForumData) => ForumData) =>
    qc.setQueryData<ForumData>(['forum'], (d) => (d ? fn(d) : d));

  // Gestión de hilos (cuentas con permisos elevados): el servidor decide; la UI solo oculta los botones.
  const moderate = async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage(okMsg);
      void qc.invalidateQueries({ queryKey: ['forum'] });
    } catch (err) {
      setMessage('No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  };
  const togglePin = (t: ForumThread) =>
    moderate(async () => {
      await apiFetch(`/api/forum/threads/${t.id}/pin`, { method: 'PATCH', json: { is_pinned: !t.is_pinned } });
      patchForum((f) => ({ ...f, threads: f.threads.map((x) => (x.id === t.id ? { ...x, is_pinned: !t.is_pinned } : x)) }));
    }, t.is_pinned ? 'Hilo desfijado.' : 'Hilo fijado.');
  const confirmDelete = async () => {
    const target = confirmDel;
    if (!target) return;
    setConfirmDel(null);
    if (target.kind === 'thread') {
      await moderate(async () => {
        await apiFetch(`/api/forum/threads/${target.id}`, { method: 'DELETE' });
        patchForum((f) => ({
          ...f,
          threads: f.threads.filter((x) => x.id !== target.id),
          posts: f.posts.filter((x) => x.thread_id !== target.id),
        }));
        setSelectedId(null);
        setMobileDetail(false);
      }, 'Hilo borrado.');
    } else {
      await moderate(async () => {
        await apiFetch(`/api/forum/posts/${target.id}`, { method: 'DELETE' });
        patchForum((f) => ({ ...f, posts: f.posts.filter((x) => x.id !== target.id) }));
      }, 'Respuesta borrada.');
    }
  };

  /** Invitado: abre el muro y corta la acción. */
  const requireAccount = (): boolean => {
    if (canWrite) return true;
    openWall();
    return false;
  };

  const vote = async (type: 'THREAD' | 'POST', id: string) => {
    if (!requireAccount() || !user) return;
    const key = `${type}:${id}`;
    const had = myVotes.has(key);
    const delta = had ? -1 : 1;
    const apply = (d: number) => {
      patchForum((f) =>
        type === 'THREAD'
          ? { ...f, threads: f.threads.map((t) => (t.id === id ? { ...t, upvotes_count: Math.max(0, t.upvotes_count + d) } : t)) }
          : { ...f, posts: f.posts.map((p) => (p.id === id ? { ...p, upvotes_count: Math.max(0, p.upvotes_count + d) } : p)) },
      );
      qc.setQueryData<string[]>(votesKey, (v) => {
        const s = new Set(v ?? []);
        if (d > 0) s.add(key);
        else s.delete(key);
        return [...s];
      });
    };
    apply(delta);
    if (!remote) return;
    try {
      await apiFetch('/api/forum/votes/toggle', { method: 'POST', json: { target_type: type, target_id: id } });
    } catch (err) {
      apply(-delta);
      setMessage(`No se pudo registrar el voto: ${err instanceof Error ? err.message : 'error'}`);
    }
  };

  // ---- Publicar hilo / responder -------------------------------------------------------
  const submitThread = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!requireAccount() || !user) return;
    const fd = new FormData(e.currentTarget);
    const titulo = String(fd.get('titulo') ?? '').trim();
    const contenido = String(fd.get('contenido') ?? '').trim();
    const categoria = String(fd.get('categoria')) as ForumCategoria;
    if (titulo.length < 4 || contenido.length < 4) {
      setMessage('Escribe un título y un contenido de al menos 4 caracteres.');
      return;
    }
    const base = {
      user_id: user.id,
      entity_id: ctxEntity,
      marker_id: ctxMarker,
      categoria,
      titulo,
      contenido,
      is_spoiler: fd.get('spoiler') === 'on',
    };
    setBusy(true);
    setMessage(null);
    let created: ForumThread;
    try {
      const { user_id: _uid, ...payload } = base;
      created = await apiFetch<ForumThread>('/api/forum/threads', { method: 'POST', json: payload });
    } catch (err) {
      setBusy(false);
      setMessage(`No se pudo publicar: ${err instanceof Error ? err.message : 'error'}`);
      return;
    }
    patchForum((f) => ({ ...f, threads: [created, ...f.threads] }));
    setBusy(false);
    setComposeOpen(false);
    setSelectedId(created.id);
    setMobileDetail(true);
  };

  const submitReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !requireAccount() || !user) return;
    const contenido = replyText.trim();
    if (selected.is_locked) {
      setMessage('Este hilo está cerrado y no admite más respuestas.');
      return;
    }
    if (contenido.length < 2) {
      setMessage('Escribe una respuesta.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const base = { thread_id: selected.id, user_id: user.id, parent_post_id: replyTo, contenido };
    let created: ForumPost;
    try {
      const { user_id: _uid, ...payload } = base;
      created = await apiFetch<ForumPost>('/api/forum/posts', { method: 'POST', json: payload });
    } catch (err) {
      setBusy(false);
      setMessage(`No se pudo responder: ${err instanceof Error ? err.message : 'error'}`);
      return;
    }
    patchForum((f) => ({ ...f, posts: [...f.posts, created] }));
    setReplyText('');
    setReplyTo(null);
    setBusy(false);
  };

  const spoilerHidden = selected?.is_spoiler === true && !revealed.has(selected.id);
  const replyTarget = replyTo ? posts.find((p) => p.id === replyTo) : null;
  const startCompose = () => {
    if (requireAccount()) setComposeOpen(true);
  };

  const votedThread = selected ? myVotes.has(`THREAD:${selected.id}`) : false;

  if (unavailable) {
    return (
      <div className="flex h-full min-h-0 flex-col px-3 pt-1 md:px-8">
        <h1 className="font-display text-2xl font-bold tracking-[0.04em] text-[#FFC09A] md:text-[26px]">COMUNIDAD</h1>
        <ApiErrorState title="No pudimos cargar el foro" message={error ?? ''} onRetry={retry} />
      </div>
    );
  }

  // Alto propio (viewport menos cabecera y dock): las listas conservan su scroll interno y el Footer queda debajo.
  return (
    <div className="flex h-[calc(100dvh-5rem-var(--dock-reserve))] min-h-[30rem] flex-col gap-3 px-3 pt-1 md:px-8">
      {/* Cabecera del foro: título, categorías y "+ Hilo" */}
      <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${mobileDetail && !guest ? 'max-md:hidden' : ''}`}>
        <h1 className="font-display text-2xl font-bold tracking-[0.04em] text-[#FFC09A] md:text-[26px]">COMUNIDAD</h1>
        <div role="tablist" aria-label="Categorías del foro" className="order-last flex w-full gap-2 overflow-x-auto pr-6 [scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,#000_88%,transparent)] md:order-none md:w-auto">
          {([{ value: 'all', label: 'Todos' }, ...FORUM_CATEGORIES] as const).map((c) => {
            const on = (guest ? 'all' : cat) === c.value;
            return (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => (guest ? openWall() : setCat(c.value))}
                className={`h-11 shrink-0 whitespace-nowrap rounded-full border border-vice-orange/30 px-4 text-[13px] font-bold md:px-5 md:text-sm ${FOCUS} ${
                  on ? 'bg-vice-accent text-vice-ink' : 'bg-white/[0.07] text-vice-text hover:bg-white/15'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <PalmButton onClick={startCompose} className="ml-auto h-12 rounded-full px-6 text-base max-md:hidden">
          + HILO
        </PalmButton>
      </div>

      {hasContext && (
        <p className={`glass flex flex-wrap items-center gap-2 rounded-xl px-4 py-1 text-sm ${mobileDetail && !guest ? 'max-md:hidden' : ''}`}>
          Hilos sobre: <strong>{ctxLabel ?? 'este elemento'}</strong>
          <a href="/foro" className="flex min-h-11 items-center text-vice-orange underline">
            Quitar filtro
          </a>
        </p>
      )}

      <div aria-live="polite" className="text-xs empty:hidden">
        {error && !unavailable && <p className="text-vice-gold">No se pudo actualizar desde el servidor.</p>}
        {message && (
          <p role="alert" className="text-vice-gold">
            {message}
          </p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(340px,500px)_1fr]">
        {/* P07.1 Lista de hilos */}
        <section
          aria-label="Lista de hilos"
          className={`flex min-h-0 flex-col md:overflow-hidden md:rounded-[20px] md:border md:border-vice-orange/25 md:bg-[rgba(20,14,36,0.78)] md:backdrop-blur-hud ${mobileDetail ? 'max-md:hidden' : ''}`}
        >
          <div className="flex items-center justify-between gap-3 px-1 pb-2 md:px-5 md:pb-2 md:pt-4">
            <h2 className="text-xs font-semibold tracking-[0.1em] text-vice-text/90">HILOS · {threads.length}</h2>
            {remote && <LiveBadge />}
          </div>
          <div className="flex items-center gap-2 px-1 pb-2 md:px-5">
            {guest ? (
              <button type="button" onClick={openWall} className={`${INPUT} flex min-w-0 flex-1 items-center text-left text-vice-text/60`}>
                Buscar hilos…
              </button>
            ) : (
              <>
                <label className="sr-only" htmlFor="forum-search">
                  Buscar hilos
                </label>
                <input
                  id="forum-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar hilos…"
                  className={`${INPUT} min-w-0 flex-1`}
                />
              </>
            )}
            <div role="group" aria-label="Ordenar" className="flex shrink-0 gap-1">
              {(
                [
                  ['trend', 'Tendencia'],
                  ['recent', 'Recientes'],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={sortShown === v}
                  onClick={() => (guest ? openWall() : setSort(v))}
                  className={`min-h-11 rounded-full border px-3 text-xs font-semibold ${FOCUS} ${
                    sortShown === v ? 'border-vice-orange bg-white/15' : 'border-white/15 hover:bg-white/10'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-0 pb-24 md:px-2.5 md:pb-2.5">
            {threads.length === 0 ? (
              <p className="glass rounded-xl p-4 text-vice-text/80">
                {forum.threads.length === 0
                  ? 'Aún no hay hilos. Sé la primera persona en abrir uno.'
                  : 'No hay hilos con estos filtros.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5 md:gap-1.5">
                {threads.map((t) => {
                  const active = selected?.id === t.id;
                  const voted = myVotes.has(`THREAD:${t.id}`);
                  const author = nameOf(t.user_id);
                  return (
                    <li key={t.id}>
                      <div
                        className={`flex gap-3 rounded-[18px] border p-3.5 max-md:bg-[rgba(20,14,36,0.78)] max-md:backdrop-blur-hud md:rounded-2xl ${
                          active
                            ? 'border-vice-orange/25 md:border-vice-coral/75 md:bg-vice-coral/20'
                            : 'border-vice-orange/25 md:border-vice-orange/15 md:bg-white/[0.04]'
                        }`}
                      >
                        <button
                          type="button"
                          aria-pressed={voted}
                          aria-label={`Votar hilo, ${t.upvotes_count} votos`}
                          onClick={() => void vote('THREAD', t.id)}
                          className={`flex min-h-16 w-14 shrink-0 flex-col self-start items-center justify-center gap-0.5 rounded-[14px] border text-xs font-semibold text-white md:hidden ${FOCUS} ${
                            voted ? 'border-vice-coral bg-vice-coral/35' : 'border-vice-orange/30 bg-white/[0.07]'
                          }`}
                        >
                          <span aria-hidden="true">▲</span>
                          <span>{t.upvotes_count}</span>
                          <span className="text-[10px] font-normal text-vice-text/75">votos</span>
                        </button>
                        <button
                          type="button"
                          aria-current={active ? 'true' : undefined}
                          onClick={() => {
                            if (guest) {
                              openWall();
                              return;
                            }
                            setSelectedId(t.id);
                            setMobileDetail(true);
                            setReplyTo(null);
                          }}
                          className={`min-h-11 min-w-0 flex-1 rounded-lg text-left ${FOCUS}`}
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            {t.is_pinned && <span className="text-[10px] font-bold tracking-[0.06em] text-vice-gold md:text-[11px]">FIJADO</span>}
                            <CategoryTag categoria={t.categoria} />
                            {t.is_spoiler && <SpoilerTag />}
                          </span>
                          <span className="mt-1.5 block text-sm font-medium leading-snug text-white md:mt-2 md:text-[15px]">{t.titulo}</span>
                          {t.contenido && !t.is_spoiler && (
                            <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-vice-text/70">{t.contenido}</span>
                          )}
                          <span className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-vice-text/80 md:mt-2">
                            <span className="font-semibold text-[#FFC09A] max-md:hidden">▲ {t.upvotes_count}</span>
                            <span>{repliesOf(t)} respuestas</span>
                            <span>{author}</span>
                            <span>{relativeTime(t.created_at)}</span>
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* P07.2 Hilo (con sesión) o invitación al registro (invitado) */}
        <section
          aria-label={guest ? 'Únete a la comunidad' : 'Hilo activo'}
          className={`glass min-h-0 flex-col overflow-hidden rounded-[20px] ${mobileDetail ? 'flex' : 'hidden md:flex'}`}
        >
          {guest ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-vice-accent text-vice-ink">
                <LockIcon size={30} />
              </span>
              <h2 className="max-w-md font-display text-2xl font-bold leading-tight md:text-3xl">Entra a la conversación</h2>
              <p className="max-w-sm text-sm leading-relaxed text-vice-text/85">
                Lee los hilos completos, responde, vota y comparte tus hallazgos con la comunidad. Crear tu cuenta es gratis.
              </p>
              <PalmButton as="a" href={LOGIN_HREF} className="min-h-12 rounded-full px-8 text-base">
                Crear cuenta gratis
              </PalmButton>
            </div>
          ) : !selected ? (
            <p className="p-6 text-vice-text/70">Selecciona un hilo.</p>
          ) : (
            <>
              <div className="px-5 pb-3 pt-4 md:px-7 md:pb-4 md:pt-5">
                <button
                  type="button"
                  onClick={() => setMobileDetail(false)}
                  className={`${BTN} -ml-2 mb-1 text-sm text-vice-orange hover:bg-white/10 md:hidden`}
                >
                  ← Volver a los hilos
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <CategoryTag categoria={selected.categoria} />
                  {selected.is_spoiler && <SpoilerTag />}
                </div>
                <h2 className="mt-2.5 font-display text-2xl font-bold leading-tight md:text-[28px]">{selected.titulo}</h2>
                <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-[13px] text-vice-text/85">
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold text-vice-ink"
                    style={{ background: avatarOf(nameOf(selected.user_id)) }}
                  >
                    {nameOf(selected.user_id).charAt(0).toUpperCase()}
                  </span>
                  <span className="font-medium text-white">{nameOf(selected.user_id)}</span>
                  <span>· {relativeTime(selected.created_at)}</span>
                  <button
                    type="button"
                    aria-pressed={votedThread}
                    aria-label={`Votar hilo, ${selected.upvotes_count} votos`}
                    onClick={() => void vote('THREAD', selected.id)}
                    className={`ml-auto min-h-11 rounded-full border px-4 text-sm font-semibold text-white ${FOCUS} ${
                      votedThread ? 'border-vice-coral bg-vice-coral/35' : 'border-vice-orange/30 bg-white/[0.07]'
                    }`}
                  >
                    ▲ {selected.upvotes_count}
                  </button>
                </div>
                {canModerate && remote && (
                  <div role="group" aria-label="Gestión del hilo" className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void togglePin(selected)}
                      className={`${BTN} border border-vice-gold/50 px-4 text-sm text-vice-gold hover:bg-white/10 disabled:opacity-50 ${FOCUS}`}
                    >
                      {selected.is_pinned ? 'Desfijar' : 'Fijar'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDel({ kind: 'thread', id: selected.id })}
                      className={`${BTN} border border-vice-rose/60 px-4 text-sm text-vice-rose hover:bg-white/10 disabled:opacity-50 ${FOCUS}`}
                    >
                      Borrar hilo
                    </button>
                  </div>
                )}
                {(selectedEntityLink || selectedMarker) && (
                  <p className="mt-1 flex flex-wrap gap-2 text-xs">
                    {selectedEntityLink && (
                      <a href={selectedEntityLink.href} className={`inline-flex min-h-11 items-center rounded-full bg-white/10 px-3 font-semibold text-vice-orange ${FOCUS}`}>
                        Ficha: {selectedEntityLink.title}
                      </a>
                    )}
                    {selectedMarker && (
                      <a href={`/mapa?marker=${selectedMarker.id}`} className={`inline-flex min-h-11 items-center rounded-full bg-white/10 px-3 font-semibold text-vice-orange ${FOCUS}`}>
                        Mapa: {selectedMarker.titulo}
                      </a>
                    )}
                  </p>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 md:px-7">
                <div className="relative">
                  <p
                    aria-hidden={spoilerHidden || undefined}
                    className={`whitespace-pre-wrap text-[15px] leading-[1.65] text-vice-text ${spoilerHidden ? 'select-none blur-[9px]' : ''}`}
                  >
                    {selected.contenido}
                  </p>
                  {spoilerHidden && (
                    <button
                      type="button"
                      onClick={() => setRevealed((s) => new Set(s).add(selected.id))}
                      className={`absolute left-1/2 top-1/2 min-h-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-vice-orange/50 bg-[rgba(20,14,36,0.92)] px-5 text-sm font-semibold text-white ${FOCUS}`}
                    >
                      Mostrar spoiler
                    </button>
                  )}
                </div>

                <h3 className="mb-1 mt-6 text-xs font-semibold tracking-[0.1em] text-vice-text/90">RESPUESTAS · {posts.length}</h3>
                {posts.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-vice-orange/30 p-4 text-sm text-vice-text/80">Todavía nadie ha respondido. ¡Sé la primera persona en hacerlo!</p>
                ) : (
                  <ul>
                    {flatPosts.map(({ post: p, depth }) => {
                      const name = nameOf(p.user_id);
                      const pv = myVotes.has(`POST:${p.id}`);
                      return (
                        <li key={p.id} className="mt-3.5 flex gap-3" style={{ marginLeft: `${depth * 1.75}rem` }}>
                          <span
                            aria-hidden="true"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-vice-ink"
                            style={{ background: avatarOf(name) }}
                          >
                            {name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] text-vice-text/80">
                              <span className="font-semibold text-white">{name}</span> · {relativeTime(p.created_at)}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-vice-text">{p.contenido}</p>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-pressed={pv}
                                aria-label={`Votar respuesta, ${p.upvotes_count} votos`}
                                onClick={() => void vote('POST', p.id)}
                                className={`${BTN} px-2 text-[13px] ${pv ? 'text-[#FFC09A]' : 'text-vice-text/85'}`}
                              >
                                ▲ {p.upvotes_count}
                              </button>
                              <button
                                type="button"
                                onClick={() => setReplyTo(p.id)}
                                className={`${BTN} px-3 text-[13px] text-vice-text/85 hover:bg-white/10`}
                              >
                                Responder
                              </button>
                              {canModerate && remote && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirmDel({ kind: 'post', id: p.id })}
                                  className={`${BTN} px-3 text-[13px] text-vice-rose hover:bg-white/10 disabled:opacity-50`}
                                >
                                  Borrar post
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <form
                onSubmit={(e) => void submitReply(e)}
                className="flex flex-wrap items-end gap-3 border-t border-vice-orange/25 px-5 pb-4 pt-3.5 md:flex-nowrap md:px-7"
              >
                <div className="min-w-0 flex-1 basis-full md:basis-0">
                  <label htmlFor="reply" className="mb-1 flex items-center text-xs text-vice-text/80">
                    {selected.is_locked ? 'Hilo cerrado: no admite más respuestas' : replyTarget ? `Respondiendo a ${nameOf(replyTarget.user_id)}` : 'Tu respuesta'}
                    {replyTarget && (
                      <button type="button" onClick={() => setReplyTo(null)} className="ml-2 min-h-11 text-vice-orange underline">
                        Cancelar
                      </button>
                    )}
                  </label>
                  <textarea
                    id="reply"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    disabled={selected.is_locked === true}
                    rows={2}
                    placeholder="Escribe tu respuesta…"
                    className="w-full resize-none rounded-2xl border border-vice-orange/30 bg-white/[0.07] px-4 py-3 text-sm text-white placeholder:text-vice-text/60 focus-visible:outline-2 focus-visible:outline-vice-gold"
                  />
                </div>
                <PalmButton type="submit" loading={busy} className="h-[52px] rounded-full px-6 text-[15px] max-md:w-full">
                  Publicar respuesta
                </PalmButton>
                <a
                  href={DISCORD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`glass flex h-[52px] items-center gap-2 whitespace-nowrap rounded-full px-4 max-md:hidden text-[13px] font-semibold tracking-[0.04em] text-white hover:brightness-110 ${FOCUS}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="2.5" y="5" width="19" height="13" rx="5" />
                    <circle cx="9" cy="11.5" r="1.3" fill="currentColor" />
                    <circle cx="15" cy="11.5" r="1.3" fill="currentColor" />
                  </svg>
                  DISCORD OFICIAL
                </a>
              </form>
            </>
          )}
        </section>
      </div>

      {/* Botón flotante móvil */}
      {!mobileDetail && (
        <button
          type="button"
          aria-label="Nuevo hilo"
          onClick={startCompose}
          className="fixed bottom-[calc(96px+var(--safe-bottom))] right-[calc(1.25rem+var(--safe-right))] z-30 flex h-14 w-14 items-center justify-center rounded-full border border-white/30 bg-vice-accent text-vice-ink shadow-hud focus-visible:outline-2 focus-visible:outline-vice-gold md:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.6">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      <Modal
        open={confirmDel !== null}
        onClose={() => setConfirmDel(null)}
        title={confirmDel?.kind === 'thread' ? 'Borrar hilo' : 'Borrar respuesta'}
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setConfirmDel(null)} className={`${BTN} flex-1 bg-white/10 hover:bg-white/20`}>
              Cancelar
            </button>
            <button type="button" onClick={() => void confirmDelete()} className={`${BTN} flex-1 bg-vice-rose font-bold text-vice-ink`}>
              Borrar
            </button>
          </div>
        }
      >
        <p className="text-sm">
          {confirmDel?.kind === 'thread'
            ? 'Se borrará el hilo con todas sus respuestas y votos. Esta acción no se puede deshacer.'
            : 'Se borrará esta respuesta y sus votos. Esta acción no se puede deshacer.'}
        </p>
      </Modal>

      <BottomSheet open={composeOpen} onClose={() => setComposeOpen(false)} title="Nuevo hilo">
        <form onSubmit={(e) => void submitThread(e)} className="flex flex-col gap-3 pt-2">
          {hasContext && <p className="text-xs text-vice-orange">Vinculado a: {ctxLabel ?? 'elemento seleccionado'}</p>}
          <div>
            <label htmlFor="nt-cat" className="mb-1 block text-sm font-medium">
              Categoría
            </label>
            <select id="nt-cat" name="categoria" defaultValue="General" className={`${INPUT} bg-[#2e1a47]`}>
              {FORUM_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nt-title" className="mb-1 block text-sm font-medium">
              Título
            </label>
            <input id="nt-title" name="titulo" required maxLength={140} placeholder="Resume tu tema en una frase" className={INPUT} />
          </div>
          <div>
            <label htmlFor="nt-body" className="mb-1 block text-sm font-medium">
              Contenido
            </label>
            <textarea id="nt-body" name="contenido" required rows={5} placeholder="Cuenta los detalles para que otras personas puedan ayudarte" className={`${INPUT} py-2`} />
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="spoiler" className="h-5 w-5 accent-[#E1307E]" />
            Contiene spoilers
          </label>
          <PalmButton type="submit" loading={busy} fullWidth className="min-h-11 rounded-xl">
            {busy ? 'Publicando…' : 'Publicar hilo'}
          </PalmButton>
        </form>
      </BottomSheet>

      {/* Muro de registro (invitados): Modal (BottomSheet en móvil) */}
      <Modal
        open={wallOpen}
        onClose={closeWall}
        title={WALL_TITLE}
        footer={
          <>
            <PalmButton as="a" href={LOGIN_HREF} fullWidth className="min-h-12 rounded-full px-6 text-base">
              Crear cuenta gratis
            </PalmButton>
            <button type="button" onClick={closeWall} className={`${BTN} text-sm text-vice-text/85 hover:bg-white/10`}>
              Ahora no
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-vice-text/90">
          Los hilos, las respuestas y los votos son para cuentas registradas. Es gratis y solo te lleva un minuto.
        </p>
      </Modal>
    </div>
  );
}
