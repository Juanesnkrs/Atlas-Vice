// P01 + P02 - Landing / Autenticación (Split-Hero 40% formulario / 60% TipCard + artwork)
import { useEffect, useId, useState, type FormEvent } from 'react';
import { SunsetBanner, ViceShell, ViceWordmark } from '../components/layout/ViceShell';
import { PalmButton } from '../components/ui/PalmButton';
import { TipCard } from '../components/ui/TipCard';
import { HERO_IMAGE, SAMPLE_NOTICE, SEED_TIPS } from '../data/seed';
import { isApiConfigured, useAuthStore } from '../store/useAuthStore';

type Tab = 'login' | 'explore';
type View = 'form' | 'recover';

const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';

function DiscordGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M19.3 5.4A16 16 0 0015.4 4l-.5 1a14.800 14.800 0 00-5.800 0l-.5-1a16 16 0 00-3.900 1.400C2.200 9.100 1.500 12.700 1.900 16.200a16 16 0 004.800 2.400l1-1.700a10 10 0 01-1.600-.8l.4-.3a11.500 11.500 0 009.800 0l.4.3c-.5.300-1 .6-1.600.8l1 1.700a16 16 0 004.800-2.400c.5-4-.8-7.600-2.800-10.800zM8.700 14.100c-.9 0-1.600-.8-1.600-1.800s.7-1.800 1.600-1.800 1.600.8 1.600 1.800-.7 1.800-1.600 1.800zm6.600 0c-.9 0-1.600-.8-1.600-1.800s.7-1.800 1.600-1.800 1.600.8 1.600 1.800-.7 1.800-1.600 1.800z" />
    </svg>
  );
}

const safeNext = (next: string | null): string =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : '/hub';

