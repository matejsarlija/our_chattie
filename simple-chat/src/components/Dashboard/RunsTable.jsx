import { Link } from 'react-router-dom';
import StatusBadge from '../ui/StatusBadge';
import CoverageCell from '../ui/CoverageCell';
import AmountCell from '../ui/AmountCell';
import { formatDateTime } from '../ui/format';

/** The query kind, as a small marker. The backend's queryClassifier is the
 *  authority for the value; this only labels it. */
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

function QueryMarker({ type }) {
  const label = QUERY_TYPE_LABEL[type];
  if (!label) return null;
  return (
    <span className="rounded border border-line px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-ink-muted">
      {label}
    </span>
  );
}

/**
 * Desktop history table. Ported from design-prototypes/history-table.html
 * (the approved variant) — markup, spacing and classes are the prototype's.
 *
 * Audit items fixed here:
 *  - The case cell is a real <Link>, not a focusable <tr role="button">. That
 *    fixes the invisible focus ring (a `tr` matched none of the global
 *    button/a/input focus selectors) AND the `aria-label` that was swallowing
 *    the row's own content, so a screen reader could not hear the status.
 *  - <caption> and scope="col" on every column.
 *  - No bare OIB presented as a case number.
 */
export default function RunsTable({ runs, onOpenRun }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <table className="w-full min-w-full">
        <caption className="sr-only">
          Popis pokrenutih analiza predmeta s pokrivenošću dokumenata, statusom,
          datumom izrade i iznosom u sporu.
        </caption>
        <thead>
          <tr className="border-b border-line bg-surface-muted text-ink-muted">
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[40%]">
              Predmet
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[20%]">
              Pokrivenost
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[17%]">
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide w-[13%]">
              Kreirano
            </th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide w-[10%]">
              Iznos
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-line">
          {runs.map((run) => {
            const summary = run.summary || null;
            const caseNumber = summary?.caseNumber || null;
            const oib = run.oib || summary?.queryValue || null;
            const party = summary?.participantNames?.[0] || null;
            const court = summary?.court || null;
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
              <tr
                key={run.id}
                className={`group relative transition-colors hover:bg-surface-muted/60 focus-within:bg-surface-muted/60 focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-accent${isRunning ? ' bg-info-surface/25' : isQueued ? ' bg-surface-muted/40' : ''}`}
              >
                <td className="px-4 py-3.5 align-top">
                  <Link
                    to={`/dashboard/runs/${run.id}`}
                    className="block after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                  >
                    <span className="block text-base font-medium text-ink group-hover:text-accent">
                      {caseNumber || (isQueued ? 'Analiza čeka u redu' : isRunning ? 'Analiza u tijeku' : isCanceled ? 'Analiza otkazana' : 'Predmet bez broja')}
                    </span>
                    {party || court ? (
                      <span className="mt-0.5 block text-sm text-ink-muted">
                        {[party, court].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                      <QueryMarker type={summary?.queryType || run.query_type} />
                      {oib ? <span className="font-mono text-[11px]">{oib}</span> : null}
                      {scanDepth ? (
                        <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-muted">
                          {scanDepth}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </td>

                <td className="px-4 py-3.5 align-top">
                  <CoverageCell coverage={summary?.coverage} status={run.status} />
                </td>

                <td className="px-4 py-3.5 align-top">
                  <StatusBadge status={run.status} />
                  {statusNote ? (
                    <span className="mt-1 block max-w-[16rem] truncate text-xs text-ink-muted" title={statusNote}>
                      {statusNote}
                    </span>
                  ) : null}
                </td>

                <td className="px-4 py-3.5 align-top text-sm whitespace-nowrap tabular-nums text-ink-muted">
                  <div>{formatDateTime(run.created_at)}</div>
                  {costUsd ? (
                    <div className="mt-0.5 text-xs tabular-nums text-ink-muted">{costUsd}</div>
                  ) : null}
                </td>

                <td className="px-4 py-3.5 align-top">
                  <AmountCell amounts={summary?.amounts} running={isRunning} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
