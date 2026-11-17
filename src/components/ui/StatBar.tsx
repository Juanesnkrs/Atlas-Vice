export type StatAccent = 'magenta' | 'gold' | 'cyan' | 'lilac';

export interface StatBarProps {
  label: string;
  /** Valor 0-100 (se acota). */
  value: number;
  /** Texto del valor; por defecto `${value}`. */
  valueLabel?: string;
  accent?: StatAccent;
  className?: string;
}

const FILL: Record<StatAccent, string> = {
  magenta: 'linear-gradient(90deg, #E1307E, #F67E56)',
  gold: 'linear-gradient(90deg, #F69259, #FFC857)',
  cyan: 'linear-gradient(90deg, #7B2C6F, #5ED6E0)',
  lilac: 'linear-gradient(90deg, #E1307E, #B79CFF)',
};

export function StatBar({ label, value, valueLabel, accent = 'magenta', className = '' }: StatBarProps) {
  const clamped = Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
  return (
    <div className={`w-full ${className}`}>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium text-vice-text/85">{label}</span>
        <span className="font-display font-semibold text-vice-text">{valueLabel ?? clamped}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={valueLabel}
        className="h-2.5 w-full overflow-hidden rounded-full bg-white/10"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${clamped}%`, background: FILL[accent] }}
        />
      </div>
    </div>
  );
}

export default StatBar;
