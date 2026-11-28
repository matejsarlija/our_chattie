import { Link } from 'react-router-dom';
import StatusBadge from '../ui/StatusBadge';
import CoverageCell from '../ui/CoverageCell';
import { formatDateTime } from '../ui/format';

const QUERY_TYPE_LABEL = {
  oib: 'OIB',
  case_number: 'Predmet',
  text: 'Tekst',
};

const SCAN_DEPTH_LABEL = {
  balanced: 'Uravnoteženo',
  uravnotezeno: 'Uravnoteženo',
  'uravnoteženo': 'Uravnoteženo',
  full: 'Sve',
  all: 'Sve',
  sve: 'Sve',
};

function formatScanDepth(depth) {
  if (!depth) return null;
  const key = String(depth).trim().toLowerCase();
  return SCAN_DEPTH_LABEL[key] || String(depth);
}

function formatCostUsd(costUsd) {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return null;
  return `$${costUsd.toFixed(2)}`;
}

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
        const scanDepth = formatScanDepth(summary?.scanDepth);
        const costUsd = formatCostUsd(summary?.costUsd);
        const isQueued = run.status === 'queued';
        const isRunning = run.status === 'running';
        const isCanceled = run.status === 'canceled' || run.status === 'cancelled';
        const isErrored = run.status === 'error' || run.status === 'failed' || run.status === 'interrupted';
        const statusNote = (isErrored || run.status === 'partial')
          ? (run.error || summary?.partialReason || null)
          : null;

        return (
          <li key={run.id}>
            <Link
              to={`/dashboard/runs/${run.id}`}
              className="block rounded-lg border border-line bg-surface p-3.5 transition-colors hover:bg-surface-muted/60"
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <span className="block text-base font-medium text-ink">
                    {caseNumber || (isQueued ? 'Analiza čeka u redu' : isRunning ? 'Analiza u tijeku' : isCanceled ? 'Analiza otkazana' : 'Predmet bez broja')}
                  </span>
                  {party || court ? (
                    <span className="mt-0.5 block truncate text-sm text-ink-muted">
                      {[party, court].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </div>
                <StatusBadge status={run.status} className="shrink-0" />
              </div>

              {statusNote ? (
                <p className="mt-1.5 truncate text-xs text-ink-muted" title={statusNote}>
                  {statusNote}
                </p>
              ) : null}

              <div className="mt-2.5 flex items-end justify-between gap-3">
                <div>
                  <span className="eyebrow block">
                    Pokrivenost
                  </span>
                  <div className="mt-0.5">
                    <CoverageCell coverage={summary?.coverage} status={run.status} />
                  </div>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-xs text-ink-muted">
                <span className="flex flex-wrap items-center gap-1.5">
                  {typeLabel ? (
                    <span className="rounded border border-line px-1.5 py-0.5 font-medium">{typeLabel}</span>
                  ) : null}
                  {oib ? <span className="font-mono text-[11px]">{oib}</span> : null}
                  {scanDepth ? (
                    <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px]">
                      {scanDepth}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
                  {costUsd ? <span>{costUsd}</span> : null}
                  <span>{formatDateTime(run.created_at)}</span>
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
