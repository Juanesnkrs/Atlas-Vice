// /legal/privacidad, /legal/cookies, /legal/terminos, /legal/marcas, /legal/retirada (S6.3).
// Pantallas editoriales con scroll (con RockstarFooter). Contenido en src/data/legalDocs.ts.
import { CookiePreferencesPanel, openContactForm } from '../components/layout/Footer';
import { PalmButton } from '../components/ui/PalmButton';
import { getLegalDoc, LEGAL_DOCS, LEGAL_UPDATED, type LegalId } from '../data/legalDocs';
import { usePageMeta } from '../store/useRouteStore';

export default function LegalPage({ docId }: { docId: LegalId }) {
  const doc = getLegalDoc(docId);
  usePageMeta({
    title: doc.title,
    description: doc.description,
    robots: 'index,follow',
    canonicalPath: doc.path,
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-2 md:px-8 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <nav aria-label="Documentos legales" className="mb-6 lg:mb-0 lg:pt-2">
        <p className="font-display text-xs font-bold uppercase tracking-[0.12em] text-vice-text/80">Legal</p>
        <ul className="m-0 mt-1 flex list-none flex-wrap gap-x-1 p-0 lg:flex-col">
          {LEGAL_DOCS.map((d) => (
            <li key={d.id}>
              <a
                href={d.path}
                aria-current={d.id === doc.id ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                  d.id === doc.id ? 'bg-white/15 text-[#FFC09A]' : 'text-vice-text hover:bg-white/10'
                }`}
              >
                {d.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 max-w-3xl">
        <header>
          <h1 className="font-display text-3xl font-bold text-[#FFC09A] md:text-4xl">{doc.title}</h1>
          <p className="mt-2 text-lg text-vice-text/90">{doc.lead}</p>
          <p className="mt-2 text-sm text-vice-text/80">
            Última actualización: <time dateTime={LEGAL_UPDATED}>{LEGAL_UPDATED}</time>
          </p>
        </header>

        {doc.sections.map((s) => (
          <section key={s.id} aria-labelledby={`${doc.id}-${s.id}`} className="glass mt-4 rounded-[22px] p-5">
            <h2 id={`${doc.id}-${s.id}`} className="font-display text-xl font-bold">
              {s.heading}
            </h2>
            {s.paragraphs?.map((p) => (
              <p key={p} className="mt-2 leading-relaxed text-vice-text/90">
                {p}
              </p>
            ))}
            {s.items && (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed text-vice-text/90">
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {doc.id === 'cookies' && (
          <section aria-labelledby="cookies-panel" className="glass mt-4 rounded-[22px] p-5">
            <h2 id="cookies-panel" className="font-display text-xl font-bold">
              Tu decisión
            </h2>
            <p className="mb-3 mt-2 text-vice-text/90">Cambia aquí las categorías de cookies. Se aplica al instante.</p>
            <CookiePreferencesPanel />
          </section>
        )}

        {doc.id === 'retirada' && (
          <section aria-labelledby="retirada-cta" className="glass mt-4 rounded-[22px] p-5">
            <h2 id="retirada-cta" className="font-display text-xl font-bold">
              Enviar una notificación
            </h2>
            <p className="mb-4 mt-2 text-vice-text/90">
              Abre el formulario de Contacto con el asunto «Retirada de contenido» ya seleccionado.
            </p>
            <PalmButton type="button" onClick={() => openContactForm('takedown')}>
              Abrir formulario de retirada
            </PalmButton>
          </section>
        )}

        {doc.id === 'privacidad' && (
          <section aria-labelledby="privacidad-cta" className="glass mt-4 rounded-[22px] p-5">
            <h2 id="privacidad-cta" className="font-display text-xl font-bold">
              Ejercer mis derechos
            </h2>
            <p className="mb-4 mt-2 text-vice-text/90">
              Abre el formulario de Contacto con el asunto «Privacidad y datos» ya seleccionado.
            </p>
            <PalmButton type="button" onClick={() => openContactForm('privacy')}>
              Escribir sobre mis datos
            </PalmButton>
          </section>
        )}
      </article>
    </div>
  );
}
