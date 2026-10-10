import { useState } from 'react';
import { formatDate } from '../ui/format';
import AnalysisCitationList from './AnalysisCitationList';

/**
 * Full documented chronology of a case.
 *
 * WHY THIS EXISTS. `report.timeline` is built deterministically by
 * `timelineBuilder.buildTimeline` (ISO calendar days, chronological) and carries
 * `{date, description, citations[]}` per entry. Until now the run-detail page
 * rendered exactly ONE of those entries — `LatestProceduralStep` takes the max
 * date and drops the rest. The rest of the chronology existed in persisted runs
 * and was never shown.
 *
 * The mermaid diagram used to cover this gap, by having the model invent a
 * "Kronologija i napredak" flowchart out of the prose narrative. That is gone:
 * this component renders the recorded events themselves. Nothing here is
 * inferred, so nothing here can be wrong in the way a model-drawn chronology was
 * — including the speculative future branches (H1/H2 "vjerojatnije ishodi"),
 * which were never data and now live in `report.openQuestions` as questions.
 *
 * Dates: ISO date-only strings, which parse as UTC midnight per spec, so the
 * source calendar day survives regardless of host timezone (see AGENTS.md,
 * "Raw timestamps from external sources are a classic silent-corruption trap").
 * An entry with no parseable date is kept and shown undated rather than dropped —
 * dropping it would silently hide evidence.
 */

const PAGE_SIZE = 10;

const getText = (item, keys) => {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  for (const key of keys) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim();
  }
  return '';
};

export default function CaseTimeline({ timeline }) {
  const [page, setPage] = useState(0);
  const events = Array.isArray(timeline) ? timeline : [];
  if (events.length === 0) return null;

  const dated = events.filter((event) => Number.isFinite(Date.parse(event?.date)));
  const pageCount = Math.ceil(events.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const visibleEvents = events.slice(start, start + PAGE_SIZE);

  return (
    <section id="case-timeline" className="card p-5 scroll-mt-20" aria-labelledby="case-timeline-heading" data-testid="case-timeline">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 id="case-timeline-heading" className="sec-title">Kronologija predmeta</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {dated.length === events.length
              ? `${events.length} ${events.length === 1 ? 'događaj' : 'događaja'}`
              : `${dated.length} od ${events.length} događaja s datumom`}
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-0">
        {visibleEvents.map((event, pageIndex) => {
          const index = start + pageIndex;
          const description = getText(event, ['description', 'event', 'text', 'title']);
          const citations = Array.isArray(event?.citations) ? event.citations : [];
          const isLast = index === events.length - 1;
          const dateLabel = event?.date ? formatDate(event.date) : null;

          return (
            <li key={`tl-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
              {!isLast ? (
                <span aria-hidden="true" className="absolute left-[3px] top-4 bottom-0 w-px bg-line" />
              ) : null}
              <span
                aria-hidden="true"
                className="relative mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full border-2 border-surface bg-ink-muted"
              />
              <div className="min-w-0 flex-1">
                {dateLabel ? (
                  <div className="eyebrow">{dateLabel}</div>
                ) : (
                  /* Undated entries are real recorded events; showing them as
                     "—" is honest, inventing a position for them is not. */
                  <div className="eyebrow">Bez datuma</div>
                )}
                <p className="mt-0.5 text-sm leading-relaxed text-ink">
                  {description || '—'}
                </p>
                {citations.length > 0 ? (
                  <div className="mt-1.5">
                    <AnalysisCitationList citations={citations} />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-ink-muted">
          <span>Prikaz {start + 1}–{start + visibleEvents.length} od {events.length} događaja</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((value) => value - 1)} disabled={page === 0} className="rounded-md border border-line-control px-2.5 py-1.5 text-ink disabled:opacity-50">Prethodna</button>
            <button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= pageCount - 1} className="rounded-md border border-line-control px-2.5 py-1.5 text-ink disabled:opacity-50">Sljedeća</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}