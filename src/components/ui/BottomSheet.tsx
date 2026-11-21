import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Gestión de foco de un panel: lo enfoca al abrir, cierra con Esc, atrapa Tab (si `trap`) y
 * devuelve el foco al disparador al cerrar. Compartido por BottomSheet y Modal.
 */
export function useDialogFocus(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  trap: boolean,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panelRef.current;
    node?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (!trap || e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, [active, panelRef, trap]);
}

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /**
   * 'sheet' (defecto): panel inferior en móvil y panel lateral en escritorio (md+).
   * 'side': panel lateral/ficha también en móvil.
   */
  mode?: 'sheet' | 'side';
  /** Modal (aria-modal + fondo oscurecido). false = ficha no modal sobre el mapa. */
  modal?: boolean;
  closeLabel?: string;
  /** 'sheet' (defecto) o 'dialog': el Modal usa 'dialog' para quedar sobre otras hojas y el dock. */
  layer?: 'sheet' | 'dialog';
  /** false = el clic en el fondo no cierra (formularios con datos por perder). Por defecto cierra. */
  dismissOnBackdrop?: boolean;
  className?: string;
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  mode = 'sheet',
  modal = true,
  closeLabel = 'Cerrar',
  layer = 'sheet',
  dismissOnBackdrop = true,
  className = '',
}: BottomSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, panelRef, onClose, modal);

  // Arrastre hacia abajo desde el asa/cabecera (solo táctil en móvil): bajar el sheet lo cierra.
  const [dy, setDy] = useState(0);
  const drag = useRef<{ id: number; y0: number; t0: number; active: boolean } | null>(null);
  const onDragDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (mode === 'side' || e.pointerType === 'mouse' || window.matchMedia('(min-width: 768px)').matches) return;
    drag.current = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, active: false };
  };
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const delta = e.clientY - d.y0;
    if (!d.active && Math.abs(delta) > 6) {
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.active) setDy(Math.max(0, delta));
  };
  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const delta = e.clientY - d.y0;
    const fast = delta / Math.max(1, e.timeStamp - d.t0) > 0.6;
    setDy(0);
    if (d.active && (delta > 96 || (fast && delta > 30))) onClose();
  };

  if (!open) return null;

  const side = mode === 'side';
  const position = side
    ? 'animate-slide-in-right inset-y-0 right-0 w-[min(92vw,380px)] rounded-l-2xl'
    : 'animate-slide-up inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl md:animate-slide-in-right md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[380px] md:rounded-l-2xl md:rounded-tr-none';

  // Portal en <body>: sale del contexto de apilado del shell y queda por encima del BottomDock.
  return createPortal(
    <div className={`${layer === 'dialog' ? 'z-dialog' : 'z-sheet'} fixed inset-0 ${modal ? '' : 'pointer-events-none'}`}>
      {modal && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[#1a0a22]/60"
          onClick={dismissOnBackdrop ? onClose : undefined}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal || undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Panel'}
        tabIndex={-1}
        className={`glass pointer-events-auto absolute flex flex-col overflow-hidden outline-none ${position} ${className}`}
        style={dy > 0 ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
      >
        <div
          className="max-md:touch-none"
          onPointerDown={onDragDown}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
        {!side && (
          <div aria-hidden="true" className="flex justify-center pb-1 pt-3 md:hidden">
            <span className="h-1.5 w-10 rounded-full bg-white/30" />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 px-5 pt-3">
          {title ? (
            <h2 id={titleId} className="font-display text-lg font-bold text-vice-text">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-vice-text hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(1.25rem+var(--safe-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default BottomSheet;
