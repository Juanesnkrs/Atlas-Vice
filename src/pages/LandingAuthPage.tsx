// P01 + P02 - Landing (Storytelling + SEO, pilar 7) y acceso PKCE (pilares 1 y 2).
// Split-Hero: 40% panel de acceso (máx. 4 botones) / 60% narrativa de Leonida + artwork.
// Nunca se guardan tokens en el cliente: la sesión es una cookie HttpOnly emitida por la API.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { SunsetBanner, ViceShell, ViceWordmark } from '../components/layout/ViceShell';
import Footer from '../components/layout/Footer';
import { PalmButton } from '../components/ui/PalmButton';
import {
  HERO_IMAGE,
  SAMPLE_NOTICE,
  forumCategoryLabel,
  useForumData,
  useOfficialNews,
  usePublicConfig,
} from '../data/seed';
import { isApiConfigured, useAuthStore, type OAuthProvider } from '../store/useAuthStore';
import { navigate } from '../store/useRouteStore';

const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';

const safeNext = (next: string | null): string =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : '/hub';

// ---- SEO: title, meta, Open Graph y JSON-LD (se limpian al desmontar) ----------------------
const SEO_TITLE = 'LeonidApp | Mapa, catálogo y guías de Leonida (Vice City, Grassrivers, Port Gellhorn)';
const SEO_DESC =
  'LeonidApp es la guía comunitaria de Leonida: mapa táctico, catálogo de armas y vehículos, foro y noticias oficiales de Rockstar y Take-Two. Entra como Invitado sin registro.';

function useSeo(): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = SEO_TITLE;
    const restore: Array<() => void> = [];
    const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const created = !el;
      const prev = el?.getAttribute('content') ?? null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
      restore.push(() => {
        if (created) el?.remove();
        else if (prev !== null) el?.setAttribute('content', prev);
      });
    };
    const origin = window.location.origin;
    setMeta('name', 'description', SEO_DESC);
    setMeta('property', 'og:title', SEO_TITLE);
    setMeta('property', 'og:description', SEO_DESC);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:image', `${origin}${HERO_IMAGE}`);

    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          name: 'LeonidApp',
          url: `${origin}/`,
          description: SEO_DESC,
          inLanguage: 'es',
        },
        {
          '@type': 'Organization',
          name: 'LeonidApp',
          url: `${origin}/`,
          logo: `${origin}/assets/vice-sunset-ref.jpg`,
        },
        {
          '@type': 'WebApplication',
          name: 'LeonidApp',
          applicationCategory: 'GameApplication',
          operatingSystem: 'Web, iOS, Android',
          url: `${origin}/`,
          image: `${origin}${HERO_IMAGE}`,
        },
      ],
    });
    document.head.appendChild(ld);

    return () => {
      document.title = prevTitle;
      restore.forEach((fn) => fn());
      ld.remove();
    };
  }, []);
}

// ---- Iconos de proveedor ------------------------------------------------------------
const glyph = (d: string) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
    <path d={d} />
  </svg>
);
const GLYPHS = {
  google: glyph('M12 11v3.2h4.5c-.2 1.200-1.400 3.500-4.500 3.500a5 5 0 010-10c1.500 0 2.400.6 3 1.200l2.100-2A8 8 0 0012 4a8 8 0 100 16c4.600 0 7.700-3.200 7.700-7.800 0-.5-.1-.9-.1-1.200H12z'),
  discord: glyph('M19.3 5.4A16 16 0 0015.4 4l-.5 1a14.800 14.800 0 00-5.800 0l-.5-1a16 16 0 00-3.900 1.400C2.200 9.100 1.500 12.700 1.900 16.200a16 16 0 004.800 2.400l1-1.700a10 10 0 01-1.600-.8l.4-.3a11.500 11.500 0 009.800 0l.4.3c-.5.300-1 .6-1.600.8l1 1.700a16 16 0 004.800-2.400c.5-4-.8-7.600-2.800-10.800zM8.700 14.100c-.9 0-1.600-.8-1.600-1.800s.7-1.800 1.600-1.800 1.600.8 1.600 1.800-.7 1.800-1.600 1.800zm6.600 0c-.9 0-1.600-.8-1.600-1.800s.7-1.800 1.600-1.800 1.600.8 1.600 1.800-.7 1.800-1.600 1.800z'),
  apple: glyph('M16.400 12.700c0-2.300 1.900-3.400 2-3.500-1.100-1.600-2.800-1.800-3.400-1.800-1.400-.1-2.800.9-3.500.9s-1.800-.8-3-.8c-1.500 0-3 .9-3.800 2.300-1.600 2.800-.4 7 1.200 9.200.8 1.100 1.700 2.400 2.900 2.300 1.200 0 1.600-.7 3-.7s1.800.7 3 .7 2-1.100 2.800-2.200c.9-1.300 1.200-2.500 1.200-2.600 0 0-2.400-.9-2.400-3.800zM14.100 5.900c.6-.8 1.100-1.800.9-2.900-.9 0-2 .6-2.700 1.400-.6.700-1.100 1.800-1 2.800 1 .1 2.100-.5 2.800-1.300z'),
  'magic-link': glyph('M3 6.500A2.500 2.500 0 015.500 4h13A2.500 2.500 0 0121 6.500v11a2.500 2.500 0 01-2.500 2.500h-13A2.500 2.500 0 013 17.500v-11zm2.300.3l6.700 5 6.700-5H5.300zM19 9.100l-6.400 4.800a1 1 0 01-1.200 0L5 9.100v8.400c0 .3.200.5.500.5h13c.3 0 .5-.2.500-.5V9.100z'),
} as const;

