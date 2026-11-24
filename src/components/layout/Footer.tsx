import { FEATURES } from '../../data/v1';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { ApiError, apiFetch } from '../../store/useAuthStore';
import { usePublicConfig } from '../../data/seed';

/* ------------------------------------------------------------------ */
/* Footer estilo Rockstar (pilar 6): negro puro, enlaces funcionales,  */
/* idioma ES/EN, redes desde AppConfig, legales y Cookie Settings.     */
/* ------------------------------------------------------------------ */

type Lang = 'es' | 'en';
type DocId = 'about';
type ModalId = DocId | 'cookies' | 'contact' | 'subscribe';

/** Asunto del formulario de Contacto. El contrato de /api/contact solo admite { email, message, website }:
 *  el asunto viaja como prefijo estándar al inicio del mensaje, p. ej. «[Retirada de contenido] ». */
export type ContactSubject = 'general' | 'takedown' | 'privacy';
export const OPEN_CONTACT_EVENT = 'leonidapp:open-contact';
const SUBJECT_PREFIX: Record<ContactSubject, string> = {
  general: '',
  takedown: '[Retirada de contenido] ',
  privacy: '[Privacidad y datos] ',
};

/** Abre el formulario de Contacto del pie de página (lo usan las páginas legales). */
export function openContactForm(subject: ContactSubject = 'general'): void {
  window.dispatchEvent(new CustomEvent<ContactSubject>(OPEN_CONTACT_EVENT, { detail: subject }));
}

