import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { apiFetch, isApiConfigured } from '../../store/useAuthStore';

/* ------------------------------------------------------------------ */
/* Footer estilo Rockstar (pilar 6): negro puro, enlaces funcionales,  */
/* idioma ES/EN, redes desde AppConfig, legales y Cookie Settings.     */
/* ------------------------------------------------------------------ */

type Lang = 'es' | 'en';
type DocId = 'about' | 'privacy' | 'cookiePolicy' | 'legal' | 'dns';
type ModalId = DocId | 'cookies' | 'contact' | 'subscribe';

const LANG_KEY = 'leonidapp.lang';
const COOKIE_KEY = 'leonidapp.cookies';
const CONTACT_KEY = 'leonidapp.contact.outbox';
const SUB_KEY = 'leonidapp.subscribe';

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* almacenamiento no disponible */
  }
}

interface Dict {
  contact: string;
  collaborate: string;
  community: string;
  subscribe: string;
  contribute: string;
  forum: string;
  catalog: string;
  contactCta: string;
  subscribeCta: string;
  language: string;
  follow: string;
  about: string;
  privacy: string;
  cookiePolicy: string;
  cookieSettings: string;
  legal: string;
  dns: string;
  trademark: string;
  openFooter: string;
  close: string;
  closeFooter: string;
  name: string;
  email: string;
  message: string;
  send: string;
  sentContact: string;
  sentSubscribe: string;
  invalidEmail: string;
  localNote: string;
  subscribeText: string;
  contactText: string;
  necessary: string;
  necessaryText: string;
  analytics: string;
  analyticsText: string;
  preferences: string;
  preferencesText: string;
  marketing: string;
  marketingText: string;
  save: string;
  acceptAll: string;
  rejectAll: string;
  cookiesIntro: string;
  alwaysOn: string;
}

const DICT: Record<Lang, Dict> = {
  es: {
    contact: 'Contacto',
    collaborate: 'Colabora',
    community: 'Recursos de la comunidad',
    subscribe: 'Suscríbete',
    contribute: 'Aportes y moderación',
    forum: 'Foro de la comunidad',
    catalog: 'Catálogo de Leonida',
    contactCta: 'Escríbenos',
    subscribeCta: 'Recibir novedades',
    language: 'Idioma',
    follow: 'Síguenos',
    about: 'Acerca de LeonidApp',
    privacy: 'Privacidad',
    cookiePolicy: 'Política de cookies',
    cookieSettings: 'Ajustes de cookies',
    legal: 'Aviso legal',
    dns: 'No vender mi información',
    trademark:
      'LeonidApp es un proyecto de fans, independiente y sin ánimo de lucro. No está afiliado, respaldado ni patrocinado por Rockstar Games ni Take-Two Interactive. Grand Theft Auto, GTA, Vice City y Leonida son marcas registradas de sus respectivos propietarios.',
    openFooter: 'Abrir información legal y enlaces',
    close: 'Cerrar',
    closeFooter: 'Cerrar panel',
    name: 'Nombre',
    email: 'Correo electrónico',
    message: 'Mensaje',
    send: 'Enviar',
    sentContact: 'Mensaje guardado en este dispositivo. Gracias por escribirnos.',
    sentSubscribe: 'Listo: tu preferencia se guardó en este dispositivo.',
    invalidEmail: 'Introduce un correo válido.',
    localNote:
      'Este formulario funciona en local: los datos se guardan solo en tu navegador y no se envían a ningún servidor.',
    subscribeText: 'Deja tu correo para recibir las novedades de LeonidApp cuando estén disponibles.',
    contactText: 'Cuéntanos tu duda, error o sugerencia sobre LeonidApp.',
    necessary: 'Necesarias',
    necessaryText: 'Imprescindibles para el funcionamiento (sesión, seguridad, esta preferencia). Siempre activas.',
    analytics: 'Analíticas',
    analyticsText: 'Nos ayudan a entender cómo se usa la aplicación, de forma agregada.',
    preferences: 'Preferencias',
    preferencesText: 'Recuerdan ajustes como el idioma o la última sección visitada.',
    marketing: 'Marketing',
    marketingText: 'Permitirían mostrar contenido promocional. LeonidApp no los usa actualmente.',
    save: 'Guardar selección',
    acceptAll: 'Aceptar todo',
    rejectAll: 'Rechazar opcionales',
    cookiesIntro: 'Elige qué categorías de cookies y almacenamiento local permites. Puedes cambiarlo cuando quieras.',
    alwaysOn: 'Siempre activas',
  },
  en: {
    contact: 'Contact',
    collaborate: 'Collaborate',
    community: 'Community Resources',
    subscribe: 'Subscribe',
    contribute: 'Contributions & moderation',
    forum: 'Community forum',
    catalog: 'Leonida catalog',
    contactCta: 'Write to us',
    subscribeCta: 'Get updates',
    language: 'Language',
    follow: 'Follow us',
    about: 'About LeonidApp',
    privacy: 'Privacy',
    cookiePolicy: 'Cookie Policy',
    cookieSettings: 'Cookie Settings',
    legal: 'Legal',
    dns: 'Do Not Sell My Information',
    trademark:
      'LeonidApp is an independent, non-profit fan project. It is not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive. Grand Theft Auto, GTA, Vice City and Leonida are trademarks of their respective owners.',
    openFooter: 'Open legal information and links',
    close: 'Close',
    closeFooter: 'Close panel',
    name: 'Name',
    email: 'Email',
    message: 'Message',
    send: 'Send',
    sentContact: 'Message saved on this device. Thanks for writing to us.',
    sentSubscribe: 'Done: your preference was saved on this device.',
    invalidEmail: 'Enter a valid email.',
    localNote:
      'This form works locally: data is stored only in your browser and is not sent to any server.',
    subscribeText: 'Leave your email to receive LeonidApp news when they become available.',
    contactText: 'Tell us about a question, bug or suggestion regarding LeonidApp.',
    necessary: 'Necessary',
    necessaryText: 'Required for the app to work (session, security, this preference). Always on.',
    analytics: 'Analytics',
    analyticsText: 'Help us understand how the app is used, in aggregate form.',
    preferences: 'Preferences',
    preferencesText: 'Remember settings such as language or the last section you visited.',
    marketing: 'Marketing',
    marketingText: 'Would allow promotional content. LeonidApp does not currently use them.',
    save: 'Save selection',
    acceptAll: 'Accept all',
    rejectAll: 'Reject optional',
    cookiesIntro: 'Choose which categories of cookies and local storage you allow. You can change this at any time.',
    alwaysOn: 'Always on',
  },
};

