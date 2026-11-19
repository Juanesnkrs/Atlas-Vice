import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { usePublicConfig } from '../../data/seed';

/**
 * AdSlot: espacio publicitario reservado (CLS = 0). Ver docs/LeonidApp-Rutas-SEO-Monetizacion.md §6.
 *
 * PROHIBIDO usarlo en: /mapa (HUD 100vh), Inspector HUD y comparador, sobre o cerca del
 * BottomDock / safe-area inferior, ni en /, /entrar, /hub, /progreso, /aportar, modales o Footer.
 * Solo en zonas editoriales con scroll (guías, noticias, ficha de catálogo, foro). Máx. 2 por página.
 *
 * Reglas:
 * - Sin `monetization.ads_enabled === true` (o con provider 'none') devuelve null sin reservar espacio.
 * - El slot se resuelve por `route` (patrón de la ruta actual) + `position`/`slotId`.
 * - Máximo 2 slots visibles por página (registro por instancia).
 * - Sin consentimiento Marketing en la cookie `leonidapp_consent` no se carga ningún script ni se reserva espacio.
 * - Con provider 'adsense' y publisher_id, el script de AdSense se inyecta una sola vez, de forma diferida
 *   (IntersectionObserver, rootMargin 200px), cuando el slot se acerca al viewport.
 */
export type AdPosition = 'in-article' | 'after-content' | 'sidebar';

export interface AdSlotProps {
  position: AdPosition;
  /** id del slot en AppConfig.monetization.slots; si falta se usa el primero activo de esa posición. */
  slotId?: string;
  className?: string;
}

interface SlotCfg {
  id?: string;
  route?: string;
  position?: string;
  width?: number;
  height?: number;
  enabled?: boolean;
}
interface MonetizationCfg {
  ads_enabled?: boolean;
  provider?: string;
  publisher_id?: string | null;
  slots?: SlotCfg[];
}

const FORBIDDEN = /^\/(mapa|hub|progreso|aportar|entrar)(\/|$)/;
const CONSENT_COOKIE = 'leonidapp_consent';
const CONSENT_EVENT = 'leonidapp:consent';
const MAX_ADS_PER_PAGE = 2;
const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

/** Traduce el pathname actual al patrón de ruta usado en `slots[].route`. */
function routePattern(path: string): string | null {
  const seg = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (seg[0] === 'catalogo' && seg.length === 3) return '/catalogo/:modulo/:slug';
  if (seg[0] === 'guias') return seg.length === 1 ? '/guias' : seg.length === 2 ? '/guias/:slug' : null;
  if (seg[0] === 'noticias') return seg.length === 1 ? '/noticias' : seg.length === 2 ? '/noticias/:slug' : null;
  if (seg[0] === 'foro' && seg.length === 1) return '/foro';
  return null;
}

function hasMarketingConsent(): boolean {
  try {
    for (const part of document.cookie.split('; ')) {
      if (part.startsWith(`${CONSENT_COOKIE}=`)) {
        const raw = decodeURIComponent(part.slice(CONSENT_COOKIE.length + 1));
        return (JSON.parse(raw) as { marketing?: unknown }).marketing === true;
      }
    }
  } catch {
    /* cookie ilegible: sin consentimiento */
  }
  return false;
}

/** Registro de slots visibles por pathname (límite por página). */
const claimed = new Map<string, Set<symbol>>();
function claim(path: string, id: symbol): boolean {
  const set = claimed.get(path) ?? new Set<symbol>();
  claimed.set(path, set);
  if (set.has(id)) return true;
  if (set.size >= MAX_ADS_PER_PAGE) return false;
  set.add(id);
  return true;
}
function release(path: string, id: symbol): void {
  const set = claimed.get(path);
  if (!set) return;
  set.delete(id);
  if (set.size === 0) claimed.delete(path);
}

let adsenseLoaded = false;
function loadAdsense(publisherId: string): void {
  if (adsenseLoaded || document.querySelector('script[data-leonidapp-adsense]')) {
    adsenseLoaded = true;
    return;
  }
  adsenseLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.dataset['leonidappAdsense'] = '1';
  s.src = `${ADSENSE_SRC}?client=${encodeURIComponent(publisherId)}`;
  document.head.appendChild(s);
}

export function AdSlot({ position, slotId, className = '' }: AdSlotProps) {
  const cfg = usePublicConfig() as unknown as { monetization?: MonetizationCfg };
  const m = cfg.monetization;
  const ref = useRef<HTMLElement | null>(null);
  const idRef = useRef<symbol>(Symbol('adslot'));
  const [consent, setConsent] = useState<boolean>(() => typeof document !== 'undefined' && hasMarketingConsent());
  const [allowed, setAllowed] = useState(false);

  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const pattern = routePattern(path);
  const enabled =
    !!m && m.ads_enabled === true && m.provider !== 'none' && !Capacitor.isNativePlatform() && !FORBIDDEN.test(path);
  const slot = enabled
    ? (m.slots ?? []).find(
        (s) =>
          s.enabled !== false &&
          (!s.route || s.route === pattern) &&
          (slotId ? s.id === slotId : s.position === position),
      )
    : undefined;
  const valid = !!slot && !!slot.width && !!slot.height && pattern !== null;

  // Consentimiento: se relee cuando el Footer lo cambia o al volver a la pestaña.
  useEffect(() => {
    const sync = () => setConsent(hasMarketingConsent());
    window.addEventListener(CONSENT_EVENT, sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  // Límite de 2 slots visibles por página.
  useEffect(() => {
    if (!valid || !consent) {
      setAllowed(false);
      return;
    }
    const id = idRef.current;
    setAllowed(claim(path, id));
    return () => release(path, id);
  }, [valid, consent, path]);

  // Carga diferida de AdSense (una sola vez) al acercarse al viewport.
  const publisherId = m?.publisher_id?.trim() ?? '';
  const adsense = m?.provider === 'adsense' && publisherId !== '';
  useEffect(() => {
    const el = ref.current;
    if (!allowed || !adsense || !el) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          loadAdsense(publisherId);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [allowed, adsense, publisherId]);

  if (!valid || !consent || !allowed || !slot) return null;

  return (
    <aside
      ref={ref}
      aria-label="Publicidad"
      data-ad-slot={slot.id ?? position}
      className={`glass mx-auto w-full overflow-hidden rounded-2xl ${className}`}
      style={{ maxWidth: slot.width, aspectRatio: `${slot.width} / ${slot.height}`, minHeight: slot.height }}
    >
      <p className="m-0 px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-vice-text/70">
        Publicidad
      </p>
    </aside>
  );
}

export default AdSlot;
