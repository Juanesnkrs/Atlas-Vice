// /noticias y /noticias/:slug - Noticias OFICIALES de Rockstar Games / Take-Two (pilar 3).
// Solo se muestra lo que devuelve la API de noticias oficiales; nunca se inventa contenido ni se
// enlazan terceros. Cada noticia enlaza a su fuente oficial original.
import { useEffect, useMemo, useState } from 'react';
import { AdSlot } from '../components/ui/AdSlot';
import { ApiErrorState } from '../components/ui/ApiErrorState';
import { NEWS_SOURCES, useOfficialNews, useOfficialNewsItem, type NewsSource, type OfficialNews } from '../data/seed';
import { navigate, useLocation, usePageMeta } from '../store/useRouteStore';

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(NEWS_SOURCES.map((s) => [s.value, s.label]));
const fmt = (iso: string): string => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 3)}...` : t);

const NEWSWIRE_URL = 'https://www.rockstargames.com/newswire';
const EXTERNAL = 'noopener noreferrer';
const DISCLAIMER =
  'Contenido oficial de Rockstar Games y Take-Two Interactive, mostrado con enlace a la fuente original. LeonidApp no está afiliada a Rockstar Games ni a Take-Two.';

/** Enlace permanente al canal oficial de Rockstar: siempre visible, haya o no noticias. */
function NewswireCard({ empty }: { empty: boolean }) {
  return (
    <aside
      aria-label="Rockstar Newswire"
      className="glass mt-6 flex flex-col gap-3 rounded-[22px] p-5 md:flex-row md:items-center md:justify-between"
    >
      <div>
        <h2 className="font-display text-xl font-bold">Más noticias en Rockstar Newswire</h2>
        <p className="mt-1 max-w-xl text-sm text-vice-text/85">
          {empty
            ? 'Todavía no hay noticias recibidas por LeonidApp. Rockstar publica todas sus novedades oficiales en su Newswire.'
            : 'Todas las novedades oficiales de Rockstar Games, en su propio sitio.'}
        </p>
      </div>
      <a
        href={NEWSWIRE_URL}
        target="_blank"
        rel={EXTERNAL}
        className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-vice-accent px-6 font-bold text-vice-ink focus-visible:outline-2 focus-visible:outline-vice-gold"
      >
        Abrir Rockstar Newswire
      </a>
    </aside>
  );
}

function SourceMeta({ source, publishedAt }: { source: string; publishedAt: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-white/15 px-3 py-0.5 font-semibold text-vice-text">{SOURCE_LABEL[source] ?? source}</span>
      <time dateTime={publishedAt} className="text-vice-orange">
        {fmt(publishedAt)}
      </time>
    </p>
  );
}

function NewsList() {
  const [source, setSource] = useState<NewsSource | 'all'>('all');
  const { news: all, loading, error, retry } = useOfficialNews('all', 24);
  // Solo se ofrecen filtros por las fuentes que realmente tienen noticias.
  const sources = useMemo(
    () => NEWS_SOURCES.filter((f) => f.value !== 'all' && all.some((n) => n.source === f.value)),
    [all],
  );
  const activeSource = sources.some((f) => f.value === source) ? source : 'all';
  const news = activeSource === 'all' ? all : all.filter((n) => n.source === activeSource);
  const filters = [{ value: 'all' as const, label: 'Todas' }, ...sources];

  // Redirección heredada: /noticias?item=<slug> -> /noticias/<slug>.
  const { params } = useLocation();
  const item = params.get('item');
  useEffect(() => {
    if (item) navigate(`/noticias/${encodeURIComponent(item)}`, { replace: true });
  }, [item]);
  usePageMeta({
    title: 'Noticias oficiales',
    description: 'Noticias oficiales de Rockstar Games y Take-Two Interactive, con enlace a la fuente original.',
    canonicalPath: '/noticias',
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold tracking-[0.02em] text-[#FFC09A] md:text-4xl">Noticias oficiales</h1>
      <p className="mt-1 max-w-2xl text-sm text-vice-text/85">
        Lo último publicado por Rockstar Games y Take-Two Interactive, con enlace a la fuente original.
      </p>

      {sources.length > 1 && (
        <div role="group" aria-label="Filtrar por fuente oficial" className="mt-4 flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={activeSource === f.value}
              onClick={() => setSource(f.value)}
              className={`min-h-11 rounded-full border border-vice-orange/30 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                activeSource === f.value ? 'bg-vice-accent text-vice-ink' : 'bg-white/[0.07] hover:bg-white/15'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Alto mínimo común a carga / vacío / error: el pie no salta al llegar la respuesta (CLS = 0). */}
      <div aria-live="polite" className="mt-4 min-h-[70dvh]">
        {loading ? (
          <p role="status" className="text-sm">
            Cargando noticias oficiales…
          </p>
        ) : error && all.length === 0 ? (
          <ApiErrorState compact title="No pudimos cargar las noticias" message={error} onRetry={retry} />
        ) : news.length === 0 ? (
          <p className="glass rounded-2xl p-5 text-sm text-vice-text/85">Aún no hay noticias oficiales guardadas en LeonidApp.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {news.map((n) => (
              <li key={n.id} className="glass flex flex-col rounded-[22px] p-5">
                <SourceMeta source={n.source} publishedAt={n.publishedAt} />
                <h2 className="mt-2 font-display text-lg font-bold leading-snug">
                  <a
                    href={`/noticias/${encodeURIComponent(n.slug)}`}
                    className="hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold"
                  >
                    {n.title}
                  </a>
                </h2>
                {n.summary && <p className="mt-1 line-clamp-3 text-sm text-vice-text/85">{n.summary}</p>}
                <a
                  href={n.sourceUrl}
                  target="_blank"
                  rel={EXTERNAL}
                  className="mt-auto inline-flex min-h-11 items-center pt-2 text-sm font-semibold text-vice-orange underline"
                >
                  Leer en la fuente oficial
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewswireCard empty={!loading && !error && news.length === 0} />
      <AdSlot position="after-content" className="mt-8" />
      <p className="mt-4 text-xs text-vice-text/60">{DISCLAIMER}</p>
    </div>
  );
}

function NewsDetail({ slug }: { slug: string }) {
  const { item, loading, error, notFound, retry } = useOfficialNewsItem(slug);
  usePageMeta(
    item
      ? {
          title: item.title,
          description: clip(item.summary || `Noticia oficial de ${SOURCE_LABEL[item.source] ?? item.source}.`, 160),
          canonicalPath: `/noticias/${slug}`,
        }
      : { title: loading ? 'Cargando noticia' : error && !notFound ? 'No pudimos cargar la noticia' : 'Noticia no encontrada', robots: 'noindex,nofollow' },
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-2 md:px-8">
      <nav aria-label="Migas de pan" className="text-xs text-vice-text/80">
        <a href="/noticias" className="inline-flex min-h-11 items-center underline">
          Noticias oficiales
        </a>
      </nav>
      {loading ? (
        <div className="min-h-[100dvh]">
          <p role="status">Cargando noticia oficial…</p>
        </div>
      ) : !item && error && !notFound ? (
        <ApiErrorState compact title="No pudimos cargar la noticia" message={error} onRetry={retry} />
      ) : !item ? (
        <p role="status" className="glass rounded-2xl p-6">
          No encontramos esta noticia oficial.{' '}
          <a href="/noticias" className="font-semibold text-vice-orange underline">
            Ver todas
          </a>
        </p>
      ) : (
        <ArticleBody item={item} />
      )}
    </div>
  );
}

function ArticleBody({ item }: { item: OfficialNews }) {
  return (
    <article>
      <SourceMeta source={item.source} publishedAt={item.publishedAt} />
      <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-[#FFC09A] md:text-4xl">{item.title}</h1>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mt-4 aspect-video w-full rounded-[22px] object-cover"
        />
      )}
      {item.summary && <p className="mt-4 text-lg text-vice-text/90">{item.summary}</p>}
      <a
        href={item.sourceUrl}
        target="_blank"
        rel={EXTERNAL}
        className="mt-5 inline-flex min-h-11 items-center rounded-full bg-vice-accent px-6 font-bold text-vice-ink focus-visible:outline-2 focus-visible:outline-vice-gold"
      >
        Leer en la fuente oficial
      </a>
      <NewswireCard empty={false} />
      <AdSlot position="after-content" className="mt-8" />
      <p className="mt-4 text-xs text-vice-text/60">{DISCLAIMER}</p>
    </article>
  );
}

export default function NewsPage({ slug }: { slug?: string }) {
  return slug ? <NewsDetail slug={slug} /> : <NewsList />;
}
