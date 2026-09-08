import { useMemo, useState } from 'react';

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

function StatChip({ label, value, tone = 'default', active = false, onClick = null }) {
  const toneClass =
    tone === 'accent'
      ? 'border-[var(--accent)] text-[var(--accent)]'
      : 'border-[var(--border)] text-[var(--text-muted)]';
  const activeClass = active ? ' bg-[var(--surface-muted)] ring-1 ring-[var(--accent)]' : '';
  const baseClass = `inline-flex items-baseline gap-1 rounded-md border px-2 py-0.5 text-xs ${toneClass}${activeClass}`;
  const content = (
    <>
      <span className="font-semibold text-[var(--text)]">{value}</span>
      <span>{label}</span>
    </>
  );
  if (!onClick) {
    return <span className={baseClass}>{content}</span>;
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`${baseClass} cursor-pointer hover:bg-[var(--surface-muted)]`}>
      {content}
    </button>
  );
}

function MatchDetail({ match }) {
  const reasons = Array.isArray(match?.reasons) ? match.reasons : [];
  const snippet = typeof match?.snippet === 'string' && match.snippet
    ? match.snippet
    : (typeof match?.text === 'string' ? match.text : '');
  return (
    <li className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {typeof match?.score === 'number' ? (
          <span className="font-mono font-semibold text-[var(--text)]">ocjena {match.score.toFixed(2)}</span>
        ) : null}
        {match?.fileName ? <span className="text-[var(--text)]">{match.fileName}</span> : null}
        {match?.sourceType ? (
          <span className="rounded border border-[var(--border)] px-1 text-[10px] uppercase text-[var(--text-muted)]">{match.sourceType}</span>
        ) : null}
      </div>
      {reasons.length > 0 ? (
        <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">{reasons.join(' · ')}</p>
      ) : null}
      {snippet ? <p className="mt-1 text-[var(--text)]">{snippet}</p> : null}
      {match?.sourceId ? (
        <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">{match.sourceId}</p>
      ) : null}
    </li>
  );
}

/**
 * Dense reasoning telemetry for a completed analysis run: which retrieval
 * queries ran (planned vs template), how evidence was ranked, and what the
 * conflict re-verification decided. Everything is read from the persisted
 * report meta — no extra API calls.
 *
 * M-07: stat chips are filter toggles over the query table (planned-only,
 * per-sourceType). M-08: each query row expands to its persisted top-K
 * matches (score, reasons, snippet, source file — see M-06 provenance).
 */
export default function AnalysisReasoningTelemetry({ report }) {
  const retrieval = report?.meta?.retrieval || null;
  const rerank = report?.meta?.rerank || null;
  const [filter, setFilter] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const rows = useMemo(() => {
    const results = Array.isArray(retrieval?.results) ? retrieval.results : null;
    if (results && results.length > 0) {
      return results.map((result, index) => ({
        key: result?.query?.id || `row-${index}`,
        query: result?.query || {},
        matches: Array.isArray(result?.matches) ? result.matches : [],
      }));
    }
    const queries = Array.isArray(retrieval?.queries) ? retrieval.queries : [];
    return queries.map((query, index) => ({
      key: query?.id || `row-${index}`,
      query: query || {},
      matches: [],
    }));
  }, [retrieval?.results, retrieval?.queries]);

  const queries = useMemo(
    () => rows.map((row) => row.query),
    [rows]
  );
  const plannedQueries = queries.filter((q) => String(q?.id || '').startsWith('planned-'));
  const sourceTypes = retrieval?.metrics?.sourceTypeCounts || null;
  const matchCount = retrieval?.metrics?.matchCount ?? null;

  const filteredRows = useMemo(() => {
    if (!filter) return rows;
    if (filter.kind === 'planned') {
      return rows.filter((row) => String(row.query?.id || '').startsWith('planned-'));
    }
    if (filter.kind === 'sourceType') {
      return rows.filter((row) => (row.matches || []).some((m) => m?.sourceType === filter.value));
    }
    return rows;
  }, [rows, filter]);

  const toggleFilter = (next) => {
    setFilter((prev) => {
      if (!prev || prev.kind !== next.kind || prev.value !== next.value) return next;
      return null;
    });
  };

  const toggleExpanded = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
  const visibleRows = filteredRows.slice(0, 8);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="reasoning-telemetry">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Telemetrija zaključivanja</h2>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatChip label="upita" value={queries.length} />
        {plannedQueries.length > 0 ? (
          <StatChip
            label="planirano modelom"
            value={plannedQueries.length}
            tone="accent"
            active={filter?.kind === 'planned'}
            onClick={() => toggleFilter({ kind: 'planned', value: null })}
          />
        ) : null}
        {matchCount !== null ? <StatChip label="pogođenih izvora" value={matchCount} /> : null}
        {sourceTypes ? (
          Object.entries(sourceTypes)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([type, count]) => (
              <StatChip
                key={type}
                label={type}
                value={count}
                active={filter?.kind === 'sourceType' && filter?.value === type}
                onClick={() => toggleFilter({ kind: 'sourceType', value: type })}
              />
            ))
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
      {filter ? (
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Filter aktivan: {filter.kind === 'planned' ? 'samo upiti planirani modelom' : `samo upiti s pogotkom tipa ${filter.value}`} ({filteredRows.length}/{rows.length}).{' '}
          <button type="button" onClick={() => setFilter(null)} className="underline hover:no-underline">
            Poništi filter
          </button>
        </p>
      ) : null}

      {rerankReason ? (
        <p className="mb-3 text-xs text-[var(--text-muted)]">Razlog preskakanja reranka: <code className="rounded bg-[var(--surface-raised, transparent)] px-1">{rerankReason}</code></p>
      ) : null}

      {rows.length > 0 ? (
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
              {visibleRows.map((row) => {
                const query = row.query || {};
                const planned = String(query?.id || '').startsWith('planned-');
                const isOpen = expanded.has(row.key);
                const matches = row.matches || [];
                return (
                  <tr key={row.key} className="border-t border-[var(--border)] align-top">
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
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.key)}
                        aria-expanded={isOpen}
                        className="text-left font-mono text-[var(--text)] hover:underline"
                        title={matches.length > 0 ? 'Prikaži pogotke' : 'Nema spremljenih pogodaka'}
                      >
                        {query?.text} {matches.length > 0 ? (isOpen ? '▾' : `▸ (${matches.length})`) : ''}
                      </button>
                      {isOpen && (
                        <div className="mt-2">
                          {matches.length === 0 ? (
                            <p className="text-[11px] text-[var(--text-muted)]">Nema spremljenih pogodaka za ovaj upit (stariji zapis).</p>
                          ) : (
                            <ul className="space-y-1.5">
                              {matches.map((match, i) => (
                                <MatchDetail key={match?.sourceId || i} match={match} />
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredRows.length > 8 ? (
            <p className="border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
              +{filteredRows.length - 8} upita nije prikazano.
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
