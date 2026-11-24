// Portada pública `/` (DesignSpec §7.2): hero compacto, "Explora Leonida", noticias oficiales,
// guías, foro en vivo (§7.5) y franja de registro. Cabecera, dock y Footer los pone App.tsx.
import { useMemo, useRef, useState } from 'react';
import { ApiErrorState } from '../components/ui/ApiErrorState';
import { HeroCarousel } from '../components/ui/HeroCarousel';
import { Modal } from '../components/ui/Modal';
import { PalmButton } from '../components/ui/PalmButton';
import { StatBar } from '../components/ui/StatBar';
import {
  NEWS_SOURCES,
  entitySlug,
  forumCategoryLabel,
  guideSteps,
  relativeTime,
  useForumData,
  useHeroSlides,
  useModuleGate,
  useOfficialNews,
  useWorldData,
  type WorldScope,
} from '../data/seed';
import { useAuthStore } from '../store/useAuthStore';
import { useProgressStore } from '../store/useProgressStore';
import { usePageMeta } from '../store/useRouteStore';
import type { Entity, ForumThread } from '../types/database';

const HOME_SCOPE: WorldScope = { entities: ['guias'], markers: true, counts: ['armas', 'vehiculos', 'coleccionables'] };
const NEWSWIRE_URL = 'https://www.rockstargames.com/newswire';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold';
const SOURCE_LABEL: Record<string, string> = Object.fromEntries(NEWS_SOURCES.map((s) => [s.value, s.label]));
const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

interface Crop {
  /** Texto accesible de la tarjeta (el degradado es decorativo, no lleva imagen de terceros). */
  alt: string;
  /** Degradado Vice Sunset propio de la tarjeta. */
  bg: string;
}

const SUNSET_STOPS = '#2E1A47, #7B2C6F 38%, #E14B7B 70%, #F69259';
const sunset = (angle: number, glowX: number, glowY: number): string =>
  `radial-gradient(circle at ${glowX}% ${glowY}%, rgba(246,146,89,0.55), transparent 55%), linear-gradient(${angle}deg, ${SUNSET_STOPS})`;

export const CROPS: Record<'mapa' | 'armas' | 'vehiculos' | 'coleccionables' | 'guias' | 'noticias', Crop> = {
  mapa: { alt: 'Skyline de Vice City al atardecer', bg: sunset(160, 15, 15) },
  armas: { alt: 'Atardecer con diagonales rosadas', bg: sunset(200, 60, 90) },
  vehiculos: { alt: 'Horizonte costero con luces de neón', bg: sunset(135, 55, 75) },
  coleccionables: { alt: 'Cielo cálido con destellos naranjas', bg: sunset(180, 80, 40) },
  guias: { alt: 'Calle de Vice City con neón al anochecer', bg: sunset(150, 25, 35) },
  noticias: { alt: 'Cielo Vice Sunset de la portada informativa', bg: sunset(170, 50, 45) },
};

export function CropImg({ crop }: { crop: Crop }) {
  return (
    <span
      role="img"
      aria-label={crop.alt}
      className="absolute inset-0 block h-full w-full transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none"
      style={{ backgroundImage: crop.bg }}
    />
  );
}

function SectionHead({ id, title, href, label = 'Ver todo' }: { id: string; title: string; href?: string; label?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 id={id} className="font-display text-2xl font-bold md:text-3xl">
        {title}
      </h2>
      {href && (
        <a href={href} className={`inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-vice-orange underline underline-offset-4 ${FOCUS}`}>
          {label}
        </a>
      )}
    </div>
  );
}

