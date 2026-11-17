import type { ReactNode } from 'react';

export type DockIconId = 'hub' | 'map' | 'catalog' | 'forum' | 'progress' | 'contribute';

export interface DockItem {
  id: string;
  label: string;
  /** Icono por defecto del dock. */
  iconId?: DockIconId;
  /** Icono propio (sustituye al de iconId). */
  icon?: ReactNode;
  /** Si se define, el item se renderiza como enlace. */
  href?: string;
}

export const MOBILE_DOCK_ITEMS: readonly DockItem[] = [
  { id: 'hub', label: 'Hub', iconId: 'hub' },
  { id: 'map', label: 'Mapa', iconId: 'map' },
  { id: 'catalog', label: 'Catálogo', iconId: 'catalog' },
  { id: 'forum', label: 'Foro', iconId: 'forum' },
  { id: 'progress', label: 'Progreso', iconId: 'progress' },
];

export const DESKTOP_DOCK_ITEMS: readonly DockItem[] = [
  { id: 'map', label: 'Mapa', iconId: 'map' },
  { id: 'catalog', label: 'Catálogo', iconId: 'catalog' },
  { id: 'forum', label: 'Foro', iconId: 'forum' },
  { id: 'contribute', label: 'Aportar', iconId: 'contribute' },
];

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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
          <path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </Svg>
      );
    case 'catalog':
      return (
        <Svg>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </Svg>
      );
    case 'forum':
      return (
        <Svg>
          <path d="M4 5h16v11H9l-5 4V5z" />
        </Svg>
      );
    case 'progress':
      return (
        <Svg>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8 12.5l3 3 5-6" />
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
  /** Items móvil (por defecto: Hub, Mapa, Catálogo, Foro, Progreso). */
  items?: readonly DockItem[];
  /** Items escritorio (por defecto: Mapa, Catálogo, Foro, Aportar). */
  desktopItems?: readonly DockItem[];
  /** Id del item activo (aria-current="page"). */
  activeId?: string;
  /** Callback al seleccionar un item (sin router). */
  onSelect?: (id: string) => void;
  className?: string;
}

interface DockEntryProps {
  item: DockItem;
  active: boolean;
  onSelect: ((id: string) => void) | undefined;
  variant: 'mobile' | 'desktop';
}

function DockEntry({ item, active, onSelect, variant }: DockEntryProps) {
  const base =
    variant === 'mobile'
      ? 'flex min-h-[44px] min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium'
      : 'flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold';
  const tone = active
    ? 'bg-vice-accent text-vice-ink'
    : 'text-vice-text/80 hover:bg-white/10 hover:text-vice-text';
  const cls = `${base} ${tone} transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold`;
  const content = (
    <>
      {item.icon ?? (item.iconId ? <DockIcon id={item.iconId} /> : null)}
      <span>{item.label}</span>
    </>
  );
  const current = active ? ('page' as const) : undefined;
  if (item.href) {
    return (
      <a
        href={item.href}
        aria-current={current}
        className={cls}
        onClick={() => onSelect?.(item.id)}
      >
        {content}
      </a>
    );
  }
  return (
    <button type="button" aria-current={current} className={cls} onClick={() => onSelect?.(item.id)}>
      {content}
    </button>
  );
}

export function BottomDock({
  items = MOBILE_DOCK_ITEMS,
  desktopItems = DESKTOP_DOCK_ITEMS,
  activeId,
  onSelect,
  className = '',
}: BottomDockProps) {
  return (
    <>
      {/* Móvil: dock fijo de 5 iconos */}
      <nav
        aria-label="Navegación principal"
        className={`glass pb-safe pl-safe pr-safe fixed inset-x-0 bottom-0 z-40 rounded-t-2xl md:hidden ${className}`}
      >
        <div className="flex items-stretch justify-between gap-1 px-2 pt-1.5">
          {items.map((item) => (
            <DockEntry
              key={item.id}
              item={item}
              active={item.id === activeId}
              onSelect={onSelect}
              variant="mobile"
            />
          ))}
        </div>
      </nav>

      {/* Escritorio: píldora centrada */}
      <nav
        aria-label="Navegación principal"
        className={`glass absolute bottom-5 left-1/2 z-40 hidden -translate-x-1/2 items-center gap-1 rounded-full p-1.5 md:flex ${className}`}
      >
        {desktopItems.map((item) => (
          <DockEntry
            key={item.id}
            item={item}
            active={item.id === activeId}
            onSelect={onSelect}
            variant="desktop"
          />
        ))}
      </nav>
    </>
  );
}

export default BottomDock;
