// /guias y /guias/:slug - Guías (Lore) editoriales con pasos ordenados y verificables.
// El avance por paso vive en useProgressStore (IndexedDB); al completar todos los pasos la guía
// se marca como completada (ENTITY) y esa marca se sincroniza con MongoDB. AdSlot solo aquí
// (zona editorial con scroll), máx. 2 por página: docs/LeonidApp-Rutas-SEO-Monetizacion.md §6.
import { useEffect, useMemo, useState } from 'react';
import { AdSlot } from '../components/ui/AdSlot';
import { StatBar } from '../components/ui/StatBar';
import {
  SAMPLE_NOTICE,
  entityHref,
  entitySlug,
  forumCategoryLabel,
  guideSteps,
  loreRefs,
  metaOf,
  useEntityDetail,
  useForumData,
  useWorldData,
} from '../data/seed';
import { useProgressStore } from '../store/useProgressStore';
import { usePageMeta } from '../store/useRouteStore';
import type { Entity } from '../types/database';

const LINK =
  'flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold';

/** true si la ventana mide >= 1280px (posición `sidebar` solo en escritorio). */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 3)}...` : t);

function useGuideProgress(guide: Entity | null, total: number) {
  const stored = useProgressStore((s) => (guide ? s.guideSteps[guide.id] : undefined));
  const completed = useProgressStore((s) => (guide ? s.items[`entity:${guide.id}`]?.completado === true : false));
  // Completada en otro dispositivo: solo llega la marca ENTITY -> todos los pasos cuentan.
  const doneIds = useMemo(() => new Set(stored ?? []), [stored]);
  const allDone = completed && stored === undefined;
  const count = allDone ? total : doneIds.size;
  return { doneIds, allDone, count, percent: total === 0 ? 0 : Math.round((count / total) * 100) };
}

// ---------------------------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------------------------
function GuideCard({ guide }: { guide: Entity }) {
  const steps = guideSteps(guide);
  const { count, percent } = useGuideProgress(guide, steps.length);
  return (
    <li className="glass flex flex-col rounded-2xl p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{guide.categoria}</p>
      <h2 className="font-display text-lg font-bold">
        <a href={`/guias/${entitySlug(guide)}`} className="hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold">
          {guide.titulo}
        </a>
      </h2>
      {guide.subtitulo && <p className="text-sm text-vice-text/85">{guide.subtitulo}</p>}
      {steps.length > 0 && (
        <StatBar className="mt-3" label="Tu avance" value={percent} valueLabel={`${count}/${steps.length}`} accent="gold" />
      )}
    </li>
  );
}

function GuidesIndex() {
  const { data, loading, error } = useWorldData();
  usePageMeta({
    title: 'Guías y misiones',
    description: 'Guías paso a paso de Leonida con progreso verificable: primeros pasos, rutas de tiendas, eventos y misiones.',
    canonicalPath: '/guias',
  });
  const guidesModule = data.modules.find((m) => m.slug === 'guias');
  const guides = data.entities.filter((e) => e.module_id === guidesModule?.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold">Guías y misiones</h1>
      <p className="mt-1 text-sm text-vice-text/80">
        Sigue cada guía paso a paso y marca lo que ya hiciste: tu avance se guarda en el dispositivo y, con cuenta, se sincroniza.
      </p>
      {(loading || error) && (
        <p role="status" className="mt-2 text-xs text-vice-text/80">
          {loading ? 'Cargando desde la API… ' : ''}
          {error ? `API no disponible (${error}); usando el seed.` : ''}
        </p>
      )}
      {guides.length === 0 ? (
        <p className="mt-6 text-vice-text/70">Aún no hay guías publicadas.</p>
      ) : (
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {guides.map((g) => (
            <GuideCard key={g.id} guide={g} />
          ))}
        </ul>
      )}
      <AdSlot position="after-content" className="mt-8" />
      <p className="mt-4 text-xs text-vice-text/60">{SAMPLE_NOTICE}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------------------------
function GuideDetail({ slug }: { slug: string }) {
  const { entity: guide, loading } = useEntityDetail('guias', slug);
  const { data } = useWorldData();
  const { data: forum } = useForumData();
  const toggleStep = useProgressStore((s) => s.toggleGuideStep);
  const wide = useWide();
  const [showSpoiler, setShowSpoiler] = useState(false);

  const steps = guide ? guideSteps(guide) : [];
  const { doneIds, allDone, count, percent } = useGuideProgress(guide, steps.length);

  usePageMeta(
    guide
      ? {
          title: guide.titulo,
          description: clip(
            `${guide.subtitulo ? `${guide.subtitulo}. ` : ''}Guía paso a paso de ${guide.titulo} en LeonidApp, con progreso verificable.`,
            160,
          ),
          canonicalPath: `/guias/${slug}`,
        }
      : { title: loading ? 'Cargando guía' : 'Guía no encontrada', robots: 'noindex,nofollow' },
  );

  if (!guide) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-4">
        <p role="status" className="glass rounded-2xl p-6 text-center">
          {loading ? 'Cargando guía…' : 'No encontramos esta guía.'}{' '}
          <a href="/guias" className="font-semibold text-vice-orange underline">
            Ver todas las guías
          </a>
        </p>
      </div>
    );
  }

  const meta = metaOf(guide);
  const spoilerHidden = meta.spoiler === true && !showSpoiler;

  // Enlazado cruzado desde lore_refs (UUID de Entity o MapMarker) y marcadores propios de la guía.
  const entityById = new Map(data.entities.map((e) => [e.id, e]));
  const moduleById = new Map(data.modules.map((m) => [m.id, m]));
  const refs = loreRefs(guide).flatMap((id) => {
    const e = entityById.get(id);
    const mod = e ? moduleById.get(e.module_id) : undefined;
    if (e && mod) return [{ key: id, label: e.titulo, href: entityHref(e, mod.slug), kind: 'Catálogo' }];
    const m = data.markers.find((x) => x.id === id);
    if (m) return [{ key: id, label: m.titulo, href: `/mapa?marker=${m.id}`, kind: 'Mapa' }];
    return [];
  });
  const ownMarkers = data.markers.filter((m) => m.entity_id === guide.id);
  const threads = forum.threads
    .filter((t) => t.entity_id === guide.id || ownMarkers.some((m) => m.id === t.marker_id))
    .slice(0, 5);

  const inArticle = !wide;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-2 md:px-8 xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8">
      <article>
        <nav aria-label="Migas de pan" className="text-xs text-vice-text/80">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <a href="/guias" className="inline-flex min-h-11 items-center underline">
                Guías
              </a>
            </li>
            <li aria-hidden="true">›</li>
            <li aria-current="page">{guide.titulo}</li>
          </ol>
        </nav>
        <header className="mt-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-vice-orange">{guide.categoria}</p>
          <h1 className="font-display text-3xl font-bold">{guide.titulo}</h1>
          {guide.subtitulo && <p className="text-vice-text/85">{guide.subtitulo}</p>}
        </header>

        {steps.length > 0 && (
          <div className="glass mt-4 rounded-2xl p-4">
            <StatBar
              label="Progreso de la guía"
              value={percent}
              valueLabel={`${count}/${steps.length} pasos`}
              accent="gold"
            />
            {(allDone || count === steps.length) && (
              <p role="status" className="mt-2 text-sm font-semibold text-vice-gold">
                Guía completada.
              </p>
            )}
          </div>
        )}

        <section aria-labelledby="pasos-title" className="mt-5">
          <h2 id="pasos-title" className="font-display text-xl font-bold">
            Pasos
          </h2>
          {spoilerHidden ? (
            <div className="mt-2 rounded-xl border border-vice-gold/40 p-4">
              <p>Contenido con spoiler.</p>
              <button
                type="button"
                onClick={() => setShowSpoiler(true)}
                className="mt-2 min-h-11 rounded-full bg-white/10 px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold"
              >
                Mostrar spoiler
              </button>
            </div>
          ) : (
            <ol className="mt-2 flex flex-col gap-2">
              {steps.map((st, i) => {
                const checked = allDone || doneIds.has(st.id);
                const inputId = `paso-${st.id}`;
                return (
                  <li key={st.id} className="flex flex-col gap-2">
                    <div className="glass flex items-start gap-3 rounded-xl p-3">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          toggleStep(
                            guide.id,
                            st.id,
                            steps.map((x) => x.id),
                          )
                        }
                        className="mt-1 h-6 w-6 shrink-0 accent-[#E1307E]"
                      />
                      <label htmlFor={inputId} className="min-h-11 flex-1 cursor-pointer">
                        <span className="text-xs text-vice-orange">Paso {i + 1}</span>
                        <span className={`block font-semibold ${checked ? 'line-through opacity-70' : ''}`}>{st.title}</span>
                        {st.body && <span className="mt-1 block text-sm text-vice-text/85">{st.body}</span>}
                      </label>
                    </div>
                    {i === 1 && inArticle && <AdSlot position="in-article" />}
                  </li>
                );
              })}
              {steps.length === 0 && <li className="text-sm text-vice-text/70">Esta guía aún no tiene pasos.</li>}
            </ol>
          )}
        </section>

        {(refs.length > 0 || ownMarkers.length > 0) && (
          <section aria-labelledby="refs-title" className="mt-6">
            <h2 id="refs-title" className="font-display text-xl font-bold">
              En esta guía
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {ownMarkers[0] && (
                <li>
                  <a href={`/mapa?marker=${ownMarkers[0].id}`} className={`${LINK} bg-vice-accent text-vice-ink`}>
                    Ver el recorrido en el mapa
                  </a>
                </li>
              )}
              {refs.map((r) => (
                <li key={r.key}>
                  <a href={r.href} className={LINK}>
                    {r.kind}: {r.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="foro-title" className="mt-6">
          <h2 id="foro-title" className="font-display text-xl font-bold">
            Comunidad
          </h2>
          {threads.length > 0 && (
            <ul className="mt-1 flex flex-col text-sm">
              {threads.map((t) => (
                <li key={t.id}>
                  <a href={`/foro?hilo=${t.id}`} className="block min-h-11 rounded-lg px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold">
                    <span className="text-xs text-vice-orange">{forumCategoryLabel(t.categoria)} · ▲ {t.upvotes_count}</span>
                    <span className="block font-semibold">{t.titulo}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <a href={`/foro?entity=${guide.id}`} className={`${LINK} mt-2 w-fit`}>
            Abrir hilo sobre esta guía
          </a>
        </section>

        <AdSlot position="after-content" className="mt-8" />
        <p className="mt-4 text-xs text-vice-text/60">{SAMPLE_NOTICE}</p>
      </article>

      {wide && (
        <aside aria-label="Publicidad lateral" className="hidden xl:block">
          <div className="sticky top-4">
            <AdSlot position="sidebar" />
          </div>
        </aside>
      )}
    </div>
  );
}

export default function GuidesPage({ slug }: { slug?: string }) {
  return slug ? <GuideDetail slug={slug} /> : <GuidesIndex />;
}
