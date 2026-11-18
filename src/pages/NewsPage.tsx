// /noticias y /noticias/:slug - Noticias OFICIALES de Rockstar Games / Take-Two (pilar 3).
// Solo se muestra lo que devuelve la API de noticias oficiales; nunca se inventa contenido ni se
// enlazan terceros. Cada noticia enlaza a su fuente oficial original.
import { useEffect, useState } from 'react';
import { AdSlot } from '../components/ui/AdSlot';
import { NEWS_SOURCES, useOfficialNews, useOfficialNewsItem, type NewsSource, type OfficialNews } from '../data/seed';
import { navigate, useLocation, usePageMeta } from '../store/useRouteStore';

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(NEWS_SOURCES.map((s) => [s.value, s.label]));
const fmt = (iso: string): string => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 3)}...` : t);

const DISCLAIMER =
  'Contenido oficial de Rockstar Games y Take-Two Interactive, mostrado con enlace a la fuente original. LeonidApp no está afiliada a Rockstar Games ni a Take-Two.';

function NewsList() {
  const [source, setSource] = useState<NewsSource | 'all'>('all');
  const { news, loading, error } = useOfficialNews(source, 24);
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
      <h1 className="font-display text-3xl font-bold">Noticias oficiales</h1>
      <p className="mt-1 text-sm text-vice-text/80">{DISCLAIMER}</p>

      <div role="group" aria-label="Filtrar por fuente oficial" className="mt-4 flex flex-wrap gap-2">
        {NEWS_SOURCES.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={source === f.value}
            onClick={() => setSource(f.value)}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
              source === f.value ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="mt-4">
        {loading ? (
          <p role="status" className="text-sm">
            Cargando noticias oficiales…
          </p>
        ) : error ? (
          <p role="status" className="text-sm text-vice-gold">
            No se pudieron cargar las noticias oficiales ({error}).
          </p>
        ) : news.length === 0 ? (
          <p className="text-sm text-vice-text/70">Aún no hay noticias oficiales para esta fuente.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {news.map((n) => (
              <li key={n.id} className="glass flex flex-col rounded-2xl p-4">
                <p className="text-xs text-vice-orange">
                  {SOURCE_LABEL[n.source] ?? n.source} · {fmt(n.publishedAt)}
                </p>
                <h2 className="mt-1 font-display text-lg font-bold">
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
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex min-h-11 items-center pt-2 text-sm font-semibold text-vice-orange underline"
                >
                  Leer en la fuente original
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AdSlot position="after-content" className="mt-8" />
    </div>
  );
}

function NewsDetail({ slug }: { slug: string }) {
  const { item, loading, error } = useOfficialNewsItem(slug);
  usePageMeta(
    item
      ? {
          title: item.title,
          description: clip(item.summary || `Noticia oficial de ${SOURCE_LABEL[item.source] ?? item.source}.`, 160),
          canonicalPath: `/noticias/${slug}`,
        }
      : { title: loading ? 'Cargando noticia' : 'Noticia no encontrada', robots: 'noindex,nofollow' },
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-2 md:px-8">
      <nav aria-label="Migas de pan" className="text-xs text-vice-text/80">
        <a href="/noticias" className="inline-flex min-h-11 items-center underline">
          Noticias oficiales
        </a>
      </nav>
      {loading ? (
        <p role="status">Cargando noticia oficial…</p>
      ) : !item ? (
        <p role="status" className="glass rounded-2xl p-6">
          No encontramos esta noticia oficial{error ? ` (${error})` : ''}.{' '}
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
      <p className="text-xs text-vice-orange">
        {SOURCE_LABEL[item.source] ?? item.source} · {fmt(item.publishedAt)}
      </p>
      <h1 className="mt-1 font-display text-3xl font-bold leading-tight">{item.title}</h1>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mt-4 aspect-video w-full rounded-2xl object-cover"
        />
      )}
      {item.summary && <p className="mt-4 text-lg text-vice-text/90">{item.summary}</p>}
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-vice-accent px-5 font-bold text-vice-ink focus-visible:outline-2 focus-visible:outline-vice-gold"
      >
        Leer en la fuente original
      </a>
      <p className="mt-4 text-xs text-vice-text/60">{DISCLAIMER}</p>
      <AdSlot position="after-content" className="mt-8" />
    </article>
  );
}

export default function NewsPage({ slug }: { slug?: string }) {
  return slug ? <NewsDetail slug={slug} /> : <NewsList />;
}
