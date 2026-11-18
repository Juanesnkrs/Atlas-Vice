import { Capacitor } from '@capacitor/core';
import { usePublicConfig } from '../../data/seed';

/**
 * AdSlot: espacio publicitario reservado (CLS = 0). Ver docs/LeonidApp-Rutas-SEO-Monetizacion.md §6.
 *
 * PROHIBIDO usarlo en: /mapa (HUD 100vh), Inspector HUD y comparador, sobre o cerca del
 * BottomDock / safe-area inferior, ni en /, /entrar, /hub, /progreso, /aportar, modales o Footer.
 * Solo en zonas editoriales con scroll (guías, noticias, ficha de catálogo, foro). Máx. 2 por página.
 * Sin `monetization.ads_enabled === true` (o con provider 'none') devuelve null sin reservar espacio.
 * Este componente no carga scripts de terceros (ni con consentimiento Marketing en la cookie leonidapp_consent):
 * solo reserva el hueco neutro con la etiqueta "Publicidad", por lo que no necesita leer el consentimiento.
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
  position?: string;
  width?: number;
  height?: number;
  enabled?: boolean;
}
interface MonetizationCfg {
  ads_enabled?: boolean;
  provider?: string;
  slots?: SlotCfg[];
}

const FORBIDDEN = /^\/(mapa|hub|progreso|aportar|entrar)(\/|$)/;

export function AdSlot({ position, slotId, className = '' }: AdSlotProps) {
  const cfg = usePublicConfig() as unknown as { monetization?: MonetizationCfg };
  const m = cfg.monetization;
  if (!m || m.ads_enabled !== true || m.provider === 'none') return null;
  if (Capacitor.isNativePlatform()) return null;
  if (typeof window !== 'undefined') {
    const here = window.location.pathname;
    if (FORBIDDEN.test(here)) return null;
  }
  const slot = (m.slots ?? []).find(
    (s) => s.enabled !== false && (slotId ? s.id === slotId : s.position === position),
  );
  if (!slot || !slot.width || !slot.height) return null;

  return (
    <aside
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
