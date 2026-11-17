// P07 - Foro y Comunidad: tablón (P07.1), hilo con respuestas anidadas (P07.2),
// votos, tag spoiler y enlace a Discord. Lectura pública / escritura autenticada.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/ui/BottomSheet';
import {
  DISCORD_URL,
  FORUM_CATEGORIES,
  SAMPLE_NOTICE,
  forumCategoryLabel,
  useForumData,
  useWorldData,
  type ForumData,
} from '../data/seed';
import { supabase, useAuthStore } from '../store/useAuthStore';
import type { ForumCategoria, ForumPost, ForumThread } from '../types/database';

type SortMode = 'trend' | 'recent';
const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
const BTN =
  'flex min-h-11 items-center justify-center rounded-xl px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold';

const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });

export default function ForumPage({ params }: { params: URLSearchParams }) {
  const { data: forum, loading, error } = useForumData();
  const { data: world } = useWorldData();
  const qc = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);

  const canWrite = status === 'authenticated' && user !== null;
  const remote = supabase !== null && forum.source === 'supabase';

  const [cat, setCat] = useState<'all' | ForumCategoria>('all');
  const [sort, setSort] = useState<SortMode>('trend');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('thread'));
  const [mobileDetail, setMobileDetail] = useState(params.get('thread') !== null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Contexto (P07.3): hilos de una entidad o de un marcador.
  const ctxEntity = params.get('entity');
  const ctxMarker = params.get('marker');
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

  const threads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = forum.threads.filter(
      (t) =>
        (cat === 'all' || t.categoria === cat) &&
        (!ctxEntity || t.entity_id === ctxEntity) &&
        (!ctxMarker || t.marker_id === ctxMarker) &&
        (!q || `${t.titulo} ${t.contenido}`.toLowerCase().includes(q)),
    );
    return list.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return sort === 'trend'
        ? b.upvotes_count - a.upvotes_count
        : Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  }, [forum.threads, cat, sort, search, ctxEntity, ctxMarker]);

  const selected: ForumThread | null =
    forum.threads.find((t) => t.id === selectedId) ?? threads[0] ?? null;
  const posts = selected ? forum.posts.filter((p) => p.thread_id === selected.id) : [];
  const children = useMemo(() => {
    const m = new Map<string | null, ForumPost[]>();
    for (const p of posts) {
      const arr = m.get(p.parent_post_id) ?? [];
      arr.push(p);
      m.set(p.parent_post_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return m;
  }, [posts]);

  // ---- Votos --------------------------------------------------------------------------
  const votesQ = useQuery({
    queryKey: ['votes', user?.id ?? 'anon', remote],
    enabled: canWrite && remote,
    initialData: [] as string[],
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<string[]> => {
      if (!supabase || !user) return [];
      const { data, error: err } = await supabase
        .from('forum_votes')
        .select('target_type,target_id')
        .eq('user_id', user.id);
      if (err) throw new Error(err.message);
      return (data ?? []).map((v) => `${v.target_type}:${v.target_id}`);
    },
  });
  const votesKey = ['votes', user?.id ?? 'anon', remote];
  const myVotes = new Set(votesQ.data);

  const patchForum = (fn: (d: ForumData) => ForumData) =>
    qc.setQueryData<ForumData>(['forum'], (d) => (d ? fn(d) : d));

  const requireAccount = (): boolean => {
    if (canWrite) return true;
    setMessage('Necesitas una cuenta para publicar, responder o votar.');
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
    if (!remote || !supabase) return;
    const res = had
      ? await supabase.from('forum_votes').delete().eq('user_id', user.id).eq('target_type', type).eq('target_id', id)
      : await supabase.from('forum_votes').insert({ user_id: user.id, target_type: type, target_id: id });
    if (res.error) {
      apply(-delta);
      setMessage(`No se pudo registrar el voto: ${res.error.message}`);
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
    if (remote && supabase) {
      const { data, error: err } = await supabase.from('forum_threads').insert(base).select('*').single();
      if (err || !data) {
        setBusy(false);
        setMessage(`No se pudo publicar: ${err?.message ?? 'respuesta vacía'}`);
        return;
      }
      created = data;
    } else {
      created = {
        ...base,
        id: crypto.randomUUID(),
        is_pinned: false,
        upvotes_count: 0,
        created_at: new Date().toISOString(),
      };
      setMessage('Publicado solo en esta sesión: no hay conexión con Supabase (datos de ejemplo).');
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
    if (contenido.length < 2) {
      setMessage('Escribe una respuesta.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const base = { thread_id: selected.id, user_id: user.id, parent_post_id: replyTo, contenido };
    let created: ForumPost;
    if (remote && supabase) {
      const { data, error: err } = await supabase.from('forum_posts').insert(base).select('*').single();
      if (err || !data) {
        setBusy(false);
        setMessage(`No se pudo responder: ${err?.message ?? 'respuesta vacía'}`);
        return;
      }
      created = data;
    } else {
      created = { ...base, id: crypto.randomUUID(), upvotes_count: 0, created_at: new Date().toISOString() };
      setMessage('Respuesta guardada solo en esta sesión (sin Supabase).');
    }
    patchForum((f) => ({ ...f, posts: [...f.posts, created] }));
    setReplyText('');
    setReplyTo(null);
    setBusy(false);
  };

  const spoilerHidden = selected?.is_spoiler === true && !revealed.has(selected.id);

  const renderPosts = (parent: string | null, depth: number) =>
    (children.get(parent) ?? []).map((p) => (
      <li key={p.id} className={depth > 0 ? 'ml-3 border-l border-white/15 pl-3' : ''}>
        <div className="rounded-xl bg-white/5 p-3">
          <p className="text-xs text-vice-text/70">
            <span className="font-semibold text-vice-orange">{nameOf(p.user_id)}</span> · {fmtDate(p.created_at)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{p.contenido}</p>
          <div className="mt-1 flex items-center gap-1">
            <button
              type="button"
              aria-pressed={myVotes.has(`POST:${p.id}`)}
              aria-label={`Votar respuesta, ${p.upvotes_count} votos`}
              onClick={() => void vote('POST', p.id)}
              className={`${BTN} gap-1 px-3 text-sm ${myVotes.has(`POST:${p.id}`) ? 'text-vice-gold' : 'text-vice-text/80'}`}
            >
              ▲ {p.upvotes_count}
            </button>
            <button
              type="button"
              onClick={() => setReplyTo(p.id)}
              className={`${BTN} px-3 text-sm text-vice-text/80 hover:bg-white/10`}
            >
              Responder
            </button>
          </div>
        </div>
        {(children.get(p.id)?.length ?? 0) > 0 && (
          <ul className={`mt-2 flex flex-col gap-2 ${depth >= 3 ? 'ml-0' : ''}`}>{renderPosts(p.id, Math.min(depth + 1, 4))}</ul>
        )}
      </li>
    ));

  const replyTarget = replyTo ? posts.find((p) => p.id === replyTo) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-3 pt-1 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-bold tracking-wide md:text-2xl">COMUNIDAD ATLAS VICE</h1>
        <div className="flex items-center gap-2">
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${BTN} glass hidden text-sm sm:flex`}
          >
            Discord oficial
          </a>
          <button
            type="button"
            onClick={() => (canWrite ? setComposeOpen(true) : requireAccount())}
            className={`${BTN} bg-vice-accent font-bold text-vice-ink max-md:hidden`}
          >
            + Hilo
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Categorías" className="flex gap-1 overflow-x-auto">
          {([{ value: 'all', label: 'Todos' }, ...FORUM_CATEGORIES] as const).map((c) => (
            <button
              key={c.value}
              type="button"
              role="tab"
              aria-selected={cat === c.value}
              onClick={() => setCat(c.value)}
              className={`min-h-11 whitespace-nowrap rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                cat === c.value ? 'bg-vice-accent text-vice-ink' : 'glass hover:bg-white/10'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="forum-search">
          Buscar hilos
        </label>
        <input
          id="forum-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar hilos…"
          className={`${INPUT} glass max-w-[220px]`}
        />
        <div role="group" aria-label="Ordenar" className="flex gap-1">
          {(
            [
              ['trend', 'Tendencia'],
              ['recent', 'Recientes'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={sort === v}
              onClick={() => setSort(v)}
              className={`min-h-11 rounded-full border px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                sort === v ? 'border-vice-orange bg-white/15' : 'border-white/15 hover:bg-white/10'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {hasContext && (
        <p className="glass flex flex-wrap items-center gap-2 rounded-xl px-4 py-1 text-sm">
          Hilos sobre: <strong>{ctxLabel ?? 'este elemento'}</strong>
          <a href="#/foro" className="flex min-h-11 items-center text-vice-orange underline">
            Quitar filtro
          </a>
        </p>
      )}

      <div aria-live="polite" className="text-xs">
        {loading && <p>Cargando desde Supabase…</p>}
        {error && <p className="text-vice-gold">Supabase no disponible ({error}); usando el seed.</p>}
        {message && (
          <p role="alert" className="text-vice-gold">
            {message}{' '}
            {!canWrite && (
              <a href="#/entrar?next=/foro" className="inline-flex min-h-11 items-center underline">
                Iniciar sesión
              </a>
            )}
          </p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(300px,420px)_1fr]">
        {/* P07.1 Tablón */}
        <section
          aria-label="Lista de hilos"
          className={`min-h-0 overflow-y-auto pb-2 ${mobileDetail ? 'max-md:hidden' : ''}`}
        >
          {threads.length === 0 ? (
            <p className="glass rounded-xl p-4 text-vice-text/80">No hay hilos con estos filtros.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {threads.map((t) => {
                const active = selected?.id === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(t.id);
                        setMobileDetail(true);
                        setReplyTo(null);
                      }}
                      className={`glass flex min-h-[44px] w-full flex-col gap-1 rounded-xl p-3 text-left focus-visible:outline-2 focus-visible:outline-vice-gold ${
                        active ? 'border-vice-magenta ring-1 ring-vice-magenta' : 'hover:border-vice-orange'
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2 text-xs">
                        {t.is_pinned && <span className="font-bold text-vice-gold">FIJADO</span>}
                        <span className="rounded-full bg-white/10 px-2 py-0.5 font-semibold text-vice-orange">
                          {forumCategoryLabel(t.categoria)}
                        </span>
                        {t.is_spoiler && (
                          <span className="rounded-full bg-vice-magenta px-2 py-0.5 font-bold text-vice-ink">SPOILER</span>
                        )}
                      </span>
                      <span className="font-display text-base font-bold leading-snug">{t.titulo}</span>
                      <span className="text-xs text-vice-text/75">
                        ▲ {t.upvotes_count} · {replyCount.get(t.id) ?? 0} respuestas · {nameOf(t.user_id)} · {fmtDate(t.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* P07.2 Hilo */}
        <section
          aria-label="Lectura de hilo"
          className={`glass min-h-0 overflow-y-auto rounded-2xl p-4 md:p-5 ${mobileDetail ? '' : 'max-md:hidden'}`}
        >
          {!selected ? (
            <p className="text-vice-text/70">Selecciona un hilo.</p>
          ) : (
            <article>
              <button
                type="button"
                onClick={() => setMobileDetail(false)}
                className={`${BTN} -ml-2 mb-1 text-sm text-vice-orange hover:bg-white/10 md:hidden`}
              >
                ← Volver al tablón
              </button>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-white/10 px-2 py-0.5 font-semibold text-vice-orange">
                  {forumCategoryLabel(selected.categoria)}
                </span>
                {selected.is_spoiler && (
                  <span className="rounded-full bg-vice-magenta px-2 py-0.5 font-bold text-vice-ink">SPOILER</span>
                )}
              </div>
              <h2 className="mt-1 font-display text-2xl font-bold leading-tight">{selected.titulo}</h2>
              <p className="text-xs text-vice-text/70">
                {nameOf(selected.user_id)} · {fmtDate(selected.created_at)}
              </p>

              {spoilerHidden ? (
                <div className="mt-3 rounded-xl border border-vice-gold/40 p-4">
                  <p className="text-sm">Este hilo contiene spoilers.</p>
                  <button
                    type="button"
                    onClick={() => setRevealed((s) => new Set(s).add(selected.id))}
                    className={`${BTN} mt-2 bg-white/10 hover:bg-white/20`}
                  >
                    Mostrar contenido
                  </button>
                </div>
              ) : (
                <p className="mt-3 whitespace-pre-wrap">{selected.contenido}</p>
              )}

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={myVotes.has(`THREAD:${selected.id}`)}
                  aria-label={`Votar hilo, ${selected.upvotes_count} votos`}
                  onClick={() => void vote('THREAD', selected.id)}
                  className={`${BTN} glass gap-2 ${myVotes.has(`THREAD:${selected.id}`) ? 'text-vice-gold' : ''}`}
                >
                  ▲ {selected.upvotes_count}
                </button>
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className={`${BTN} glass text-sm`}>
                  Discutir en Discord
                </a>
              </div>

              <h3 className="mt-5 font-display text-lg font-bold">Respuestas ({posts.length})</h3>
              {posts.length === 0 ? (
                <p className="mt-1 text-sm text-vice-text/70">Sé la primera persona en responder.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">{renderPosts(null, 0)}</ul>
              )}

              <form onSubmit={(e) => void submitReply(e)} className="mt-4 flex flex-col gap-2">
                <label htmlFor="reply" className="text-sm font-medium">
                  {replyTarget ? `Respondiendo a ${nameOf(replyTarget.user_id)}` : 'Respuesta rápida'}
                  {replyTarget && (
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="ml-2 min-h-11 text-vice-orange underline"
                    >
                      Cancelar
                    </button>
                  )}
                </label>
                <textarea
                  id="reply"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  placeholder={canWrite ? 'Escribe tu respuesta…' : 'Inicia sesión para responder'}
                  className={`${INPUT} py-2`}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className={`${BTN} self-end bg-vice-accent font-bold text-vice-ink disabled:opacity-50`}
                >
                  {busy ? 'Enviando…' : canWrite ? 'Responder' : 'Responder (requiere cuenta)'}
                </button>
              </form>
            </article>
          )}
          <p className="mt-4 text-xs text-vice-text/60">{SAMPLE_NOTICE}</p>
        </section>
      </div>

      {/* Botón flotante móvil */}
      <button
        type="button"
        aria-label="Publicar un hilo"
        onClick={() => (canWrite ? setComposeOpen(true) : requireAccount())}
        className="fixed bottom-[calc(84px+var(--safe-bottom))] right-[calc(1rem+var(--safe-right))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-vice-accent text-3xl font-bold text-vice-ink shadow-hud focus-visible:outline-2 focus-visible:outline-vice-gold md:hidden"
      >
        +
      </button>

      <BottomSheet open={composeOpen} onClose={() => setComposeOpen(false)} title="Nuevo hilo">
        <form onSubmit={(e) => void submitThread(e)} className="flex flex-col gap-3 pt-2">
          {hasContext && (
            <p className="text-xs text-vice-orange">Vinculado a: {ctxLabel ?? 'elemento seleccionado'}</p>
          )}
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
            <input id="nt-title" name="titulo" required maxLength={140} className={INPUT} />
          </div>
          <div>
            <label htmlFor="nt-body" className="mb-1 block text-sm font-medium">
              Contenido
            </label>
            <textarea id="nt-body" name="contenido" required rows={5} className={`${INPUT} py-2`} />
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="spoiler" className="h-5 w-5 accent-[#E1307E]" />
            Contiene spoilers
          </label>
          <button type="submit" disabled={busy} className={`${BTN} bg-vice-accent font-bold text-vice-ink disabled:opacity-50`}>
            {busy ? 'Publicando…' : 'Publicar hilo'}
          </button>
        </form>
      </BottomSheet>
    </div>
  );
}
