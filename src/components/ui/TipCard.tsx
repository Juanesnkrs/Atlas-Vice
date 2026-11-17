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
      className={`glass overflow-hidden rounded-2xl ${className}`}
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

      <div className="p-5">
        <h2 className="font-display text-sm font-bold tracking-[0.2em] text-vice-orange">
          TIP OF THE DAY
        </h2>
        <div className="mt-2 flex gap-3">
          <span
            aria-hidden="true"
            className="font-display text-5xl font-bold leading-none text-vice-magenta"
          >
            &ldquo;
          </span>
          <p aria-live="polite" className="min-h-[3.5rem] text-base leading-relaxed text-vice-text">
            {tips[current] ?? ''}
          </p>
        </div>

        {total > 1 && (
          <div role="group" aria-label="Paginador de tips" className="mt-3 flex items-center">
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
                  className={`block h-1.5 rounded-full transition-all ${
                    i === current ? 'w-8 bg-vice-accent' : 'w-5 bg-white/30'
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
