import { useId } from 'react';

export const SCAN_DEPTHS = ['balanced', 'full'];

export const SCAN_DEPTH_LABELS = {
  balanced: 'Uravnoteženo',
  full: 'Sve',
};

const HELPERS = {
  balanced: 'Do 100 objava: najnovije i najstarije.',
  full: 'Sve dostupne objave.',
};

export default function ScanDepthSelect({ value = 'balanced', onChange, disabled = false }) {
  const id = useId();
  const currentValue = SCAN_DEPTHS.includes(value) ? value : 'balanced';

  return (
    <div className="w-full">
      <label htmlFor={id} className="block text-sm text-ink-muted">
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
        className="mt-1 w-full cursor-pointer rounded-lg border border-line-control bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {SCAN_DEPTHS.map((depth) => (
          <option key={depth} value={depth}>
            {SCAN_DEPTH_LABELS[depth]}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-ink-muted" aria-live="polite">
        {HELPERS[currentValue]}
      </p>
    </div>
  );
}
