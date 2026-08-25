import { useMemo } from 'react';

const RERANK_STATUS_LABELS = {
  active: 'Aktivan',
  fallback: 'Model nije uspio — leksički poredak',
  skipped: 'Preskočen',
};

const VERDICT_LABELS = {
  upheld: 'potvrđen',
  refuted: 'opovrgnut',
  unclear: 'nejasno',
};

function StatChip({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'accent'
      ? 'border-[var(--accent)] text-[var(--accent)]'
      : 'border-[var(--border)] text-[var(--text-muted)]';
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-md border px-2 py-0.5 text-xs ${toneClass}`}>
      <span className="font-semibold text-[var(--text)]">{value}</span>
      <span>{label}</span>
    </span>
  );
}

/**
 * Dense reasoning telemetry for a completed analysis run: which retrieval
 * queries ran (planned vs template), how evidence was ranked, and what the
 * conflict re-verification decided. Everything is read from the persisted
 * report meta — no extra API calls.
 */
export default function AnalysisReasoningTelemetry({ report }) {
  const retrieval = report?.meta?.retrieval || null;
  const rerank = report?.meta?.rerank || null;

  const queries = useMemo(
    () => (Array.isArray(retrieval?.queries) ? retrieval.queries : []),
    [retrieval?.queries]
  );
  const plannedQueries = queries.filter((q) => String(q?.id || '').startsWith('planned-'));
  const sourceTypes = retrieval?.metrics?.sourceTypeCounts || null;
  const matchCount = retrieval?.metrics?.matchCount ?? null;

  const conflicts = Array.isArray(report?.conflicts) ? report.conflicts : [];
  const followedUp = conflicts.filter((c) => c?.followUp?.verdict);
  const verdictCounts = followedUp.reduce((acc, c) => {
    acc[c.followUp.verdict] = (acc[c.followUp.verdict] || 0) + 1;
    return acc;
  }, {});

  const hasAnything = Boolean(retrieval || rerank);

  if (!hasAnything) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Telemetrija zaključivanja</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Telemetrija nije dostupna za ovu analizu (stariji zapis ili prekinuti tijek).
        </p>
      </section>
    );
  }

  const rerankStatus = rerank?.rerankStatus;
  const rerankReason = rerank?.metrics?.rerankReason || null;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="reasoning-telemetry">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Telemetrija zaključivanja</h2>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatChip label="upita" value={queries.length} />
        {plannedQueries.length > 0 ? (
          <StatChip label="planirano modelom" value={plannedQueries.length} tone="accent" />
        ) : null}
        {matchCount !== null ? <StatChip label="pogođenih izvora" value={matchCount} /> : null}
        {sourceTypes ? (
          Object.entries(sourceTypes)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([type, count]) => <StatChip key={type} label={type} value={count} />)
        ) : null}
        {rerankStatus ? (
          <StatChip label={`rerank: ${RERANK_STATUS_LABELS[rerankStatus] || rerankStatus}`} value="" />
        ) : null}
        {followedUp.length > 0 ? (
          Object.entries(verdictCounts).map(([verdict, count]) => (
            <StatChip key={verdict} label={`konflikata ${VERDICT_LABELS[verdict] || verdict}`} value={count} />
          ))
        ) : null}
      </div>

      {rerankReason ? (
        <p className="mb-3 text-xs text-[var(--text-muted)]">Razlog preskakanja reranka: <code className="rounded bg-[var(--surface-raised, transparent)] px-1">{rerankReason}</code></p>
      ) : null}

      {queries.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--surface-raised, rgba(0,0,0,0.03))] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-1.5">Izvor</th>
                <th className="px-3 py-1.5">Svrha</th>
                <th className="px-3 py-1.5">Upit</th>
              </tr>
            </thead>
            <tbody>
              {queries.slice(0, 8).map((query, index) => {
                const planned = String(query?.id || '').startsWith('planned-');
                return (
                  <tr key={query?.id || index} className="border-t border-[var(--border)]">
                    <td className="px-3 py-1.5">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          planned ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border)] text-[var(--text-muted)]'
                        }`}
                      >
                        {planned ? 'PLAN' : 'PREDLOŽAK'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[var(--text-muted)]">{query?.purpose || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-[var(--text)]">{query?.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {queries.length > 8 ? (
            <p className="border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
              +{queries.length - 8} upita nije prikazano.
            </p>
          ) : null}
        </div>
      ) : null}

      {followedUp.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
          {followedUp.map((conflict, i) => (
            <li key={i}>
              <span className="font-medium text-[var(--text)]">{VERDICT_LABELS[conflict.followUp.verdict] || conflict.followUp.verdict}</span>
              {' — '}
              {String(conflict.finding || '').slice(0, 120)}
              {conflict.followUp.reason ? ` (${conflict.followUp.reason})` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
