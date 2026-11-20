import { useId, type CSSProperties, type ReactNode } from 'react';
import Footer from './Footer';

/* ------------------------------------------------------------------ */
/* SVG decorativos reutilizables (Vice Sunset NUI)                     */
/* ------------------------------------------------------------------ */

const FROND = 'M0 0 C16 -14 42 -15 60 6 C42 -3 20 -4 0 0 Z';
const FROND_TRANSFORMS = [
  'rotate(-45)',
  'rotate(-12)',
  'rotate(22)',
  'rotate(-80)',
  'scale(-1 1) rotate(-45)',
  'scale(-1 1) rotate(-12)',
  'scale(-1 1) rotate(22)',
  'scale(-1 1) rotate(-80)',
] as const;

const TRUNK = 'M60 400 C57 300 58 200 63 72 L67 72 C62 200 64 300 66 400 Z';

const SKYLINE_PATH =
  'M0 80 V52 H30 V36 H48 V52 H70 V22 H92 V52 H110 V40 H140 V14 H150 V6 H156 V14 H166 V44 H196 V30 H220 V50 H250 V26 H262 V18 H282 V50 H312 V38 H340 V54 H372 V30 H392 V10 H414 V30 H434 V46 H466 V34 H488 V52 H520 V20 H536 V12 H552 V20 H566 V48 H600 V36 H628 V52 H660 V28 H684 V50 H716 V40 H744 V18 H758 V8 H770 V18 H786 V46 H820 V32 H846 V52 H878 V38 H904 V54 H940 V42 H970 V56 H1000 V80 Z';

interface DecoProps {
  className?: string;
  style?: CSSProperties;
}

function PalmShapes() {
  return (
    <>
      <path d={TRUNK} />
      <g transform="translate(65 72)">
        {FROND_TRANSFORMS.map((t) => (
          <path key={t} d={FROND} transform={t} />
        ))}
      </g>
    </>
  );
}

/** Palmera alta y esbelta. Usa `currentColor`; escala con width/height. */
export function PalmSymbol({ className, style }: DecoProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 130 400"
      className={className}
      style={style}
      fill="currentColor"
    >
      <PalmShapes />
    </svg>
  );
}

/** Silueta del skyline costero de Vice City. Usa `currentColor`. */
export function SkylineSilhouette({ className, style }: DecoProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1000 80"
      preserveAspectRatio="none"
      className={className}
      style={style}
      fill="currentColor"
    >
      <path d={SKYLINE_PATH} />
    </svg>
  );
}

const WORDMARK_PALMS: ReadonlyArray<readonly [number, number, number, number]> = [
  [4, 12, 40, 124],
  [62, 18, 36, 112],
  [118, 10, 40, 124],
  [176, 18, 36, 112],
  [232, 12, 40, 124],
  [290, 18, 36, 112],
  [344, 10, 40, 124],
  [384, 18, 36, 112],
];

/** Wordmark "LEONIDAPP": relleno sunset, palmeras internas y skyline bajo el texto. */
export function ViceWordmark({
  className,
  width = 360,
  title = 'LEONIDAPP',
}: {
  className?: string;
  width?: number;
  title?: string;
}) {
  const uid = useId();
  const clipId = `${uid}-clip`;
  const sunG = `${uid}-sunG`;
  const sunH = `${uid}-sunH`;
  return (
    <svg
      viewBox="0 0 420 150"
      width={width}
      height={Math.round((width * 150) / 420)}
      role="img"
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient id={sunG} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E1307E" />
          <stop offset="1" stopColor="#F69259" />
        </linearGradient>
        <linearGradient id={sunH} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#E1307E" />
          <stop offset="1" stopColor="#F67E56" />
        </linearGradient>
        <clipPath id={clipId}>
          <text
            x="210"
            y="92"
            textAnchor="middle"
            fontFamily="Jost, system-ui, sans-serif"
            fontWeight={700}
            fontSize={74}
            textLength={380}
            lengthAdjust="spacingAndGlyphs"
          >
            LEONIDAPP
          </text>
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="20" width="420" height="80" fill={`url(#${sunG})`} />
        <g fill="#2E1A47" opacity="0.5">
          {WORDMARK_PALMS.map(([x, y, w, h]) => (
            <svg key={x} x={x} y={y} width={w} height={h} viewBox="0 0 130 400">
              <PalmShapes />
            </svg>
          ))}
        </g>
      </g>
      <text
        x="210"
        y="92"
        textAnchor="middle"
        fontFamily="Jost, system-ui, sans-serif"
        fontWeight={700}
        fontSize={74}
        textLength={380}
        lengthAdjust="spacingAndGlyphs"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.9"
        strokeWidth="1.3"
      >
        LEONIDAPP
      </text>
      <svg x="14" y="104" width="392" height="34" viewBox="0 0 1000 80" preserveAspectRatio="none">
        <path d={SKYLINE_PATH} fill="#5A2A73" />
      </svg>
      <rect x="14" y="138" width="392" height="2.5" rx="1.2" fill={`url(#${sunH})`} />
    </svg>
  );
}

