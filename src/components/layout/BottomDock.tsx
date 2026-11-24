import type { ReactNode } from 'react';
import { FEATURES } from '../../data/v1';

export type DockIconId = 'hub' | 'map' | 'catalog' | 'forum' | 'contribute' | 'home' | 'vehicles' | 'weapons' | 'guides' | 'news';

export interface DockItem {
  id: DockIconId;
  label: string;
  href: string;
}

/** Dock completo (Hub, Mapa, Catálogo, Foro, Aportar), en el orden del DesignSpec §3. Oculto en la v1 (ver src/data/v1.ts). */
export const DOCK_ITEMS_FULL: readonly DockItem[] = [
  { id: 'hub', label: 'Hub', href: '/hub' },
  { id: 'map', label: 'Mapa', href: '/mapa' },
  { id: 'catalog', label: 'Catálogo', href: '/catalogo' },
  { id: 'forum', label: 'Foro', href: '/foro' },
  { id: 'contribute', label: 'Aportar', href: '/aportar' },
];

/** Dock de la v1 «enciclopedia» (escritorio y móvil): solo contenido público. */
export const DOCK_ITEMS_V1: readonly DockItem[] = [
  { id: 'home', label: 'Inicio', href: '/' },
  { id: 'vehicles', label: 'Vehículos', href: '/catalogo/vehiculos' },
  { id: 'weapons', label: 'Armas', href: '/catalogo/armas' },
  { id: 'guides', label: 'Guías', href: '/guias' },
  { id: 'map', label: 'Mapa', href: '/mapa' },
  { id: 'news', label: 'Noticias', href: '/noticias' },
];

/** Lista que usa la app (la v1 muestra el dock simplificado). */
export const DOCK_ITEMS: readonly DockItem[] = FEATURES.hub || FEATURES.forum || FEATURES.contribute ? DOCK_ITEMS_FULL : DOCK_ITEMS_V1;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function DockIcon({ id }: { id: DockIconId }) {
  switch (id) {
    case 'home':
    case 'hub':
      return (
        <Svg>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </Svg>
      );
    case 'map':
      return (
        <Svg>
          <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </Svg>
      );
    case 'catalog':
      return (
        <Svg>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
        </Svg>
      );
    case 'forum':
      return (
        <Svg>
          <path d="M4 5h16v11H9l-5 4V5z" />
        </Svg>
      );
    case 'vehicles':
      return (
        <Svg>
          <path d="M3 15v-3.5L5.5 6h13L21 11.5V15M3 15h18M3 15v2.5M21 15v2.5" />
          <path d="M5.5 11.5h13" />
          <circle cx="7.5" cy="15" r="1.6" />
          <circle cx="16.5" cy="15" r="1.6" />
        </Svg>
      );
    case 'weapons':
      return (
        <Svg>
          <circle cx="12" cy="12" r="6.5" />
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        </Svg>
      );
    case 'guides':
      return (
        <Svg>
          <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5v-15z" />
          <path d="M8 7h8M8 10.5h6" />
        </Svg>
      );
    case 'news':
      return (
        <Svg>
          <path d="M4 5h13v14H6.5A2.5 2.5 0 014 16.5V5z" />
          <path d="M17 8h3v8.5a2.5 2.5 0 01-2.5 2.5H17M7.5 8.5h6M7.5 12h6M7.5 15.5h3.5" />
        </Svg>
      );
    case 'contribute':
      return (
        <Svg>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v8M8 12h8" />
        </Svg>
      );
  }
}

export interface BottomDockProps {
  /** Ítems visibles (por defecto los 5 de DOCK_ITEMS). */
  items?: readonly DockItem[];
  /** Id del ítem activo (aria-current="page"). Sin valor, ningún ítem queda activo. */
  activeId?: string;
  className?: string;
}

/**
 * Dock único: píldora flotante `glass` fija abajo (Map.dc.html en escritorio, Mobile.dc.html en móvil).
 * Reserva su alto con la variable --dock-reserve (vice-nui.css).
 */
export function BottomDock({ items = DOCK_ITEMS, activeId, className = '' }: BottomDockProps) {
  return (
    <nav
      aria-label="Navegación principal"
      className={`glass fixed bottom-[calc(12px+var(--safe-bottom))] left-[calc(12px+var(--safe-left))] right-[calc(12px+var(--safe-right))] z-dock flex h-[68px] items-center justify-between gap-1 rounded-[34px] px-1.5 md:bottom-[calc(28px+var(--safe-bottom))] md:left-1/2 md:right-auto md:h-[72px] md:-translate-x-1/2 md:justify-center md:px-3 ${className}`}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <a
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-14 min-w-[44px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[28px] ${items.length > 5 ? "text-[10px]" : "text-[11px]"} no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold md:w-[108px] md:flex-none ${
              active
                ? 'bg-vice-accent font-bold text-vice-ink'
                : 'font-medium text-vice-text hover:bg-white/10'
            }`}
          >
            <DockIcon id={item.id} />
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

export default BottomDock;
