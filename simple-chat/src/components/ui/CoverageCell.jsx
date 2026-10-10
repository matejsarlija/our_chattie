import { formatCoverage, formatGrounding, formatRatio } from './format';

/**
 * How much of the case was actually analysed, and how much of what the model
 * said could be verified against source text.
 *
 * This is the run's trust signal, so it is deliberately a plain fraction with a
 * thin NEUTRAL meter — no colour. A green or amber badge here would be an alarm
 * on almost every row, and rows that always alarm are rows nobody reads.
 *
 * The three states are distinct on purpose, because for a legal matter
 * "analysed everything", "analysed most of it" and "we never got to analyse
 * anything" must never look alike:
 *   - figures present  → fraction + meter + grounding ratio
 *   - figures absent, run unfinished → an explicit "not finished" line
 *   - no run result at all → a dash
 */
export default function CoverageCell({ coverage, status }) {
  const pair = formatCoverage(coverage);
  const grounding = formatGrounding(coverage);
  const ratio = formatRatio(coverage?.coverageRatio);

  if (!pair) {
    const unfinished = status === 'error' || status === 'failed';
    return (
      <div className="text-sm text-ink-muted whitespace-nowrap">
        {unfinished ? <span>nije završena</span> : <span>—</span>}
      </div>
    );
  }

  const pct = ratio ?? (typeof coverage?.total === 'number' && coverage.total > 0
    ? `${Math.round(((coverage.analyzed ?? 0) / coverage.total) * 100)}%`
    : null);

  return (
    <div className="whitespace-nowrap">
      <div className="flex items-baseline gap-1.5">
        <span className="text-base tabular-nums text-ink">{coverage.analyzed ?? '—'}</span>
        <span className="text-sm tabular-nums text-ink-muted">/{coverage.total ?? '—'}</span>
      </div>
      {pct ? (
        <div
          className="mt-1.5 h-1 w-full max-w-[7rem] rounded-full bg-surface-muted overflow-hidden"
          role="img"
          aria-label={`Analizirano ${coverage.analyzed} od ${coverage.total} dokumenata, ${pct}`}
        >
          <div
            className="h-full rounded-full bg-ink-muted"
            style={{ width: `${Math.min(100, Math.max(0, parseInt(pct, 10) || 0))}%` }}
          />
        </div>
      ) : null}
      {grounding ? (
        <span className="mt-1.5 block text-xs tabular-nums text-ink-muted">
          {grounding} navoda
        </span>
      ) : null}
    </div>
  );
}
