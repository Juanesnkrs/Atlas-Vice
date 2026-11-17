import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { PalmSymbol } from '../layout/ViceShell';

type Variant = 'primary' | 'glass';

interface PalmButtonCommon {
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  /** Ocupa todo el ancho disponible. */
  fullWidth?: boolean;
  /** Icono opcional a la izquierda de la etiqueta. */
  icon?: ReactNode;
  children: ReactNode;
}

type PalmButtonAsButton = PalmButtonCommon &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'children'> & { as?: 'button' };

type PalmButtonAsAnchor = PalmButtonCommon &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & { as: 'a'; href: string };

export type PalmButtonProps = PalmButtonAsButton | PalmButtonAsAnchor;

const PALMS = [
  'left-[4%] -top-3 h-[150%]',
  'left-[24%] -top-1 h-[130%]',
  'left-[46%] -top-3 h-[150%]',
  'left-[68%] -top-1 h-[130%]',
  'left-[88%] -top-3 h-[150%]',
] as const;

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      className="anim-pulse"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    >
      <path d="M12 3a9 9 0 019 9" />
      <circle cx="12" cy="12" r="9" opacity="0.25" />
    </svg>
  );
}

export function PalmButton(props: PalmButtonProps) {
  const {
    variant = 'primary',
    loading = false,
    disabled = false,
    fullWidth = false,
    icon,
    children,
    className = '',
  } = props;
  const inactive = disabled || loading;

  const cls = [
    variant === 'primary' ? 'pbtn' : 'pbtn glass',
    'inline-flex items-center justify-center gap-2',
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      {variant === 'primary' && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          {PALMS.map((pos) => (
            <PalmSymbol
              key={pos}
              className={`absolute w-auto text-vice-night opacity-[0.28] ${pos}`}
            />
          ))}
        </span>
      )}
      {loading ? <Spinner /> : icon}
      <span>{children}</span>
    </>
  );

  if (props.as === 'a') {
    const {
      as: _as,
      variant: _v,
      loading: _l,
      disabled: _d,
      fullWidth: _f,
      icon: _i,
      children: _c,
      className: _cn,
      href,
      onClick,
      ...rest
    } = props;
    return (
      <a
        {...rest}
        href={inactive ? undefined : href}
        className={cls}
        aria-disabled={inactive || undefined}
        aria-busy={loading || undefined}
        tabIndex={inactive ? -1 : rest.tabIndex}
        onClick={inactive ? (e) => e.preventDefault() : onClick}
      >
        {inner}
      </a>
    );
  }

  const {
    as: _as,
    variant: _v,
    loading: _l,
    disabled: _d,
    fullWidth: _f,
    icon: _i,
    children: _c,
    className: _cn,
    type = 'button',
    ...rest
  } = props;
  return (
    <button {...rest} type={type} className={cls} disabled={inactive} aria-busy={loading || undefined}>
      {inner}
    </button>
  );
}

export default PalmButton;