const DOCS: Record<Lang, Record<DocId, { title: string; body: string[] }>> = {
  es: {
    about: {
      title: 'Acerca de LeonidApp',
      body: [
        'LeonidApp es un atlas interactivo creado por y para fans: mapa de Leonida, catálogo de ubicaciones y elementos, foro de la comunidad y seguimiento de tu progreso.',
        'Es un proyecto independiente y sin ánimo de lucro. NO está afiliado, respaldado ni patrocinado por Rockstar Games ni por Take-Two Interactive Software, Inc.',
        'Todo el contenido proviene de la comunidad y de información pública. Si eres titular de derechos y deseas que retiremos algo, usa el formulario de contacto.',
      ],
    },
    privacy: {
      title: 'Política de privacidad',
      body: [
        'Datos que tratamos: los de tu cuenta si inicias sesión (identificador, nombre de usuario, correo del proveedor de acceso), tu progreso, tus aportes y tus mensajes del foro. Como invitado, tu progreso se guarda solo en tu dispositivo.',
        'Finalidad: ofrecer las funciones de la aplicación, mantener la seguridad y moderar la comunidad. No vendemos tus datos ni los usamos para publicidad personalizada.',
        'Conservación y derechos: conservamos los datos mientras mantengas la cuenta. Puedes solicitar acceso, rectificación o eliminación a través del formulario de contacto.',
        'Terceros: el inicio de sesión con Google, Discord o Apple está sujeto a las políticas de cada proveedor.',
      ],
    },
    cookiePolicy: {
      title: 'Política de cookies',
      body: [
        'Usamos cookies y almacenamiento local. Necesarias: mantienen la sesión y la seguridad. Preferencias: idioma, progreso de invitado y ajustes. Analíticas y Marketing: desactivadas por defecto y solo se activarían con tu consentimiento.',
        'Puedes cambiar tu elección en cualquier momento desde "Ajustes de cookies". También puedes borrar los datos desde la configuración de tu navegador.',
      ],
    },
    legal: {
      title: 'Aviso legal',
      body: [
        'LeonidApp es un proyecto de fans no oficial. No está afiliado, respaldado ni patrocinado por Rockstar Games ni por Take-Two Interactive. Grand Theft Auto, GTA, Vice City, Leonida y las marcas, logotipos e imágenes relacionados pertenecen a sus respectivos propietarios y se mencionan solo con fines informativos.',
        'El servicio se ofrece "tal cual", sin garantías. Los aportes de los usuarios son responsabilidad de quien los publica; nos reservamos el derecho de moderarlos o retirarlos.',
      ],
    },
    dns: {
      title: 'No vender ni compartir mi información',
      body: [
        'LeonidApp no vende ni comparte tu información personal con terceros con fines de publicidad conductual.',
        'Si en el futuro cambiara, respetaremos tu derecho a oponerte. Mientras tanto, mantén desactivada la categoría "Marketing" en Ajustes de cookies, y escríbenos desde el formulario de contacto si quieres ejercer tus derechos.',
      ],
    },
  },
  en: {
    about: {
      title: 'About LeonidApp',
      body: [
        'LeonidApp is an interactive atlas made by and for fans: a map of Leonida, a catalog of locations and items, a community forum and progress tracking.',
        'It is an independent, non-profit project. It is NOT affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive Software, Inc.',
        'All content comes from the community and public information. If you are a rights holder and want something removed, please use the contact form.',
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      body: [
        'Data we process: your account data if you sign in (identifier, username, email from the sign-in provider), your progress, contributions and forum posts. As a guest, your progress stays on your device only.',
        'Purpose: to provide the app features, keep it secure and moderate the community. We do not sell your data nor use it for personalized advertising.',
        'Retention and rights: we keep data while your account exists. You can request access, correction or deletion through the contact form.',
        'Third parties: signing in with Google, Discord or Apple is subject to each provider\'s policies.',
      ],
    },
    cookiePolicy: {
      title: 'Cookie Policy',
      body: [
        'We use cookies and local storage. Necessary: keep your session and security. Preferences: language, guest progress and settings. Analytics and Marketing: off by default and only enabled with your consent.',
        'You can change your choice at any time from "Cookie Settings". You can also clear data from your browser settings.',
      ],
    },
    legal: {
      title: 'Legal',
      body: [
        'LeonidApp is an unofficial fan project. It is not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive. Grand Theft Auto, GTA, Vice City, Leonida and related trademarks, logos and images belong to their respective owners and are mentioned for informational purposes only.',
        'The service is provided "as is", without warranties. User contributions are the responsibility of whoever posts them; we reserve the right to moderate or remove them.',
      ],
    },
    dns: {
      title: 'Do Not Sell or Share My Information',
      body: [
        'LeonidApp does not sell or share your personal information with third parties for behavioral advertising.',
        'Should this ever change, we will honor your right to opt out. Meanwhile, keep the "Marketing" category off in Cookie Settings, and write to us through the contact form to exercise your rights.',
      ],
    },
  },
};

/* ------------------------------------------------------------------ */
/* Iconos sociales (SVG propios; genérico = enlace)                    */
/* ------------------------------------------------------------------ */

function SocialIcon({ platform }: { platform: string }) {
  const p = platform.trim().toLowerCase();
  const common = {
    'aria-hidden': true as const,
    focusable: 'false' as const,
    viewBox: '0 0 24 24',
    width: 20,
    height: 20,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (p === 'x' || p === 'twitter')
    return (
      <svg {...common}>
        <path d="M4 4l16 16M20 4L4 20" />
      </svg>
    );
  if (p === 'instagram')
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" />
      </svg>
    );
  if (p === 'youtube')
    return (
      <svg {...common}>
        <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
        <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
      </svg>
    );
  if (p === 'facebook')
    return (
      <svg {...common}>
        <path d="M14.5 21v-8h2.7l.5-3.2h-3.2V7.9c0-.9.4-1.7 1.8-1.7h1.5V3.4S16.5 3 15.2 3C12.6 3 11 4.600 11 7.400v2.400H8.300V13H11v8" />
      </svg>
    );
  if (p === 'discord')
    return (
      <svg {...common}>
        <path d="M7 6.500C9.500 5.500 14.500 5.500 17 6.500c1.700 2.700 2.500 5.300 2.700 8.200-1.300 1-2.700 1.600-4.200 1.900l-1-1.800M17 6.500M7 6.500C5.300 9.200 4.500 11.800 4.300 14.700c1.300 1 2.700 1.600 4.200 1.900l1-1.800" />
        <circle cx="9.200" cy="12" r="1" fill="currentColor" />
        <circle cx="14.800" cy="12" r="1" fill="currentColor" />
      </svg>
    );
  if (p === 'twitch')
    return (
      <svg {...common}>
        <path d="M4 3h16v11l-4 4h-4l-3 3v-3H4z" />
        <path d="M11 7.500v4M15 7.500v4" />
      </svg>
    );
  if (p === 'tiktok')
    return (
      <svg {...common}>
        <path d="M14 3v11.500a3.500 3.500 0 11-3.500-3.500M14 3c.3 2.500 1.900 4 4.500 4.200" />
      </svg>
    );
  if (p === 'reddit')
    return (
      <svg {...common}>
        <ellipse cx="12" cy="14" rx="8" ry="5.500" />
        <circle cx="9.200" cy="13.500" r="1" fill="currentColor" />
        <circle cx="14.800" cy="13.500" r="1" fill="currentColor" />
        <path d="M12 8.500l1-4.500 4 1M9.500 16.500c1.500 1 3.500 1 5 0" />
      </svg>
    );
  // Genérico: enlace
  return (
    <svg {...common}>
      <path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1" />
      <path d="M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1" />
    </svg>
  );
}

interface SocialLink {
  platform: string;
  url: string;
}

function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function useSocialLinks(): SocialLink[] {
  const [links, setLinks] = useState<SocialLink[]>([]);
  useEffect(() => {
    if (!isApiConfigured) return;
    let alive = true;
    apiFetch<{ social_links?: unknown }>('/api/config/public')
      .then((cfg) => {
        if (!alive || !Array.isArray(cfg?.social_links)) return;
        const out: SocialLink[] = [];
        for (const item of cfg.social_links as Array<Record<string, unknown>>) {
          const url = safeHttpUrl(item?.url);
          if (url && typeof item.platform === 'string' && item.platform.trim()) {
            out.push({ platform: item.platform.trim().slice(0, 30), url });
          }
        }
        setLinks(out);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return links;
}

/* ------------------------------------------------------------------ */
/* Modal accesible (foco atrapado, Esc cierra)                         */
/* ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function Modal({
  title,
  onClose,
  closeLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    node?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div aria-hidden="true" className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-2xl border border-white/20 bg-black text-white outline-none sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/15 px-5 py-3">
          <h2 id={titleId} className="font-display text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-[calc(1.25rem+var(--safe-bottom))] text-sm leading-relaxed text-white/90">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formularios y ajustes de cookies                                    */
/* ------------------------------------------------------------------ */

const FIELD =
  'min-h-[44px] w-full rounded-lg border border-white/30 bg-black px-3 py-2 text-white placeholder:text-white/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
const BTN =
  'inline-flex min-h-[44px] items-center justify-center rounded-lg px-5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold';
const BTN_PRIMARY = `${BTN} bg-white text-black hover:bg-white/85`;
const BTN_GHOST = `${BTN} border border-white/50 text-white hover:bg-white/15`;

function LocalForm({ kind, t }: { kind: 'contact' | 'subscribe'; t: Dict }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      setError(t.invalidEmail);
      return;
    }
    const name = String(fd.get('name') ?? '').trim().slice(0, 80);
    const message = String(fd.get('message') ?? '').trim().slice(0, 1000);
    const key = kind === 'contact' ? CONTACT_KEY : SUB_KEY;
    let list: unknown[] = [];
    try {
      const parsed: unknown = JSON.parse(readStore(key) ?? '[]');
      if (Array.isArray(parsed)) list = parsed.slice(-19);
    } catch {
      list = [];
    }
    list.push({ at: new Date().toISOString(), name, email, message });
    writeStore(key, JSON.stringify(list));
    setError('');
    setDone(true);
  };
  if (done) {
    return (
      <p role="status" className="font-semibold text-white">
        {kind === 'contact' ? t.sentContact : t.sentSubscribe}
      </p>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <p>{kind === 'contact' ? t.contactText : t.subscribeText}</p>
      {kind === 'contact' && (
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide">
          {t.name}
          <input name="name" maxLength={80} autoComplete="name" className={FIELD} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide">
        {t.email}
        <input name="email" type="email" required maxLength={120} autoComplete="email" className={FIELD} />
      </label>
      {kind === 'contact' && (
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide">
          {t.message}
          <textarea name="message" rows={4} maxLength={1000} className={FIELD} />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-[#FF8FB0]">
          {error}
        </p>
      )}
      <p className="text-xs text-white/70">{t.localNote}</p>
      <button type="submit" className={`${BTN_PRIMARY} self-start`}>
        {t.send}
      </button>
    </form>
  );
}

interface CookiePrefs {
  analytics: boolean;
  preferences: boolean;
  marketing: boolean;
}

function loadCookiePrefs(): CookiePrefs {
  try {
    const raw = readStore(COOKIE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<CookiePrefs>;
      return { analytics: p.analytics === true, preferences: p.preferences === true, marketing: p.marketing === true };
    }
  } catch {
    /* JSON inválido: valores por defecto */
  }
  return { analytics: false, preferences: false, marketing: false };
}

function CookieSettings({ t, onDone }: { t: Dict; onDone: () => void }) {
  const [prefs, setPrefs] = useState<CookiePrefs>(loadCookiePrefs);
  const persist = (p: CookiePrefs) => {
    writeStore(COOKIE_KEY, JSON.stringify({ necessary: true, ...p, decidedAt: new Date().toISOString() }));
    onDone();
  };
  const rows: Array<{ key: keyof CookiePrefs; label: string; text: string }> = [
    { key: 'analytics', label: t.analytics, text: t.analyticsText },
    { key: 'preferences', label: t.preferences, text: t.preferencesText },
    { key: 'marketing', label: t.marketing, text: t.marketingText },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p>{t.cookiesIntro}</p>
      <div className="flex items-start justify-between gap-4 border-b border-white/15 pb-3">
        <div>
          <p className="font-bold">{t.necessary}</p>
          <p className="text-xs text-white/75">{t.necessaryText}</p>
        </div>
        <span className="shrink-0 text-xs font-semibold uppercase text-white/70">{t.alwaysOn}</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-start justify-between gap-4 border-b border-white/15 pb-3">
          <div>
            <p className="font-bold">{r.label}</p>
            <p className="text-xs text-white/75">{r.text}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs[r.key]}
            aria-label={r.label}
            onClick={() => setPrefs((p) => ({ ...p, [r.key]: !p[r.key] }))}
            className={`relative h-11 w-14 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold`}
          >
            <span
              aria-hidden="true"
              className={`absolute left-0 top-1/2 h-7 w-14 -translate-y-1/2 rounded-full transition-colors ${
                prefs[r.key] ? 'bg-[#E1307E]' : 'bg-white/30'
              }`}
            />
            <span
              aria-hidden="true"
              className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white transition-all ${
                prefs[r.key] ? 'left-[32px]' : 'left-[4px]'
              }`}
            />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={() => persist(prefs)}>
          {t.save}
        </button>
        <button
          type="button"
          className={BTN_GHOST}
          onClick={() => persist({ analytics: true, preferences: true, marketing: true })}
        >
          {t.acceptAll}
        </button>
        <button
          type="button"
          className={BTN_GHOST}
          onClick={() => persist({ analytics: false, preferences: false, marketing: false })}
        >
          {t.rejectAll}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contenido del footer                                                */
/* ------------------------------------------------------------------ */

const LINK =
  'inline-flex min-h-[44px] items-center text-sm text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold md:min-h-[32px]';

function FooterBody({
  lang,
  setLang,
  t,
  open,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Dict;
  open: (m: ModalId) => void;
}) {
  const socials = useSocialLinks();
  const legalLinks: Array<{ id: ModalId; label: string }> = [
    { id: 'about', label: t.about },
    { id: 'privacy', label: t.privacy },
    { id: 'cookiePolicy', label: t.cookiePolicy },
    { id: 'cookies', label: t.cookieSettings },
    { id: 'legal', label: t.legal },
    { id: 'dns', label: t.dns },
  ];
  const colTitle = 'mb-1 font-display text-sm font-bold uppercase tracking-widest text-white';
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <nav aria-label={t.contact} className="flex flex-col items-start">
          <h2 className={colTitle}>{t.contact}</h2>
          <button type="button" className={LINK} onClick={() => open('contact')}>
            {t.contactCta}
          </button>
        </nav>
        <nav aria-label={t.collaborate} className="flex flex-col items-start">
          <h2 className={colTitle}>{t.collaborate}</h2>
          <a className={LINK} href="#/aportes">
            {t.contribute}
          </a>
        </nav>
        <nav aria-label={t.community} className="flex flex-col items-start">
          <h2 className={colTitle}>{t.community}</h2>
          <a className={LINK} href="#/foro">
            {t.forum}
          </a>
          <a className={LINK} href="#/catalogo">
            {t.catalog}
          </a>
        </nav>
        <nav aria-label={t.subscribe} className="flex flex-col items-start">
          <h2 className={colTitle}>{t.subscribe}</h2>
          <button type="button" className={LINK} onClick={() => open('subscribe')}>
            {t.subscribeCta}
          </button>
        </nav>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/20 pt-5">
        {socials.length > 0 ? (
          <ul aria-label={t.follow} className="m-0 flex list-none flex-wrap gap-1 p-0">
            {socials.map((s) => (
              <li key={`${s.platform}-${s.url}`}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.platform}
                  title={s.platform}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  <SocialIcon platform={s.platform} />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <div role="group" aria-label={t.language} className="flex items-center gap-1 text-sm">
          <span className="mr-1 text-white/80">{t.language}</span>
          {(['es', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={`min-h-[44px] min-w-[44px] rounded-lg px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-vice-gold ${
                lang === l ? 'bg-white text-black' : 'border border-white/40 text-white hover:bg-white/15'
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <ul className="m-0 mt-4 flex list-none flex-wrap gap-x-5 p-0">
        {legalLinks.map((l) => (
          <li key={l.id}>
            <button type="button" className={LINK} onClick={() => open(l.id)}>
              {l.label}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-white/75">{t.trademark}</p>
      <p className="mt-2 text-xs text-white/75">&copy; {new Date().getFullYear()} LeonidApp</p>
    </div>
  );
}

export interface FooterProps {
  variant?: 'full' | 'compact';
}

export function Footer({ variant = 'full' }: FooterProps) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = readStore(LANG_KEY);
    if (saved === 'es' || saved === 'en') return saved;
    return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
  });
  const [modal, setModal] = useState<ModalId | null>(null);
  const [panel, setPanel] = useState(false);
  const t = DICT[lang];
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const modalOpenRef = useRef(false);
  modalOpenRef.current = modal !== null;

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writeStore(LANG_KEY, l);
  }, []);

  // Esc cierra el panel compacto (si no hay modal encima) y se bloquea el scroll de fondo ausente de efectos.
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !modalOpenRef.current) setPanel(false);
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [panel]);

  const modalNode = modal && (
    <Modal
      title={
        modal === 'cookies'
          ? t.cookieSettings
          : modal === 'contact'
            ? t.contact
            : modal === 'subscribe'
              ? t.subscribe
              : DOCS[lang][modal].title
      }
      closeLabel={t.close}
      onClose={() => setModal(null)}
    >
      {modal === 'cookies' ? (
        <CookieSettings t={t} onDone={() => setModal(null)} />
      ) : modal === 'contact' || modal === 'subscribe' ? (
        <LocalForm kind={modal} t={t} />
      ) : (
        <div className="flex flex-col gap-3">
          {DOCS[lang][modal].body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
    </Modal>
  );

  if (variant === 'compact') {
    return (
      <>
        <div className="relative z-20 flex shrink-0 items-center justify-start bg-black px-3 md:px-6">
          <button
            type="button"
            aria-expanded={panel}
            aria-controls={panelId}
            aria-label={t.openFooter}
            onClick={() => setPanel((v) => !v)}
            className="flex min-h-[44px] items-center gap-2 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-vice-gold md:min-h-[28px]"
          >
            <span>&copy; LeonidApp</span>
            <span aria-hidden="true">{panel ? '▼' : '▲'}</span>
          </button>
        </div>
        {panel && (
          <div className="fixed inset-0 z-[60]">
            <div aria-hidden="true" className="absolute inset-0 bg-black/60" onClick={() => setPanel(false)} />
            <div
              id={panelId}
              ref={panelRef}
              role="region"
              aria-label="LeonidApp"
              tabIndex={-1}
              className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-white/20 bg-black pb-[var(--safe-bottom)] text-white outline-none"
            >
              <div className="sticky top-0 z-10 flex justify-end bg-black px-3 pt-2">
                <button
                  type="button"
                  aria-label={t.closeFooter}
                  onClick={() => setPanel(false)}
                  className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-vice-gold"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <FooterBody lang={lang} setLang={setLang} t={t} open={setModal} />
            </div>
          </div>
        )}
        {modalNode}
      </>
    );
  }

  return (
    <>
      <footer className="relative z-20 shrink-0 bg-black pl-safe pr-safe text-white" aria-label="LeonidApp">
        <FooterBody lang={lang} setLang={setLang} t={t} open={setModal} />
      </footer>
      {modalNode}
    </>
  );
}

export default Footer;
