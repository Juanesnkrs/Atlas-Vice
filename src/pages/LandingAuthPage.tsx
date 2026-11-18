// P01 + P02 - Acceso `/entrar` (DesignSpec §7.3), réplica de Main.dc.html (escritorio) y
// MobileHero.dc.html (móvil): conmutador Entrar / Explorar, 4 botones de acceso (pilar 1) y sesión
// por cookie HttpOnly emitida por la API (pilar 2). Nunca se guardan tokens en el cliente.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { SunsetBanner, ViceShell, ViceWordmark } from '../components/layout/ViceShell';
import { Modal } from '../components/ui/Modal';
import { PalmButton } from '../components/ui/PalmButton';
import { HERO_IMAGE, SEED_TIPS, usePublicConfig } from '../data/seed';
import { isApiConfigured, useAuthStore, type OAuthProvider } from '../store/useAuthStore';
import { navigate } from '../store/useRouteStore';

const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold';

const safeNext = (next: string | null): string =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : '/hub';

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

// ---- Magic Link (Modal) ------------------------------------------------------------------------
function MagicLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const requestMagicLink = useAuthStore((s) => s.requestMagicLink);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const emailId = useId();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^S+@S+.S+$/.test(email.trim())) return setError('Introduce un correo electrónico válido.');
    setBusy(true);
    const res = await requestMagicLink(email.trim());
    setBusy(false);
    if (!res.ok) return setError(res.error ?? 'No se pudo enviar el enlace.');
    setSent(true);
  };

  return (
    <Modal open={open} onClose={onClose} title="Entrar con Magic Link">
      <p className="text-sm text-vice-text/85">Te enviamos un enlace de un solo uso. Sin contraseñas.</p>
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
    </Modal>
  );
}

// ---- Pestañas y ventajas ---------------------------------------------------------------------
type Mode = 'login' | 'explore';

