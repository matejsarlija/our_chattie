import { useMemo, useState } from 'react';


function StatChip({ label, value, active = false, onClick = null }) {
  const activeClass = active ? ' bg-surface-muted ring-1 ring-accent' : '';
  const baseClass = `inline-flex items-baseline gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-ink-muted${activeClass}`;
  const content = (
    <>
      <span className="font-semibold text-ink">{value}</span>
      <span>{label}</span>
    </>
  );
  if (!onClick) {
    return <span className={baseClass}>{content}</span>;
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`${baseClass} cursor-pointer hover:bg-surface-muted`}>
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
    <li className="rounded border border-line bg-surface px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {typeof match?.score === 'number' ? (
          <span className="font-mono font-semibold text-ink">ocjena {match.score.toFixed(2)}</span>
        ) : null}
        {match?.fileName ? <span className="text-ink">{match.fileName}</span> : null}
        {match?.sourceType ? (
          <span className="rounded border border-line px-1 text-xs uppercase text-ink-muted">{match.sourceType}</span>
        ) : null}
      </div>
      {reasons.length > 0 ? (
        <p className="mt-1 font-mono text-xs text-ink-muted">{reasons.join(' · ')}</p>
      ) : null}
      {snippet ? <p className="mt-1 text-ink">{snippet}</p> : null}
      {match?.sourceId ? (
        <p className="mt-1 truncate font-mono text-xs text-ink-muted">{match.sourceId}</p>
      ) : null}
    </li>
  );
}

/**
 * Retrieval telemetry for a completed analysis run. Everything is read from
 * the persisted report meta — no extra API calls.
 *
 * Query rows expand to their persisted top-K matches (score, reasons, snippet,
 * source file).
 */
export default function AnalysisReasoningTelemetry({ report, collapsible = false }) {
  const retrieval = report?.meta?.retrieval || null;
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
  const sourceTypes = retrieval?.metrics?.sourceTypeCounts || null;
  const matchCount = retrieval?.metrics?.matchCount ?? null;

  const filteredRows = useMemo(() => {
    if (!filter) return rows;
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
  const hasAnything = Boolean(retrieval);


  if (!hasAnything) {
    return (
      <section className="card p-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">Telemetrija zaključivanja</h2>
        <p className="text-sm text-ink-muted">
          Telemetrija nije dostupna za ovu analizu (stariji zapis ili prekinuti tijek).
        </p>
      </section>
    );
  }

  const visibleRows = filteredRows.slice(0, 8);

  // TU-1 — the telemetry table is evidence plumbing, not case substance:
  // collapsible mode hides it behind a native disclosure on the detail page
  // while keeping every control intact.
  const Wrapper = collapsible ? 'details' : 'section';
  const Heading = collapsible ? 'summary' : 'h2';

  return (
    <Wrapper className="card p-5" data-testid="reasoning-telemetry">
      <Heading className={`mb-3 text-sm font-semibold text-ink${collapsible ? ' cursor-pointer' : ''}`}>Telemetrija zaključivanja</Heading>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatChip label="upita" value={queries.length} />
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
      </div>
      {filter ? (
        <p className="mb-2 text-xs text-ink-muted">
          Filter aktivan: samo upiti s pogotkom tipa {filter.value} ({filteredRows.length}/{rows.length}).{' '}
          <button type="button" onClick={() => setFilter(null)} className="underline hover:no-underline">
            Poništi filter
          </button>
        </p>
      ) : null}


      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-1.5">Izvor</th>
                <th className="px-3 py-1.5">Svrha</th>
                <th className="px-3 py-1.5">Upit</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const query = row.query || {};
                const isOpen = expanded.has(row.key);
                const matches = row.matches || [];
                return (
                  <tr key={row.key} className="border-t border-line align-top">
                    <td className="px-3 py-1.5">
                      <span className="inline-block rounded border border-line px-1.5 py-0.5 text-xs font-semibold text-ink-muted">
                        PREDLOŽAK
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">{query?.purpose || '—'}</td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.key)}
                        aria-expanded={isOpen}
                        className="text-left font-mono text-ink hover:underline"
                        title={matches.length > 0 ? 'Prikaži pogotke' : 'Nema spremljenih pogodaka'}
                      >
                        {query?.text} {matches.length > 0 ? (isOpen ? '▾' : `▸ (${matches.length})`) : ''}
                      </button>
                      {isOpen && (
                        <div className="mt-2">
                          {matches.length === 0 ? (
                            <p className="text-xs text-ink-muted">Nema spremljenih pogodaka za ovaj upit (stariji zapis).</p>
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
            <p className="border-t border-line px-3 py-1.5 text-xs text-ink-muted">
              +{filteredRows.length - 8} upita nije prikazano.
            </p>
          ) : null}
        </div>
      ) : null}

    </Wrapper>
  );
}