// ---- Muro de registro (§7.5): Modal (BottomSheet en móvil) ------------------------------------
function RegisterWall({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Crea tu cuenta gratis para leer la conversación"
      footer={
        <>
          <PalmButton as="a" href="/entrar?next=/foro" fullWidth>
            Crear cuenta gratis
          </PalmButton>
          <button
            type="button"
            onClick={onClose}
            className={`flex min-h-11 w-full items-center justify-center rounded-xl text-sm text-vice-text/85 hover:bg-white/10 ${FOCUS}`}
          >
            Ahora no
          </button>
        </>
      }
    >
      <p className="text-sm text-vice-text/85">Abre hilos, vota y responde a la comunidad de Leonida.</p>
    </Modal>
  );
}

// ---- Bloques ---------------------------------------------------------------------------------
interface ExploreCard {
  href: string;
  title: string;
  count: string | null;
  crop: Crop;
}

function ExploreSection({ cards }: { cards: ExploreCard[] }) {
  return (
    <section aria-labelledby="explora-title" className="flex flex-col gap-4">
      <SectionHead id="explora-title" title="Explora Leonida" />
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {cards.map((c) => (
          <li key={c.title}>
            <a href={c.href} className={`group glass flex h-full min-h-11 flex-col overflow-hidden rounded-2xl hover:border-vice-orange ${FOCUS}`}>
              <span className="relative block aspect-[4/3] w-full overflow-hidden bg-vice-night">
                <CropImg crop={c.crop} />
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[rgba(20,14,36,0.85)] to-transparent" />
              </span>
              <span className="flex flex-col px-3 pb-3 pt-2">
                <span className="font-display text-lg font-bold leading-tight">{c.title}</span>
                {c.count && <span className="text-xs font-semibold text-vice-orange">{c.count}</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewsSection({
  news,
  loading,
  error,
  onRetry,
}: {
  news: ReturnType<typeof useOfficialNews>['news'];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const shown = news.slice(0, 6);
  return (
    <section aria-labelledby="noticias-title" className="flex flex-col gap-4">
      <SectionHead id="noticias-title" title="Noticias oficiales" href="/noticias" label="Ver todas" />
      <div aria-live="polite">
        {loading ? (
          <p role="status" className="text-sm text-vice-text/80">
            Cargando noticias oficiales…
          </p>
        ) : error && shown.length === 0 ? (
          <ApiErrorState compact title="No pudimos cargar las noticias" message={error} onRetry={onRetry} />
        ) : shown.length === 0 ? (
          <div className="glass rounded-2xl p-5">
            <p className="font-semibold">Aún no hay noticias oficiales aquí.</p>
            <p className="mt-1 text-sm text-vice-text/85">Mientras tanto, lee la fuente original.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((n) => (
              <li key={n.id} className="glass flex flex-col rounded-2xl p-4">
                <p className="text-xs text-vice-orange">
                  {SOURCE_LABEL[n.source] ?? n.source} · {fmtDate(n.publishedAt)}
                </p>
                <h3 className="mt-1 font-display text-lg font-bold leading-snug">
                  <a href={`/noticias/${encodeURIComponent(n.slug)}`} className={`hover:underline ${FOCUS}`}>
                    {n.title}
                  </a>
                </h3>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!loading && shown.length < 6 && (
        <a
          href={NEWSWIRE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`glass inline-flex min-h-11 items-center justify-between gap-3 self-start rounded-2xl px-5 text-sm font-semibold text-vice-orange hover:border-vice-orange ${FOCUS}`}
        >
          Más en Rockstar Newswire
          <span aria-hidden="true">↗</span>
        </a>
      )}
    </section>
  );
}

function GuideCard({ guide }: { guide: Entity }) {
  const steps = guideSteps(guide);
  const stored = useProgressStore((s) => s.guideSteps[guide.id]);
  const completed = useProgressStore((s) => s.items[`entity:${guide.id}`]?.completado === true);
  const count = completed && stored === undefined ? steps.length : (stored?.length ?? 0);
  return (
    <li className="glass flex flex-col rounded-2xl p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{guide.categoria}</p>
      <h3 className="font-display text-lg font-bold leading-snug">
        <a href={`/guias/${entitySlug(guide)}`} className={`hover:underline ${FOCUS}`}>
          {guide.titulo}
        </a>
      </h3>
      {steps.length > 0 && (
        <StatBar className="mt-3" label="Tu avance" value={(count / steps.length) * 100} valueLabel={`${count}/${steps.length}`} accent="gold" />
      )}
    </li>
  );
}

function GuidesSection({ guides }: { guides: Entity[] }) {
  return (
    <section aria-labelledby="guias-title" className="flex flex-col gap-4">
      <SectionHead id="guias-title" title="Guías" href="/guias" label="Ver todas" />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {guides.slice(0, 6).map((g) => (
          <GuideCard key={g.id} guide={g} />
        ))}
      </ul>
    </section>
  );
}

function ForumCard({
  thread,
  author,
  replies,
  onGuest,
  authenticated,
}: {
  thread: ForumThread;
  author: string;
  replies: number;
  onGuest: () => void;
  authenticated: boolean;
}) {
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-vice-orange">{forumCategoryLabel(thread.categoria)}</span>
        {thread.is_pinned && <span className="rounded-full bg-white/10 px-2 py-0.5">Fijado</span>}
        {thread.is_spoiler && <span className="rounded-full bg-vice-magenta/30 px-2 py-0.5">Spoiler</span>}
      </span>
      <span className="mt-1 block font-display text-lg font-bold leading-snug">{thread.titulo}</span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-vice-text/80">
        <span>▲ {thread.upvotes_count}</span>
        <span>{replies} {replies === 1 ? 'respuesta' : 'respuestas'}</span>
        <span>{author}</span>
        <span>{relativeTime(thread.created_at)}</span>
      </span>
    </>
  );
  const cls = `glass block w-full min-h-11 rounded-2xl p-4 text-left hover:border-vice-orange ${FOCUS}`;
  return (
    <li>
      {authenticated ? (
        <a href={`/foro?hilo=${thread.id}`} className={cls}>
          {body}
        </a>
      ) : (
        <button type="button" onClick={onGuest} className={cls}>
          {body}
        </button>
      )}
    </li>
  );
}

function ForumSection({ authenticated, onRetryAll }: { authenticated: boolean; onRetryAll: () => void }) {
  const { data, unavailable, error } = useForumData();
  const [wall, setWall] = useState(false);
  const closeWall = useRef(() => setWall(false)).current;
  const names = useMemo(() => new Map(data.profiles.map((p) => [p.id, p.username])), [data.profiles]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.posts) m.set(p.thread_id, (m.get(p.thread_id) ?? 0) + 1);
    return m;
  }, [data.posts]);
  const threads = useMemo(
    () => [...data.threads].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
    [data.threads],
  );
  return (
    <section aria-labelledby="foro-title" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <h2 id="foro-title" className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold md:text-3xl">
          Foro en vivo
          <span className="rounded-full bg-white/10 px-3 py-1 font-body text-xs font-bold tracking-widest text-[#8CF0B5]">
            <span aria-hidden="true">● </span>EN VIVO
          </span>
        </h2>
        <a href="/foro" className={`inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-vice-orange underline underline-offset-4 ${FOCUS}`}>
          Ir al foro
        </a>
      </div>
      {unavailable ? (
        <ApiErrorState compact title="No pudimos cargar el foro" message={error ?? ''} onRetry={onRetryAll} />
      ) : threads.length === 0 ? (
        <p className="glass rounded-2xl p-5 text-sm">Aún no hay hilos. Sé la primera persona en abrir uno.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {threads.map((t) => (
            <ForumCard
              key={t.id}
              thread={t}
              author={names.get(t.user_id) ?? 'Usuario'}
              replies={t.replies_count ?? counts.get(t.id) ?? 0}
              authenticated={authenticated}
              onGuest={() => setWall(true)}
            />
          ))}
        </ul>
      )}
      <RegisterWall open={wall} onClose={closeWall} />
    </section>
  );
}

export default function HomePage() {
  usePageMeta({
    title: 'Mapa, catálogo y guías de Leonida',
    description:
      'LeonidApp reúne el mapa interactivo de Leonida, el catálogo de armas, vehículos y coleccionables, guías y noticias oficiales.',
    canonicalPath: '/',
  });
  const authenticated = useAuthStore((s) => s.status === 'authenticated');
  // Solo lo necesario: totales por módulo (consulta de 1 elemento), marcadores y las guías del módulo `guias`.
  const { data: world, unavailable: worldDown, error: worldError, retry: retryWorld } = useWorldData(HOME_SCOPE);
  const { isActive, catalogActive } = useModuleGate();
  const { retry: retryForum } = useForumData();
  const heroSlides = useHeroSlides();
  const { news, loading: newsLoading, error: newsError, retry: retryNews } = useOfficialNews('all', 50);

  const retryAll = (): void => {
    retryWorld();
    retryNews();
    retryForum();
  };
  const countOf = (slug: string): number => world.counts[slug] ?? 0;
  // Una categoría sin fichas no se enlaza desde la portada (S1.2); sin datos del servidor no se oculta nada.
  const hasFichas = (slug: string): boolean => worldDown || world.modules.length === 0 || countOf(slug) > 0;
  const guides = world.entities;
  const plural = (n: number, one: string, many: string): string => (worldDown || world.modules.length === 0 ? '' : `${n} ${n === 1 ? one : many}`);

  const candidates: Array<ExploreCard | false> = [
    isActive('mapa') && { href: '/mapa', title: 'Mapa interactivo', count: plural(world.markers.length, 'lugar', 'lugares') || null, crop: CROPS.mapa },
    catalogActive && isActive('armas') && hasFichas('armas') && { href: '/catalogo/armas', title: 'Armas', count: plural(countOf('armas'), 'ficha', 'fichas') || null, crop: CROPS.armas },
    catalogActive && isActive('vehiculos') && hasFichas('vehiculos') && { href: '/catalogo/vehiculos', title: 'Vehículos', count: plural(countOf('vehiculos'), 'ficha', 'fichas') || null, crop: CROPS.vehiculos },
    catalogActive && isActive('coleccionables') && hasFichas('coleccionables') && { href: '/catalogo/coleccionables', title: 'Coleccionables', count: plural(countOf('coleccionables'), 'ficha', 'fichas') || null, crop: CROPS.coleccionables },
    isActive('guias') && { href: '/guias', title: 'Guías', count: plural(guides.length, 'guía', 'guías') || null, crop: CROPS.guias },
    { href: '/noticias', title: 'Noticias oficiales', count: newsLoading || newsError ? null : plural(news.length, 'noticia', 'noticias'), crop: CROPS.noticias },
  ];
  const cards = candidates.filter((c): c is ExploreCard => c !== false);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pb-10 pt-2 md:gap-12 md:px-8">
      <HeroCarousel slides={heroSlides} guest={!authenticated} />
      <ExploreSection cards={cards} />
      {worldDown && <ApiErrorState compact title="No pudimos cargar el catálogo" message={worldError ?? ''} onRetry={retryAll} />}
      <NewsSection news={news} loading={newsLoading} error={newsError} onRetry={retryAll} />
      {isActive('guias') && guides.length > 0 && <GuidesSection guides={guides} />}
      {isActive('foro') && <ForumSection authenticated={authenticated} onRetryAll={retryAll} />}
      {!authenticated && (
        <section aria-labelledby="registro-title" className="glass flex flex-col items-start gap-4 rounded-3xl p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <h2 id="registro-title" className="font-display text-2xl font-bold">
              Guarda tu avance en todos tus dispositivos
            </h2>
            <p className="mt-1 text-sm text-vice-text/85">Gratis y sin contraseñas.</p>
          </div>
          <PalmButton as="a" href="/entrar">
            Crear cuenta gratis
          </PalmButton>
        </section>
      )}
    </div>
  );
}
