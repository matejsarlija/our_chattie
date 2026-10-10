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
            const isRunning = run.status === 'running';
            const isErrored = run.status === 'error' || run.status === 'failed';

            return (
              // Whole row is clickable, but NOT via an onClick/tabIndex on the
              // <tr> — that destroys the table's semantics and, when paired with
              // an aria-label, hides the row's own content from screen readers.
              // Instead the real <Link> in the first cell is STRETCHED over the
              // whole row with an ::after overlay, so:
              //   · the pointer target is the entire row,
              //   · the accessible element is still a genuine link,
              //   · the table still exposes cells, headers and scope.
              // `focus-within` on the row carries the focus ring, so keyboard
              // users see which row they are on.
              <tr
                key={run.id}
                className={`group relative transition-colors hover:bg-surface-muted/60 focus-within:bg-surface-muted/60 focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-accent${isRunning ? ' bg-info-surface/25' : ''}`}
              >
                <td className="px-4 py-3.5 align-top">
                  <Link
                    to={`/dashboard/runs/${run.id}`}
                    className="block after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                  >
                    <span className="block text-base font-medium text-ink group-hover:text-accent">
                      {caseNumber || (isRunning ? 'Analiza u tijeku' : 'Predmet bez broja')}
                    </span>
                    {party || court ? (
                      <span className="mt-0.5 block text-sm text-ink-muted">
                        {[party, court].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                    <span className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
                      <QueryMarker type={summary?.queryType || run.query_type} />
                      {oib ? <span className="font-mono text-[11px]">{oib}</span> : null}
                    </span>
                  </Link>
                </td>

                <td className="px-4 py-3.5 align-top">
                  <CoverageCell coverage={summary?.coverage} status={run.status} />
                </td>

                <td className="px-4 py-3.5 align-top">
                  <StatusBadge status={run.status} />
                  {/* Why it failed, in one clamped line. The glyph says the run
                      failed; this says whether it is worth retrying. */}
                  {isErrored && run.error ? (
                    <span className="mt-1 block max-w-[16rem] truncate text-xs text-ink-muted" title={run.error}>
                      {run.error}
                    </span>
                  ) : null}
                </td>

                <td className="px-4 py-3.5 align-top text-sm whitespace-nowrap tabular-nums text-ink-muted">
                  {formatDateTime(run.created_at)}
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