export default function LandingAuthPage({ next }: { next: string | null }) {
  const status = useAuthStore((s) => s.status);
  const storeError = useAuthStore((s) => s.error);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithDiscord = useAuthStore((s) => s.signInWithDiscord);
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);

  const [tab, setTab] = useState<Tab>('login');
  const [view, setView] = useState<View>('form');
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [heroFailed, setHeroFailed] = useState(false);
  const emailId = useId();
  const passId = useId();

  // Sesión iniciada (Email/Discord): continuar al destino.
  useEffect(() => {
    if (status === 'authenticated') window.location.hash = `#${safeNext(next)}`;
  }, [status, next]);

  const goGuest = () => {
    continueAsGuest();
    window.location.hash = `#${safeNext(next)}`;
  };

  const resetMessages = () => {
    setError(null);
    setInfo(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!email.includes('@')) return setError('Introduce un correo electrónico válido.');
    if (password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
    setBusy(true);
    const res = register
      ? await signUpWithEmail(email.trim(), password)
      : await signInWithEmail(email.trim(), password);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? 'No se pudo completar la operación.');
    if (register) setInfo('Cuenta creada. Si se requiere confirmación, revisa tu correo.');
  };

  const onDiscord = async () => {
    resetMessages();
    setBusy(true);
    const res = await signInWithDiscord();
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'No se pudo iniciar con Discord.');
  };

  const onRecover = async (e: FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!email.includes('@')) return setError('Introduce el correo de tu cuenta.');
    setBusy(true);
    const res = await resetPassword(email.trim());
    setBusy(false);
    if (!res.ok) return setError(res.error ?? 'No se pudo enviar el enlace.');
    setInfo('Si el correo existe, recibirás un enlace para restablecer tu contraseña.');
  };

  const shownError = error ?? storeError;
  const online = isApiConfigured;

  return (
    <ViceShell lockScroll={false} className="md:h-dvh md:overflow-hidden">
      <div className="flex min-h-dvh flex-col md:h-dvh md:min-h-0 md:flex-row">
        {/* ---------------- Columna izquierda 40% ---------------- */}
        <section
          aria-label="Acceso"
          className="glass relative z-20 flex w-full shrink-0 flex-col items-center px-6 pb-6 pt-8 md:h-full md:w-[40%] md:overflow-y-auto md:border-y-0 md:border-l-0 md:px-12 md:pt-11"
        >
          <a href="#/entrar" aria-label="ATLAS VICE, inicio">
            <ViceWordmark width={300} />
          </a>

          <div
            role="group"
            aria-label="Modo de acceso"
            className="mt-5 flex h-[52px] w-full max-w-sm rounded-full border border-vice-orange/30 bg-white/10 p-1"
          >
            {(
              [
                ['login', 'Entrar'],
                ['explore', 'Explorar'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id);
                  setView('form');
                  resetMessages();
                }}
                className={`min-h-11 flex-1 rounded-full text-[15px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-vice-gold ${
                  tab === id ? 'bg-vice-accent text-vice-ink' : 'text-vice-text/85 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-5 w-full max-w-sm">
            {tab === 'login' && view === 'form' && (
              <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
                <div>
                  <label htmlFor={emailId} className="mb-1 block text-sm font-medium">
                    Email / usuario
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label htmlFor={passId} className="mb-1 block text-sm font-medium">
                    Contraseña
                  </label>
                  <input
                    id={passId}
                    type="password"
                    autoComplete={register ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className={INPUT}
                  />
                </div>
                <PalmButton type="submit" fullWidth loading={busy} disabled={!online}>
                  {register ? 'Crear cuenta' : 'Entrar'}
                </PalmButton>
                <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setRegister((v) => !v);
                      resetMessages();
                    }}
                    className="min-h-11 text-vice-orange underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold"
                  >
                    {register ? 'Ya tengo cuenta' : 'Crear una cuenta'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setView('recover');
                      resetMessages();
                    }}
                    className="min-h-11 text-vice-text/85 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <PalmButton
                  variant="glass"
                  fullWidth
                  disabled={!online || busy}
                  onClick={() => void onDiscord()}
                  icon={<DiscordGlyph />}
                >
                  Continuar con Discord
                </PalmButton>
              </form>
            )}

            {tab === 'login' && view === 'recover' && (
              <form onSubmit={onRecover} noValidate className="flex flex-col gap-3">
                <h2 className="font-display text-xl font-bold">Recuperar contraseña</h2>
                <p className="text-sm text-vice-text/85">
                  Te enviaremos un enlace de confirmación para crear una contraseña nueva.
                </p>
                <div>
                  <label htmlFor={emailId} className="mb-1 block text-sm font-medium">
                    Email de tu cuenta
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                    className={INPUT}
                  />
                </div>
                <PalmButton type="submit" fullWidth loading={busy} disabled={!online}>
                  Enviar enlace
                </PalmButton>
                <button
                  type="button"
                  onClick={() => {
                    setView('form');
                    resetMessages();
                  }}
                  className="min-h-11 text-sm text-vice-orange hover:underline focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  Volver a Entrar
                </button>
              </form>
            )}

            {tab === 'explore' && (
              <div className="flex flex-col gap-3">
                <p className="text-sm leading-relaxed text-vice-text/90">
                  Explora el mapa, el catálogo y el foro sin crear cuenta. Tu progreso al 100% se
                  guarda en este dispositivo y podrás sincronizarlo al iniciar sesión.
                </p>
                <PalmButton fullWidth onClick={goGuest}>
                  Explorar como Invitado
                </PalmButton>
              </div>
            )}

            <div aria-live="polite" className="mt-3 min-h-[1.25rem] text-sm">
              {shownError && (
                <p role="alert" className="text-vice-gold">
                  {shownError}
                </p>
              )}
              {info && <p className="text-vice-cyan">{info}</p>}
            </div>

            {tab === 'login' && (
              <button
                type="button"
                onClick={goGuest}
                className="mt-1 flex min-h-11 w-full items-center justify-center rounded-xl text-[15px] font-semibold text-vice-text underline underline-offset-4 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
              >
                Continuar como Invitado
              </button>
            )}

            {!online && (
              <p className="mt-2 rounded-xl border border-vice-gold/40 bg-white/5 p-3 text-xs text-vice-text/90">
                La API no está configurada: la app corre en modo Invitado / offline. Email y
                Discord no están disponibles; tu progreso se guarda solo en este dispositivo.
              </p>
            )}
          </div>

          <p className="mt-auto pt-6 text-xs tracking-widest text-vice-text/70">
            v0.1.0 · {online ? 'ONLINE' : 'OFFLINE'}
          </p>
        </section>

        {/* ---------------- Columna derecha 60% ---------------- */}
        <section
          aria-label="Bienvenida"
          className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden px-6 pb-0 pt-6 md:px-12 md:pt-10"
        >
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
              maxHeight: '80%',
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

          <div className="relative z-10 w-full max-w-md">
            <TipCard tips={SEED_TIPS} />
            <p className="mt-2 text-xs text-vice-text/70">{SAMPLE_NOTICE}</p>
          </div>
        </section>
      </div>
    </ViceShell>
  );
}
