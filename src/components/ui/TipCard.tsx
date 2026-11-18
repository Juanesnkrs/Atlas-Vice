import { useState } from 'react';
import { SunsetBanner } from '../layout/ViceShell';

export interface TipCardProps {
  /** Tips a paginar. Se muestran 3 barras de paginador (máx. 3 tips). */
  tips: readonly string[];
  /** Índice controlado (opcional). */
  index?: number;
  onIndexChange?: (index: number) => void;
  /** Imagen opcional; si falta o falla la carga se usa el banner vectorial sunset. */
  imageSrc?: string;
  imageAlt?: string;
  className?: string;
}

const PAGES = [0, 1, 2] as const;

export function TipCard({
  tips,
  index,
  onIndexChange,
  imageSrc,
  imageAlt = '',
  className = '',
}: TipCardProps) {
  const [inner, setInner] = useState(0);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const total = Math.min(3, tips.length);
  const raw = index ?? inner;
  const current = total === 0 ? 0 : Math.min(Math.max(raw, 0), total - 1);
  const showImage = Boolean(imageSrc) && imageSrc !== failedSrc;

  const select = (i: number) => {
    if (index === undefined) setInner(i);
    onIndexChange?.(i);
  };

  return (
    <section
      aria-label="Tip of the day"
      className={`glass overflow-hidden rounded-[20px] ${className}`}
    >
      <div className="relative h-28 w-full">
        {showImage ? (
          <img
            src={imageSrc}
            alt={imageAlt}
            className="h-full w-full object-cover"
            onError={() => setFailedSrc(imageSrc ?? null)}
          />
        ) : (
          <SunsetBanner className="h-full w-full" />
        )}
      </div>

      <div className="relative px-7 pb-3.5 pt-6">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-2 left-3 font-display text-[76px] font-bold leading-none text-[rgba(246,126,86,0.6)]"
        >
          &ldquo;
        </span>
        <h2 className="m-0 mb-2.5 font-display text-[22px] font-semibold tracking-[0.02em] text-white">
          TIP OF THE DAY
        </h2>
        <p aria-live="polite" className="m-0 min-h-[66px] text-[15px] leading-[1.55] text-vice-text">
          {tips[current] ?? ''}
        </p>

        {total > 1 && (
          <div role="group" aria-label="Paginador de tips" className="mt-0.5 flex items-center justify-end">
            {PAGES.slice(0, total).map((i) => (
              <button
                key={i}
                type="button"
                aria-label={`Ver tip ${i + 1} de ${total}`}
                aria-current={i === current ? 'true' : undefined}
                onClick={() => select(i)}
                className="flex h-11 min-w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-vice-gold"
              >
                <span
                  className={`block h-1 w-[30px] rounded-sm transition-colors ${
                    i === current ? 'bg-vice-coral' : 'bg-white/60'
                  }`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default TipCard;