type ProviderId = OAuthProvider | 'magic-link';
const PROVIDERS: ReadonlyArray<{ id: ProviderId; label: string }> = [
  { id: 'google', label: 'Continuar con Google' },
  { id: 'discord', label: 'Continuar con Discord' },
  { id: 'apple', label: 'Continuar con Apple' },
  { id: 'magic-link', label: 'Correo / Magic Link' },
];

// ---- Diálogo accesible de Magic Link ---------------------------------------------------
function MagicLinkDialog({ onClose, returnFocus }: { onClose: () => void; returnFocus: HTMLElement | null }) {
  const requestMagicLink = useAuthStore((s) => s.requestMagicLink);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const emailId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0] as HTMLElement;
      const last = nodes[nodes.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocus?.focus();
    };
  }, [onClose, returnFocus]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Introduce un correo electrónico válido.');
    setBusy(true);
    const res = await requestMagicLink(email.trim());
    setBusy(false);
    if (!res.ok) return setError(res.error ?? 'No se pudo enviar el enlace.');
    setSent(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass w-full max-w-sm rounded-2xl p-6"
      >
        <h2 id={titleId} className="font-display text-xl font-bold">
          Entrar con Magic Link
        </h2>
        <p className="mt-1 text-sm text-vice-text/85">
          Te enviamos un enlace de un solo uso. Sin contraseñas.
        </p>
        {sent ? (
          <p role="status" className="mt-4 text-vice-cyan">
            Si el correo es válido, recibirás el enlace en unos minutos. Revisa también el spam.
          </p>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-4 flex flex-col gap-3">
            <label htmlFor={emailId} className="text-sm font-medium">
              Correo electrónico
            </label>
            <input
              ref={inputRef}
              id={emailId}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className={INPUT}
            />
            <div aria-live="polite" className="min-h-[1.25rem] text-sm">
              {error && (
                <p role="alert" className="text-vice-gold">
                  {error}
                </p>
              )}
            </div>
            <PalmButton type="submit" fullWidth loading={busy}>
              Enviar enlace
            </PalmButton>
          </form>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl text-sm text-vice-text/85 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

// ---- Narrativa de Leonida (Storytelling) ----------------------------------------------------
const LORE: ReadonlyArray<{ id: string; name: string; text: string; href: string }> = [
  {
    id: 'vice-city',
    name: 'Vice City',
    text: 'Neón, playas y autopistas al atardecer. El corazón de Leonida late entre clubes, marinas y calles que nunca se apagan.',
    href: '/mapa?region=Vice%20City',
  },
  {
    id: 'grassrivers',
    name: 'Grassrivers',
    text: 'Pantanos, aire denso y secretos entre el cañaveral. Aquí se esconden coleccionables y rutas que solo conocen los locales.',
    href: '/mapa?region=Grassrivers',
  },
  {
    id: 'port-gellhorn',
    name: 'Port Gellhorn',
    text: 'Puerto, grúas y contenedores. Un lugar de contrabando y oportunidades donde cada muelle esconde una historia.',
    href: '/mapa?region=Port%20Gellhorn',
  },
];

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-2xl p-5 ${className}`}>{children}</div>;
}

export default function LandingAuthPage({ next }: { next: string | null }) {
  useSeo();
  const status = useAuthStore((s) => s.status);
  const storeError = useAuthStore((s) => s.error);
  const signInWithProvider = useAuthStore((s) => s.signInWithProvider);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const cfg = usePublicConfig();
  const { news, loading: newsLoading, error: newsError } = useOfficialNews('all', 3);
  const { data: forum, loading: forumLoading, error: forumError } = useForumData();

  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [magicOpen, setMagicOpen] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const magicTrigger = useRef<HTMLElement | null>(null);

  const online = isApiConfigured;
  const providers = PROVIDERS.filter((p) => cfg.enabled_auth_providers.includes(p.id)).slice(0, 4);

  const topThreads = useMemo(
    () =>
      [...forum.threads]
        .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.upvotes_count - a.upvotes_count)
        .slice(0, 3),
    [forum.threads],
  );

  // Sesión iniciada: continuar al destino.
  useEffect(() => {
    if (status === 'authenticated') navigate(safeNext(next), { replace: true });
  }, [status, next]);

  const goGuest = () => {
    continueAsGuest();
    navigate(safeNext(next), { replace: true });
  };

  const onProvider = async (id: ProviderId) => {
    setError(null);
    if (id === 'magic-link') {
      magicTrigger.current = document.activeElement as HTMLElement | null;
      setMagicOpen(true);
      return;
    }
    setBusy(id);
    const res = await signInWithProvider(id);
    setBusy(null);
    if (!res.ok) setError(res.error ?? 'No se pudo iniciar sesión.');
  };

  const shownError = error ?? storeError;

  return (
    <ViceShell lockScroll={false}>
      <div className="flex min-h-dvh flex-col md:min-h-[100dvh] md:flex-row">
        {/* ---------------- Panel de acceso (40%) ---------------- */}
        <section
          id="acceso"
          aria-labelledby="acceso-title"
          className="glass relative z-20 flex w-full shrink-0 flex-col items-center px-6 pb-6 pt-8 md:sticky md:top-0 md:h-dvh md:w-[40%] md:overflow-y-auto md:border-y-0 md:border-l-0 md:px-12 md:pt-11"
        >
          <a href="/" aria-label="LeonidApp, inicio">
            <ViceWordmark width={300} />
          </a>
          <h2 id="acceso-title" className="mt-6 font-display text-xl font-bold">
            Accede a tu cuenta
          </h2>
          <p className="mt-1 text-center text-sm text-vice-text/85">
            Sin contraseñas: inicio seguro con PKCE y sesión protegida en tu dispositivo.
          </p>

          <div className="mt-5 flex w-full max-w-sm flex-col gap-3">
            {providers.map((p) => (
              <PalmButton
                key={p.id}
                variant={p.id === 'magic-link' ? 'glass' : 'primary'}
                fullWidth
                loading={busy === p.id}
                disabled={!online || busy !== null}
                icon={GLYPHS[p.id]}
                onClick={() => void onProvider(p.id)}
              >
                {p.label}
              </PalmButton>
            ))}
            {providers.length === 0 && (
              <p role="status" className="text-sm text-vice-gold">
                El inicio de sesión está desactivado temporalmente. Puedes explorar como Invitado.
              </p>
            )}
          </div>

          <div aria-live="polite" className="mt-3 min-h-[1.25rem] w-full max-w-sm text-sm">
            {shownError && (
              <p role="alert" className="text-vice-gold">
                {shownError}
              </p>
            )}
          </div>

          {!online && (
            <p className="mt-2 w-full max-w-sm rounded-xl border border-vice-gold/40 bg-white/5 p-3 text-xs text-vice-text/90">
              La API no está configurada: la app corre en modo Invitado / offline. El inicio de
              sesión no está disponible y tu progreso se guarda solo en este dispositivo.
            </p>
          )}

          <p className="mt-auto pt-6 text-xs tracking-widest text-vice-text/70">
            v0.1.0 · {online ? 'ONLINE' : 'OFFLINE'}
          </p>
        </section>

        {/* ---------------- Zona pública: Storytelling + SEO (60%) ---------------- */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="relative flex min-h-[560px] flex-col overflow-hidden px-6 pt-8 md:min-h-dvh md:px-12 md:pt-14">
            <svg
              aria-hidden="true"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <line x1="38" y1="0" x2="12" y2="100" stroke="#F69259" strokeOpacity="0.7" strokeWidth="0.25" />
              <line x1="46" y1="0" x2="20" y2="100" stroke="#E14B7B" strokeOpacity="0.45" strokeWidth="0.25" />
            </svg>

            <div
              className="pointer-events-none absolute bottom-0 right-0 w-full overflow-hidden"
              style={{
                aspectRatio: '1080 / 815',
                maxHeight: '62%',
                WebkitMaskImage: 'linear-gradient(180deg, transparent 0, #000 56px)',
                maskImage: 'linear-gradient(180deg, transparent 0, #000 56px)',
              }}
            >
              {heroFailed ? (
                <SunsetBanner className="absolute inset-0 h-full w-full" />
              ) : (
                <img
                  src={HERO_IMAGE}
                  alt="Lucía y Jason con pañuelos sobre el rostro frente a una gasolinera al atardecer"
                  className="absolute bottom-0 left-0 h-auto w-full max-w-none"
                  onError={() => setHeroFailed(true)}
                />
              )}
            </div>

            <div className="relative z-10 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-vice-orange">
                Guía comunitaria de Leonida
              </p>
              <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-6xl">
                Descubre Leonida: Vice City, Grassrivers y Port Gellhorn
              </h1>
              <p className="mt-4 text-lg text-vice-text/90">
                Un estado de sol, neón y secretos. LeonidApp reúne el mapa táctico, el catálogo de
                armas y vehículos, el foro y las noticias oficiales para que no se te escape nada.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <PalmButton onClick={goGuest}>Entrar como Invitado</PalmButton>
                <a
                  href="#historia"
                  className="flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold underline underline-offset-4 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  Conocer Leonida
                </a>
              </div>
              <p className="mt-2 text-xs text-vice-text/75">
                Sin registro. Tu progreso al 100% se guarda en este dispositivo y puedes sincronizarlo
                al iniciar sesión.
              </p>
              {cfg.maintenance_mode && (
                <p role="status" className="glass mt-3 rounded-xl px-4 py-2 text-sm text-vice-gold">
                  Mantenimiento en curso: algunas funciones pueden no estar disponibles.
                </p>
              )}
            </div>
          </header>

          <main className="relative z-10 flex flex-col gap-10 px-6 pb-12 pt-10 md:px-12">
            <section id="historia" aria-labelledby="historia-title">
              <h2 id="historia-title" className="font-display text-2xl font-bold md:text-3xl">
                Tres rincones, una sola Leonida
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {LORE.map((l) => (
                  <article key={l.id} className="glass flex flex-col rounded-2xl p-5">
                    <h3 className="font-display text-xl font-bold text-vice-orange">{l.name}</h3>
                    <p className="mt-2 flex-1 text-sm text-vice-text/90">{l.text}</p>
                    <a
                      href={l.href}
                      className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-vice-orange underline"
                    >
                      Ver en el mapa
                    </a>
                  </article>
                ))}
              </div>
            </section>

            <section aria-labelledby="vivo-title">
              <h2 id="vivo-title" className="font-display text-2xl font-bold md:text-3xl">
                En vivo desde la comunidad
              </h2>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Card>
                  <h3 className="font-display text-lg font-bold">Últimas noticias oficiales</h3>
                  <div aria-live="polite" className="mt-3">
                    {newsLoading ? (
                      <p role="status" className="text-sm">
                        Cargando noticias…
                      </p>
                    ) : newsError ? (
                      <p role="status" className="text-sm text-vice-gold">
                        No se pudieron cargar las noticias oficiales.
                      </p>
                    ) : news.length === 0 ? (
                      <p className="text-sm text-vice-text/70">Aún no hay noticias oficiales.</p>
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {news.map((n) => (
                          <li key={n.id} className="border-l-2 border-vice-magenta pl-3">
                            <p className="text-xs text-vice-orange">
                              {new Date(n.publishedAt).toLocaleDateString('es')}
                            </p>
                            <a
                              href={`/noticias/${encodeURIComponent(n.slug)}`}
                              className="font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold"
                            >
                              {n.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <a
                    href="/noticias"
                    className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-vice-orange underline"
                  >
                    Todas las noticias
                  </a>
                </Card>

                <Card>
                  <h3 className="font-display text-lg font-bold">Hilos destacados del foro</h3>
                  <div aria-live="polite" className="mt-3">
                    {forumLoading && forum.source === 'seed' ? (
                      <p role="status" className="text-sm">
                        Cargando hilos…
                      </p>
                    ) : forumError ? (
                      <p role="status" className="text-sm text-vice-gold">
                        No se pudo leer el foro; mostrando datos de ejemplo.
                      </p>
                    ) : null}
                    {topThreads.length === 0 ? (
                      <p className="text-sm text-vice-text/70">Aún no hay hilos.</p>
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {topThreads.map((t) => (
                          <li key={t.id}>
                            <a
                              href={`/foro?hilo=${t.id}`}
                              className="block rounded-lg px-1 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
                            >
                              <span className="text-xs text-vice-orange">{forumCategoryLabel(t.categoria)}</span>
                              <span className="block font-semibold">{t.titulo}</span>
                              <span className="text-xs text-vice-text/70">▲ {t.upvotes_count}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    {forum.source === 'seed' && (
                      <p className="mt-2 text-xs text-vice-text/70">{SAMPLE_NOTICE}</p>
                    )}
                  </div>
                </Card>
              </div>
            </section>
          </main>

          <Footer variant="full" />
        </div>
      </div>

      {magicOpen && (
        <MagicLinkDialog onClose={() => setMagicOpen(false)} returnFocus={magicTrigger.current} />
      )}
    </ViceShell>
  );
}
