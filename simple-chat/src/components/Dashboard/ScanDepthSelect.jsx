import { useId } from 'react';

export const SCAN_DEPTHS = ['standard', 'balanced', 'full'];

export const SCAN_DEPTH_LABELS = {
  standard: 'Standardno',
  balanced: 'Uravnoteženo',
  full: 'Sve dostupne',
};

const HELPERS = {
  standard: '5 stranica — najnovije objave',
  balanced: '5 stranica + 10 najstarijih objava',
  full: 'Sve dostupne objave predmeta',
};

export default function ScanDepthSelect({ value = 'balanced', onChange, disabled = false }) {
  const id = useId();
  const currentValue = SCAN_DEPTHS.includes(value) ? value : 'balanced';

  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-sm text-[var(--text-muted)]">
        Dubina pretrage
      </label>
      <select
        id={id}
        value={currentValue}
        disabled={disabled}
        onChange={(event) => {
          if (disabled) return;
          const next = event.target.value;
          if (SCAN_DEPTHS.includes(next) && next !== currentValue) onChange?.(next);
        }}
        className="mt-1 w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {SCAN_DEPTHS.map((depth) => (
          <option key={depth} value={depth}>
            {SCAN_DEPTH_LABELS[depth]}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-[var(--text-muted)]" aria-live="polite">
        {HELPERS[currentValue]}
      </p>
    </div>
  );
}
