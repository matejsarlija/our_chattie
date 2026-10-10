import { Link } from 'react-router-dom';
import StatusBadge from '../ui/StatusBadge';
import CoverageCell from '../ui/CoverageCell';
import { formatDateTime } from '../ui/format';

const QUERY_TYPE_LABEL = {
  oib: 'OIB',
  case_number: 'Predmet',
  text: 'Tekst',
};

/**
 * Mobile counterpart to RunsTable. The desktop table is horizontally dense and
 * would need squinting below `md`, so the same data is stacked per card here.
 *
 * Audit item fixed: `RunsTable` and `RunsCardList` previously disagreed about
 * the date format and about what each row even contained. Both now read from
 * the same `ui/format` helpers and show the same five facts.
 */
export default function RunsCardList({ runs }) {
  return (
    <ul className="space-y-3" aria-label="Spremljene analize">
      {runs.map((run) => {
        const summary = run.summary || null;
        const caseNumber = summary?.caseNumber || null;
        const party = summary?.participantNames?.[0] || null;
        const court = summary?.court || null;
        const oib = run.oib || summary?.queryValue || null;
        const typeLabel = QUERY_TYPE_LABEL[summary?.queryType || run.query_type];
        const isRunning = run.status === 'running';

        return (
          <li key={run.id}>
            <Link
              to={`/dashboard/runs/${run.id}`}
              className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:bg-surface-muted/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block text-base font-medium text-ink">
                    {caseNumber || (isRunning ? 'Analiza u tijeku' : 'Predmet bez broja')}
                  </span>
                  {party || court ? (
                    <span className="mt-0.5 block text-sm text-ink-muted">
                      {[party, court].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </div>
                <StatusBadge status={run.status} className="shrink-0" />
              </div>

              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <span className="block text-[11px] uppercase tracking-wide text-ink-muted">
                    Pokrivenost
                  </span>
                  <div className="mt-0.5">
                    <CoverageCell coverage={summary?.coverage} status={run.status} />
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-ink-muted">
                <span className="flex items-center gap-1.5">
                  {typeLabel ? (
                    <span className="rounded border border-line px-1.5 py-0.5 font-medium">{typeLabel}</span>
                  ) : null}
                  {oib ? <span className="font-mono text-[11px]">{oib}</span> : null}
                </span>
                <span className="whitespace-nowrap tabular-nums">{formatDateTime(run.created_at)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