/** Banner vectorial sunset: fallback para cualquier tarjeta sin imagen (nunca imagen rota). */
export function SunsetBanner({ className, label }: { className?: string; label?: string }) {
  const uid = useId();
  const g = `${uid}-sky`;
  return (
    <svg
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2E1A47" />
          <stop offset="0.4" stopColor="#7B2C6F" />
          <stop offset="0.75" stopColor="#E14B7B" />
          <stop offset="1" stopColor="#F69259" />
        </linearGradient>
      </defs>
      <rect width="400" height="200" fill={`url(#${g})`} />
      <circle cx="270" cy="128" r="46" fill="#F69259" opacity="0.55" />
      <polygon points="40,0 150,0 260,200 150,200" fill="rgba(225,75,123,0.26)" />
      <g fill="#2E1A47" opacity="0.35">
        <svg x="30" y="20" width="56" height="172" viewBox="0 0 130 400">
          <PalmShapes />
        </svg>
        <svg x="320" y="40" width="46" height="144" viewBox="0 0 130 400">
          <PalmShapes />
        </svg>
      </g>
      <svg x="0" y="150" width="400" height="50" viewBox="0 0 1000 80" preserveAspectRatio="none">
        <path d={SKYLINE_PATH} fill="#2A1240" opacity="0.85" />
      </svg>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* ViceShell                                                           */
/* ------------------------------------------------------------------ */

export interface ViceShellProps {
  /** Contenido principal (slot). */
  children: ReactNode;
  /** Muestra la cabecera con el wordmark (enlace a la portada). */
  showHeader?: boolean;
  /** Contenido a la derecha de la cabecera (enlaces, progreso, sesión...). */
  headerEnd?: ReactNode;
  /** Contenido central de la cabecera (buscador...). */
  headerCenter?: ReactNode;
  /** Dock de navegación (<BottomDock />): el contenido reserva su alto + safe area. */
  dock?: ReactNode;
  /**
   * true (por defecto): HUD 100vw x 100vh sin scroll vertical (Mapa / Inspector / Foro).
   * false: el contenido puede desplazarse verticalmente.
   */
  lockScroll?: boolean;
  /** Añade el RockstarFooter al final de la página (solo en páginas con scroll). */
  footer?: boolean;
  /** Dibuja palmeras y skyline decorativos (siempre detrás del contenido). */
  decorations?: boolean;
  className?: string;
}

export function ViceShell({
  children,
  showHeader = false,
  headerEnd,
  headerCenter,
  dock,
  lockScroll = true,
  footer = false,
  decorations = true,
  className = '',
}: ViceShellProps) {
  const withFooter = footer && !lockScroll;
  return (
    <div
      className={`bg-sunset relative flex w-full flex-col font-body text-vice-text ${
        lockScroll ? 'h-dvh overflow-hidden' : 'min-h-dvh'
      } ${className}`}
    >
      {decorations && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="vice-diagonals absolute inset-0" />
          <PalmSymbol className="absolute -right-4 top-6 hidden h-[60vh] w-auto text-white opacity-[0.09] md:block" />
          <PalmSymbol className="absolute right-32 top-16 hidden h-[44vh] w-auto text-white opacity-[0.07] md:block" />
          <PalmSymbol className="absolute -left-3 top-24 h-[36vh] w-auto text-white opacity-[0.08]" />
          <SkylineSilhouette className="absolute inset-x-0 bottom-0 h-[16vh] w-full text-[#2A1240] opacity-[0.55]" />
        </div>
      )}

      <div className="pt-safe pl-safe pr-safe relative z-10 flex min-h-0 flex-1 flex-col">
        {showHeader && (
          <header className="flex shrink-0 items-center justify-between gap-4 px-4 py-3 md:px-8">
            <a
              href="/"
              aria-label="LeonidApp, ir a la portada"
              className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vice-gold"
            >
              <ViceWordmark width={132} />
            </a>
            {headerCenter && <div className="min-w-0 flex-1 md:max-w-xl">{headerCenter}</div>}
            {headerEnd && <div className="shrink-0">{headerEnd}</div>}
          </header>
        )}

        <main
          className={`relative min-h-0 flex-1 ${lockScroll ? 'overflow-hidden' : 'min-h-dvh overflow-y-auto'} ${
            dock && lockScroll ? 'pb-[var(--dock-reserve)]' : ''
          }`}
        >
          {children}
        </main>

        {withFooter && (
          <div
            className="relative z-20 shrink-0 bg-black"
            style={dock ? { paddingBottom: 'var(--dock-reserve)' } : undefined}
          >
            <Footer />
          </div>
        )}
        {!withFooter && dock && !lockScroll && (
          <div aria-hidden="true" className="h-[var(--dock-reserve)] shrink-0" />
        )}
      </div>

      {dock}
    </div>
  );
}

export default ViceShell;
