import { formatLabDeltas } from './labMeta';
export default function LabDeltaStrip({ comparison }) {
  const flatToDag = comparison?.flatToDag || null;
  const dagToSummarized = comparison?.dagToSummarized || null;
  const incremental = comparison?.summaryIncrementalCost;
  const sharedUsage = comparison?.sharedUsage;

  return (
    <section aria-label="Sažetak razlika i troška" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-base font-semibold text-[var(--text)]">Što se promijenilo</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Učinak po koracima i dodatni trošak; bez automatskog rangiranja.</p>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Bez grupiranja → Tematske grupe</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {formatLabDeltas(flatToDag?.deltas, 'Nema opisnih razlika.')}
          </dd>
        </div>
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Tematske grupe → Tematske grupe + sažeci</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {formatLabDeltas(dagToSummarized?.deltas, 'Nema opisnih razlika.')}
          </dd>
        </div>
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Dodatni resursi za sažetke</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {incremental && typeof incremental === 'object'
              ? `${incremental.calls ?? '?'} poziva · ${incremental.totalTokens ?? '?'} tokena · ${incremental.elapsedMs != null ? `${(incremental.elapsedMs / 1000).toFixed(1)} s` : '?'}`
              : '?'}
          </dd>
        </div>
        <div className="border-l-2 border-[var(--border)] pl-3">
          <dt className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Resursi zajednički za sve varijante</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--text)]">
            {sharedUsage && typeof sharedUsage === 'object'
              ? `${sharedUsage.calls ?? '?'} poziva · ${sharedUsage.totalTokens ?? '?'} tokena`
              : '?'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
