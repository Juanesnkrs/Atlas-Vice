import type { ReactNode } from 'react';

export type DockIconId = 'hub' | 'map' | 'catalog' | 'forum' | 'contribute';

export interface DockItem {
  id: DockIconId;
  label: string;
  href: string;
}

/** Lista única del dock (escritorio y móvil), en el orden del DesignSpec §3. */
export const DOCK_ITEMS: readonly DockItem[] = [
  { id: 'hub', label: 'Hub', href: '/hub' },
  { id: 'map', label: 'Mapa', href: '/mapa' },
  { id: 'catalog', label: 'Catálogo', href: '/catalogo' },
  { id: 'forum', label: 'Foro', href: '/foro' },
  { id: 'contribute', label: 'Aportar', href: '/aportar' },
];

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
            className={`flex h-14 min-w-[44px] flex-1 flex-col items-center justify-center gap-[3px] rounded-[28px] text-[11px] no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold md:w-[108px] md:flex-none ${
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
