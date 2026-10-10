const deltaLabel = (deltas, emptyText) => {
  if (!Array.isArray(deltas) || deltas.length === 0) return emptyText;
  return deltas.join('; ');
};

export default function LabDeltaStrip({ comparison }) {
  const flatToDag = comparison?.flatToDag || null;
  const dagToSummarized = comparison?.dagToSummarized || null;
  const incremental = comparison?.summaryIncrementalCost;
  const sharedUsage = comparison?.sharedUsage;

  return (
    <section aria-label="Sažetak razlika" className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-base font-semibold text-[var(--text)]">Razlike koje vrijedi pročitati</h2>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Ravni → DAG</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {deltaLabel(flatToDag?.deltas, 'Nema opisnih razlika.')}
          </dd>
        </div>
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">DAG → DAG + sažeci</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {deltaLabel(dagToSummarized?.deltas, 'Nema opisnih razlika.')}
          </dd>
        </div>
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Dodatni trošak sažetaka</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {incremental && typeof incremental === 'object'
              ? `${incremental.calls ?? '?'} poziva · ${incremental.totalTokens ?? '?'} tokena · ${incremental.elapsedMs ?? '?'} ms`
              : '?'}
          </dd>
        </div>
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Zajednički prolaz (jednom)</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {sharedUsage && typeof sharedUsage === 'object'
              ? `${sharedUsage.calls ?? '?'} poziva · ${sharedUsage.totalTokens ?? '?'} tokena`
              : '?'}
          </dd>
        </div>
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Status ulaza</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {comparison?.inputHashMatches === true ? '✓ isti ulaz u sve tri varijante' : comparison?.inputHashMatches === false ? '⚠ hash se razlikuje' : '? status nepoznat'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