const LANG_COOKIE = 'leonidapp_lang';
const CONSENT_COOKIE = 'leonidapp_consent';
const CONSENT_VERSION = 1;
const LEGACY_LANG_KEY = 'leonidapp.lang';
const LEGACY_CONSENT_KEY = 'leonidapp.cookies';

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) {
      try {
        return decodeURIComponent(part.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  if (name === CONSENT_COOKIE) window.dispatchEvent(new Event('leonidapp:consent'));
}

/** Migración única: copia las claves antiguas de localStorage a cookies y las borra. */
function migrateLegacyStorage(): void {
  try {
    const legacyLang = window.localStorage.getItem(LEGACY_LANG_KEY);
    if (legacyLang !== null) {
      if (readCookie(LANG_COOKIE) === null && (legacyLang === 'es' || legacyLang === 'en')) {
        writeCookie(LANG_COOKIE, legacyLang);
      }
      window.localStorage.removeItem(LEGACY_LANG_KEY);
    }
    const legacyConsent = window.localStorage.getItem(LEGACY_CONSENT_KEY);
    if (legacyConsent !== null) {
      if (readCookie(CONSENT_COOKIE) === null) {
        const p = JSON.parse(legacyConsent) as Partial<CookiePrefs>;
        writeCookie(
          CONSENT_COOKIE,
          JSON.stringify({
            necessary: true,
            preferences: p.preferences === true,
            analytics: p.analytics === true,
            marketing: p.marketing === true,
            version: CONSENT_VERSION,
            date: new Date().toISOString(),
          }),
        );
      }
      window.localStorage.removeItem(LEGACY_CONSENT_KEY);
    }
  } catch {
    /* almacenamiento no disponible o JSON inválido: se ignora */
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
  guides: string;
  news: string;
  contactCta: string;
  subscribeCta: string;
  language: string;
  follow: string;
  about: string;
  privacy: string;
  cookiePolicy: string;
  cookieSettings: string;
  terms: string;
  trademarks: string;
  takedown: string;
  dns: string;
  subject: string;
  subjectGeneral: string;
  subjectTakedown: string;
  subjectPrivacy: string;
  trademark: string;
  close: string;
  email: string;
  message: string;
  send: string;
  sentContact: string;
  sentSubscribe: string;
  invalidEmail: string;
  sending: string;
  messageLength: string;
  networkError: string;
  sendError: string;
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
    contribute: 'Aportar',
    forum: 'Foro de la comunidad',
    catalog: 'Catálogo de Leonida',
    guides: 'Guías',
    news: 'Noticias oficiales',
    contactCta: 'Escríbenos',
    subscribeCta: 'Recibir novedades',
    language: 'Idioma',
    follow: 'Síguenos',
    about: 'Acerca de LeonidApp',
    privacy: 'Privacidad',
    cookiePolicy: 'Política de cookies',
    cookieSettings: 'Ajustes de cookies',
    terms: 'Términos de uso',
    trademarks: 'Marcas y propiedad intelectual',
    takedown: 'Retirada de contenido',
    dns: 'No vender mi información',
    subject: 'Asunto',
    subjectGeneral: 'Consulta general',
    subjectTakedown: 'Retirada de contenido',
    subjectPrivacy: 'Privacidad y datos',
    trademark:
      'LeonidApp es un proyecto de fans, independiente y sin ánimo de lucro. No está afiliado, respaldado ni patrocinado por Rockstar Games ni Take-Two Interactive. Grand Theft Auto, GTA, Vice City y Leonida son marcas registradas de sus respectivos propietarios.',
    close: 'Cerrar',
    email: 'Correo electrónico',
    message: 'Mensaje',
    send: 'Enviar',
    sentContact: 'Mensaje enviado. Gracias por escribirnos.',
    sending: 'Enviando...',
    messageLength: 'El mensaje debe tener entre 10 y 2000 caracteres.',
    networkError: 'Sin conexión con el servidor. Inténtalo de nuevo.',
    sendError: 'No se pudo enviar. Inténtalo de nuevo más tarde.',
    sentSubscribe: 'Listo: te has suscrito a las novedades de LeonidApp.',
    invalidEmail: 'Introduce un correo válido.',
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
    contribute: 'Contribute',
    forum: 'Community forum',
    catalog: 'Leonida catalog',
    guides: 'Guides',
    news: 'Official news',
    contactCta: 'Write to us',
    subscribeCta: 'Get updates',
    language: 'Language',
    follow: 'Follow us',
    about: 'About LeonidApp',
    privacy: 'Privacy',
    cookiePolicy: 'Cookie Policy',
    cookieSettings: 'Cookie Settings',
    terms: 'Terms of Use',
    trademarks: 'Trademarks and IP',
    takedown: 'Content takedown',
    dns: 'Do Not Sell My Information',
    subject: 'Subject',
    subjectGeneral: 'General inquiry',
    subjectTakedown: 'Content takedown',
    subjectPrivacy: 'Privacy and data',
    trademark:
      'LeonidApp is an independent, non-profit fan project. It is not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive. Grand Theft Auto, GTA, Vice City and Leonida are trademarks of their respective owners.',
    close: 'Close',
    email: 'Email',
    message: 'Message',
    send: 'Send',
    sentContact: 'Message sent. Thanks for writing to us.',
    sending: 'Sending...',
    messageLength: 'The message must be between 10 and 2000 characters.',
    networkError: 'No connection to the server. Please try again.',
    sendError: 'Could not send. Please try again later.',
    sentSubscribe: 'Done: you are subscribed to LeonidApp news.',
    invalidEmail: 'Enter a valid email.',
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
        'LeonidApp es un atlas interactivo creado por y para fans: mapa de Leonida, catálogo de fichas, foro de la comunidad y seguimiento de tu avance.',
        'Es un proyecto independiente y sin ánimo de lucro. NO está afiliado, respaldado ni patrocinado por Rockstar Games ni por Take-Two Interactive Software, Inc.',
        'Todo el contenido proviene de la comunidad y de información pública. Si eres titular de derechos y deseas que retiremos algo, consulta la página «Retirada de contenido».',
      ],
    },
  },
  en: {
    about: {
      title: 'About LeonidApp',
      body: [
        'LeonidApp is an interactive atlas made by and for fans: a map of Leonida, a catalog of locations and items, a community forum and progress tracking.',
        'It is an independent, non-profit project. It is NOT affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive Software, Inc.',
        'All content comes from the community and public information. If you are a rights holder and want something removed, see the "Content takedown" page (in Spanish).',
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

/** Enlaces sociales de la configuración pública (consulta compartida: una sola petición a /api/config/public). */
function useSocialLinks(): SocialLink[] {
  const cfg = usePublicConfig();
  return useMemo(() => {
    const out: SocialLink[] = [];
    for (const item of cfg.social_links as Array<Record<string, unknown>>) {
      const url = safeHttpUrl(item?.url);
      if (url && typeof item.platform === 'string' && item.platform.trim()) {
        out.push({ platform: item.platform.trim().slice(0, 30), url });
      }
    }
    return out;
  }, [cfg.social_links]);
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

function ApiForm({
  kind,
  t,
  lang,
  initialSubject = 'general',
}: {
  kind: 'contact' | 'subscribe';
  t: Dict;
  lang: Lang;
  initialSubject?: ContactSubject;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === 'loading') return;
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      setError(t.invalidEmail);
      setState('error');
      return;
    }
    const typed = String(fd.get('message') ?? '').trim();
    const subjectRaw = String(fd.get('subject') ?? 'general');
    const subject: ContactSubject = subjectRaw === 'takedown' || subjectRaw === 'privacy' ? subjectRaw : 'general';
    // Contrato de la API intacto: el asunto se antepone al mensaje como prefijo estándar.
    const message = `${SUBJECT_PREFIX[subject]}${typed}`;
    const website = String(fd.get('website') ?? '');
    if (kind === 'contact' && (typed.length < 10 || message.length > 2000)) {
      setError(t.messageLength);
      setState('error');
      return;
    }
    setError('');
    setState('loading');
    try {
      await apiFetch<{ ok: boolean }>(kind === 'contact' ? '/api/contact' : '/api/subscribe', {
        method: 'POST',
        json: kind === 'contact' ? { email, message, website } : { email, locale: lang, website },
      });
      setState('done');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0 ? t.networkError : t.sendError);
      setState('error');
    }
  };
  if (state === 'done') {
    return (
      <p role="status" className="font-semibold text-white">
        {kind === 'contact' ? t.sentContact : t.sentSubscribe}
      </p>
    );
  }
  const loading = state === 'loading';
  return (
    <form onSubmit={submit} noValidate aria-busy={loading} className="relative flex flex-col gap-3">
      <p>{kind === 'contact' ? t.contactText : t.subscribeText}</p>
      <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide">
        {t.email}
        <input name="email" type="email" required maxLength={254} autoComplete="email" className={FIELD} />
      </label>
      {kind === 'contact' && (
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide">
          {t.subject}
          <select name="subject" defaultValue={initialSubject} className={FIELD}>
            <option value="general">{t.subjectGeneral}</option>
            <option value="takedown">{t.subjectTakedown}</option>
            <option value="privacy">{t.subjectPrivacy}</option>
          </select>
        </label>
      )}
      {kind === 'contact' && (
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide">
          {t.message}
          <textarea name="message" required rows={4} minLength={10} maxLength={2000} className={FIELD} />
        </label>
      )}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <div aria-live="assertive">
        {error && (
          <p role="alert" className="text-sm font-semibold text-[#FF8FB0]">
            {error}
          </p>
        )}
      </div>
      <button type="submit" disabled={loading} className={`${BTN_PRIMARY} self-start disabled:opacity-60`}>
        {loading ? t.sending : t.send}
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
    const raw = readCookie(CONSENT_COOKIE);
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
    writeCookie(
      CONSENT_COOKIE,
      JSON.stringify({ necessary: true, ...p, version: CONSENT_VERSION, date: new Date().toISOString() }),
    );
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

/** Panel de decisión de cookies para la página /legal/cookies (mismo `leonidapp_consent` que el modal del pie). */
export function CookiePreferencesPanel() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="rounded-2xl bg-black p-5 text-white">
      <div aria-live="polite">
        {saved && (
          <p role="status" className="mb-3 font-semibold">
            Tu decisión se ha guardado.
          </p>
        )}
      </div>
      <CookieSettings t={DICT.es} onDone={() => setSaved(true)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contenido del footer                                                */
/* ------------------------------------------------------------------ */

const LINK =
  'inline-flex min-h-[44px] min-w-[44px] items-center text-sm text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold md:min-h-[32px]';

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
  // Legales: cada enlace lleva a una pantalla real (/legal/*); «Acerca de» y «Ajustes de cookies» abren modal.
  const legalPages: Array<{ href: string; label: string }> = [
    { href: '/legal/privacidad', label: t.privacy },
    { href: '/legal/cookies', label: t.cookiePolicy },
    { href: '/legal/terminos', label: t.terms },
    { href: '/legal/marcas', label: t.trademarks },
    { href: '/legal/retirada', label: t.takedown },
    { href: '/legal/privacidad', label: t.dns },
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
        {FEATURES.contribute && (
          <nav aria-label={t.collaborate} className="flex flex-col items-start">
            <h2 className={colTitle}>{t.collaborate}</h2>
            <a className={LINK} href="/aportar">
              {t.contribute}
            </a>
          </nav>
        )}
        <nav aria-label={t.community} className="flex flex-col items-start">
          <h2 className={colTitle}>{t.community}</h2>
          {FEATURES.forum && (
            <a className={LINK} href="/foro">
              {t.forum}
            </a>
          )}
          <a className={LINK} href="/catalogo">
            {t.catalog}
          </a>
          <a className={LINK} href="/guias">
            {t.guides}
          </a>
          <a className={LINK} href="/noticias">
            {t.news}
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

      <ul aria-label="Legal" className="m-0 mt-4 flex list-none flex-wrap gap-x-5 p-0">
        <li>
          <button type="button" className={LINK} onClick={() => open('about')}>
            {t.about}
          </button>
        </li>
        {legalPages.map((l) => (
          <li key={l.label}>
            <a className={LINK} href={l.href}>
              {l.label}
            </a>
          </li>
        ))}
        <li>
          <button type="button" className={LINK} onClick={() => open('cookies')}>
            {t.cookieSettings}
          </button>
        </li>
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-white/75">{t.trademark}</p>
      <p className="mt-2 text-xs text-white/75">&copy; {new Date().getFullYear()} LeonidApp</p>
    </div>
  );
}

/** RockstarFooter: único pie de página, solo al final de las páginas con scroll. */
export function RockstarFooter() {
  const [lang, setLangState] = useState<Lang>(() => {
    migrateLegacyStorage();
    const saved = readCookie(LANG_COOKIE);
    if (saved === 'es' || saved === 'en') return saved;
    return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
  });
  const [modal, setModal] = useState<ModalId | null>(null);
  const [subject, setSubject] = useState<ContactSubject>('general');
  const t = DICT[lang];

  // Las páginas legales abren el formulario de Contacto con el asunto preseleccionado.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<ContactSubject>).detail;
      setSubject(d === 'takedown' || d === 'privacy' ? d : 'general');
      setModal('contact');
    };
    window.addEventListener(OPEN_CONTACT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONTACT_EVENT, onOpen);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writeCookie(LANG_COOKIE, l);
  }, []);

  const modalNode = modal && (
    <Modal
      open
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
        <ApiForm kind={modal} t={t} lang={lang} initialSubject={modal === 'contact' ? subject : 'general'} />
      ) : (
        <div className="flex flex-col gap-3">
          {DOCS[lang][modal].body.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
    </Modal>
  );

  return (
    <>
      <footer className="relative z-20 shrink-0 bg-black pl-safe pr-safe text-white" aria-label="LeonidApp">
        <FooterBody lang={lang} setLang={setLang} t={t} open={(m) => {
          if (m === 'contact') setSubject('general');
          setModal(m);
        }}
        />
      </footer>
      {modalNode}
    </>
  );
}

export default RockstarFooter;
