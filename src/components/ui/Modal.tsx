import { useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BottomSheet, useDialogFocus } from './BottomSheet';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Título visible; se enlaza con aria-labelledby. */
  title: string;
  children: ReactNode;
  /** Zona fija bajo el contenido (acciones). */
  footer?: ReactNode;
  /** Texto accesible del botón de cierre (por defecto "Cerrar"). */
  closeLabel?: string;
  /** false = el clic en el fondo no cierra el diálogo (formularios con datos por perder). Por defecto cierra. */
  dismissOnBackdrop?: boolean;
  /** Escritorio: ventana ancha (comparaciones lado a lado). */
  wide?: boolean;
}

const MOBILE_QUERY = '(max-width: 767.98px)';

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

function DesktopDialog({ onClose, title, children, footer, closeLabel, dismissOnBackdrop, wide }: Omit<ModalProps, 'open'> & { closeLabel: string; dismissOnBackdrop: boolean }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, panelRef, onClose, true);

  return createPortal(
    <div className="z-dialog fixed inset-0 flex items-center justify-center p-6">
      <div aria-hidden="true" className="absolute inset-0 bg-[#1a0a22]/70" onClick={dismissOnBackdrop ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`glass relative flex max-h-[88dvh] w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} flex-col overflow-hidden rounded-3xl text-vice-text outline-none`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-6 py-3">
          <h2 id={titleId} className="font-display text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-vice-gold"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm leading-relaxed">{children}</div>
        {footer && <div className="border-t border-white/10 px-6 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Diálogo único de la app. Escritorio: ventana centrada `glass`. Móvil (< 768px): BottomSheet.
 * Siempre en un portal a <body>, en la capa `.z-dialog` (sobre el dock y las hojas), con foco atrapado,
 * Esc y clic en el fondo para cerrar, y foco devuelto al disparador.
 */
export function Modal({ open, onClose, title, children, footer, closeLabel = 'Cerrar', dismissOnBackdrop = true, wide = false }: ModalProps) {
  const mobile = useIsMobile();
  if (!open) return null;
  if (mobile) {
    return (
      <BottomSheet open onClose={onClose} title={title} closeLabel={closeLabel} layer="dialog" dismissOnBackdrop={dismissOnBackdrop}>
        {children}
        {footer && <div className="mt-4 border-t border-white/10 pt-3">{footer}</div>}
      </BottomSheet>
    );
  }
  return (
    <DesktopDialog onClose={onClose} title={title} footer={footer} closeLabel={closeLabel} dismissOnBackdrop={dismissOnBackdrop} wide={wide}>
      {children}
    </DesktopDialog>
  );
}

export default Modal;