const PERKS = ['Mapa y catálogo completos', 'Foro en modo lectura', 'Crea cuenta luego y suma tu avance'] as const;

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => onChange(m)}
      className={`min-h-11 flex-1 rounded-[22px] text-[15px] font-bold ${FOCUS} ${
        mode === m ? 'bg-vice-accent text-vice-ink' : 'text-vice-text'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex h-12 w-full max-w-[360px] rounded-[26px] border border-[rgba(246,146,89,0.3)] bg-[rgba(20,14,36,0.78)] p-1 md:h-[52px] md:bg-white/[0.07]">
      {tab('login', 'Entrar')}
      {tab('explore', 'Explorar')}
    </div>
  );
}

/** Tarjeta flotante "Tip del día" sobre el artwork (solo escritorio). */
function TipFloat() {
  const [i, setI] = useState(0);
  const tips = SEED_TIPS.slice(0, 3);
  return (
    <section aria-label="Tip del día" className="glass relative w-[580px] max-w-full rounded-[20px] px-7 pb-3.5 pt-6">
      <span aria-hidden="true" className="pointer-events-none absolute -top-2 left-3 font-display text-[76px] font-bold leading-none text-[rgba(246,126,86,0.6)]">
        &ldquo;
      </span>
      <h2 className="m-0 mb-2.5 font-display text-[22px] font-semibold uppercase tracking-[0.02em] text-white">Tip del día</h2>
      <p aria-live="polite" className="m-0 min-h-[66px] text-[15px] leading-[1.55]">
        {tips[i] ?? ''}
      </p>
      {tips.length > 1 && (
        <div role="group" aria-label="Paginador de tips" className="flex items-center justify-end">
          {tips.map((_, n) => (
            <button
              key={n}
              type="button"
              aria-label={`Ver tip ${n + 1} de ${tips.length}`}
              aria-current={n === i ? 'true' : undefined}
              onClick={() => setI(n)}
              className={`flex h-11 min-w-11 items-center justify-center ${FOCUS}`}
            >
              <span className={`block h-1 w-[30px] rounded-sm ${n === i ? 'bg-[#F67E56]' : 'bg-white/60'}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function LandingAuthPage({ next }: { next: string | null }) {
  const status = useAuthStore((s) => s.status);
  const storeError = useAuthStore((s) => s.error);
  const signInWithProvider = useAuthStore((s) => s.signInWithProvider);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const cfg = usePublicConfig();

  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [magicOpen, setMagicOpen] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);

  const online = isApiConfigured;
  const providers = PROVIDERS.filter((p) => cfg.enabled_auth_providers.includes(p.id)).slice(0, 4);

  // Sesión iniciada: continuar al destino.
  useEffect(() => {
    if (status === 'authenticated') navigate(safeNext(next), { replace: true });
  }, [status, next]);

  const goGuest = () => {
    continueAsGuest();
    navigate('/hub', { replace: true });
  };

  const onProvider = async (id: ProviderId) => {
    setError(null);
    if (id === 'magic-link') {
      setMagicOpen(true);
      return;
    }
    setBusy(id);
    const res = await signInWithProvider(id);
    setBusy(null);
    if (!res.ok) setError(res.error ?? 'No se pudo iniciar sesión.');
  };

  const shownError = error ?? storeError;

  const heroImage = heroFailed ? (
    <SunsetBanner className="absolute inset-0 h-full w-full" />
  ) : (
    <img
      src={HERO_IMAGE}
      alt=""
      className="absolute bottom-0 left-0 h-auto w-full max-w-none"
      onError={() => setHeroFailed(true)}
    />
  );

  return (
    <ViceShell lockScroll={false}>
      <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
        {/* Artwork móvil (MobileHero.dc.html): 290px con wordmark encima. */}
        <div
          className="relative h-[290px] w-full shrink-0 overflow-hidden md:hidden"
          style={{ WebkitMaskImage: 'linear-gradient(180deg, #000 70%, transparent 100%)', maskImage: 'linear-gradient(180deg, #000 70%, transparent 100%)' }}
        >
          {heroImage}
          <a href="/" aria-label="LEONIDAPP, ir a la portada" className="absolute inset-x-0 top-5 flex justify-center drop-shadow-[0_2px_10px_rgba(20,14,36,0.6)]">
            <ViceWordmark width={240} />
          </a>
        </div>

        {/* Panel de acceso */}
        <section
          aria-labelledby="acceso-title"
          className="relative z-20 flex w-full flex-1 flex-col items-center px-6 pb-6 md:w-[576px] md:flex-none md:border-r md:border-[rgba(246,146,89,0.25)] md:bg-[rgba(20,14,36,0.78)] md:px-[108px] md:backdrop-blur-[14px] md:pb-0 md:pt-11"
        >
          <a href="/" aria-label="LEONIDAPP, ir a la portada" className="hidden md:block">
            <ViceWordmark width={360} />
          </a>

          <div className="-mt-5 flex w-full max-w-[360px] flex-col items-stretch md:mt-[22px]">
            <ModeSwitch mode={mode} onChange={setMode} />

            <div className="mt-3 rounded-3xl p-4 max-md:border max-md:border-[rgba(246,146,89,0.25)] max-md:bg-[rgba(20,14,36,0.78)] max-md:backdrop-blur-[14px] md:mt-5 md:p-0">
              {mode === 'login' ? (
                <>
                  <h1 id="acceso-title" className="font-display text-[26px] font-bold leading-tight md:text-[28px]">
                    Bienvenido a Leonida
                  </h1>
                  <p className="mt-1 text-[13px] text-vice-text/85">Entra para sincronizar tu progreso en todos tus dispositivos.</p>
                  <div className="mt-4 flex flex-col gap-3">
                    {providers.map((p) => (
                      <PalmButton
                        key={p.id}
                        variant={p.id === 'magic-link' ? 'glass' : 'primary'}
                        fullWidth
                        className="min-h-12"
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
                        El inicio de sesión está desactivado temporalmente. Puedes explorar como invitado.
                      </p>
                    )}
                  </div>
                  <div aria-live="polite" className="mt-3 min-h-[1.25rem] text-sm">
                    {shownError && (
                      <p role="alert" className="text-vice-gold">
                        {shownError}
                      </p>
                    )}
                  </div>
                  {!online && (
                    <p className="mt-2 rounded-xl border border-vice-gold/40 bg-white/5 p-3 text-xs text-vice-text/90">
                      Sin conexión con el servidor: el inicio de sesión no está disponible. Puedes explorar como invitado y tu progreso se guarda en este dispositivo.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <h1 id="acceso-title" className="font-display text-[26px] font-bold leading-tight md:text-[28px]">
                    Explora Leonida
                  </h1>
                  <p className="mt-1 text-[13px] text-vice-text/85">Entra sin cuenta. Tu progreso se guarda solo en este dispositivo.</p>
                  <ul className="my-4 flex flex-col gap-3 text-[13px] md:rounded-[20px] md:border md:border-[rgba(246,146,89,0.25)] md:bg-white/5 md:px-5 md:py-[18px]">
                    {PERKS.map((t) => (
                      <li key={t} className="flex items-center gap-3">
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded bg-[#F67E56]" />
                        {t}
                      </li>
                    ))}
                  </ul>
                  <PalmButton fullWidth className="min-h-12" onClick={goGuest}>
                    Continuar como invitado
                  </PalmButton>
                </>
              )}
            </div>
            {cfg.maintenance_mode && (
              <p role="status" className="glass mt-3 rounded-xl px-4 py-2 text-sm text-vice-gold">
                Mantenimiento en curso: algunas funciones pueden no estar disponibles.
              </p>
            )}
          </div>

          <p className="mt-auto pt-6 text-xs font-semibold tracking-wider text-vice-text md:pb-[30px]">
            v0.1.0 •{' '}
            <span className={online ? 'text-[#8CF0B5]' : 'text-vice-gold'}>
              <span aria-hidden="true">● </span>
              {online ? 'EN LÍNEA' : 'SIN CONEXIÓN'}
            </span>
          </p>
        </section>

        {/* Artwork escritorio (Main.dc.html) */}
        <div className="relative hidden min-w-0 flex-1 md:block">
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
            <polygon points="8,0 35,0 74,100 47,100" fill="rgba(225,75,123,0.26)" />
            <polygon points="100,4 100,40 81,100 65,100" fill="rgba(246,146,89,0.2)" />
            <line x1="8" y1="0" x2="47" y2="100" stroke="#F67E56" strokeOpacity="0.8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <line x1="35" y1="0" x2="74" y2="100" stroke="#E1307E" strokeOpacity="0.6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <div
            role="img"
            aria-label="Lucía y Jason con pañuelos sobre el rostro frente a una gasolinera al atardecer"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[73%] overflow-hidden"
            style={{ WebkitMaskImage: 'linear-gradient(180deg, transparent 0, #000 80px)', maskImage: 'linear-gradient(180deg, transparent 0, #000 80px)' }}
          >
            {heroImage}
          </div>
          <div className="absolute left-[70px] top-[70px] z-10 max-w-[calc(100%-100px)]">
            <TipFloat />
          </div>
        </div>
      </div>

      <MagicLinkDialog open={magicOpen} onClose={() => setMagicOpen(false)} />
    </ViceShell>
  );
}
