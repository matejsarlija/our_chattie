import { formatEur } from '../ui/format';

/**
 * "Opseg analize" — what this analysis may and may not be used to conclude.
 *
 * Two fixes against the previous version:
 *
 * 1. The old card painted `border-l-4 border-l-amber-500` UNCONDITIONALLY, so a
 *    fully-covered run still got the amber "this is degraded" edge. The edge is
 *    now gone; the state is carried by the status pill and the per-conclusion
 *    ✓ / ⚠ marks.
 * 2. `scope.supported` / `scope.blocked` are now shown as a two-column
 *    supported/blocked list rather than a flat four-up figure grid, because the
 *    question a reader actually asks is "which conclusions can I rely on".
 */
const STATUS = {
  discovery_only: { label: 'Samo otkrivanje', glyph: '·' },
  partial: { label: 'Djelomično', glyph: '◐' },
  sufficient: { label: 'Dostatno', glyph: '✓' },
};

const CATEGORY_LABELS = {
  docket_timeline: 'Tijek predmeta',
  documented_claims: 'Dokumentirane tražbine',
  current_procedural_status: 'Trenutačni procesni status',
  full_case_outcome: 'Cjelovit ishod predmeta',
};

const REASON_LABELS = {
  'failed-documents': 'nisu analizirani svi dokumenti',
  'partial-corpus': 'nije obuhvaćen cijeli pronađeni korpus',
  'no-final-distribution-statement': 'nedostaje diobeni popis ili završni račun',
  'no-extracted-claims': 'nema izdvojenih strukturiranih tražbina',
  'no-analyzed-documents': 'nema uspješno analiziranih dokumenata',
  'latest-entry-not-analyzed': 'najnoviji unos nije analiziran',
  'newer-evidence-unavailable': 'noviji dokazi nisu dostupni',
};

const CATEGORY_NOTES = {
  docket_timeline: (corpus) => (corpus?.dateRange?.spanDays
    ? `${corpus.dateRange.spanDays} dana raspona`
    : null),
  documented_claims: (corpus) => (Number.isFinite(corpus?.totalResults)
    ? `${corpus.totalResults.toLocaleString('hr-HR')} unosa`
    : null),
  current_procedural_status: () => null,
  full_case_outcome: () => null,
};

const formatRange = (range) => {
  if (!range?.oldestEntryDate && !range?.newestEntryDate) return null;
  const start = range.oldestEntryDate || '?';
  const end = range.newestEntryDate || '?';
  return start === end ? start : `${start} — ${end}`;
};

/** The blocker attached to a category, if the contract recorded one. */
function blockerFor(scope, category) {
  const blockers = Array.isArray(scope?.blockingEvidence) ? scope.blockingEvidence : [];
  return blockers.find((item) => item?.category === category) || null;
}

export default function AnalysisScopeCard({ scope }) {
  if (!scope) return null;

  const status = STATUS[scope.analysisStatus] || STATUS.discovery_only;
  const corpus = scope.corpus || {};
  const coverageLedger = corpus.coverageLedger || null;
  const degraded = Array.isArray(scope.degraded) ? scope.degraded : [];
  const range = formatRange(corpus.dateRange);

  const supported = Array.isArray(scope.supported) ? scope.supported : [];
  const blocked = Array.isArray(scope.blocked) ? scope.blocked : [];
  // Render the contract's own four categories so an unlisted one is visible
  // rather than silently absent.
  const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);
  const rows = ALL_CATEGORIES.map((category) => {
    const isBlocked = blocked.includes(category);
    const blocker = blockerFor(scope, category);
    const note = isBlocked && blocker
      ? REASON_LABELS[blocker.reason] || blocker.reason
      : CATEGORY_NOTES[category]?.(corpus) || range;
    return { category, isBlocked, note };
  });

  const supportedCount = supported.length;

  return (
    <section id="analysis-scope" className="card p-5 scroll-mt-20" aria-labelledby="analysis-scope-heading">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 id="analysis-scope-heading" className="sec-title">Opseg analize</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {supportedCount} od {ALL_CATEGORIES.length} zaključaka potkrijepljeno
          </p>
        </div>
        <span className="pill">
          <span aria-hidden="true">{status.glyph}</span>
          {status.label}
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.category} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={`mt-0.5 text-xs ${row.isBlocked ? 'text-warning' : 'text-success'}`}
            >
              {row.isBlocked ? '⚠' : '✓'}
            </span>
            <div className="min-w-0">
              <dt className="text-sm text-ink">{CATEGORY_LABELS[row.category]}</dt>
              {row.note ? <dd className="text-xs text-ink-muted">{row.note}</dd> : null}
            </div>
          </div>
        ))}
      </dl>

      {coverageLedger ? (
        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
          Uzorak: {coverageLedger.selected ?? 0} / {coverageLedger.available ?? 0} unosa odabrano
          stratificirano
          {coverageLedger.insufficient ? ' · vitalni dokumenti izvan proračuna' : ''}
          {Array.isArray(coverageLedger.gaps) && coverageLedger.gaps.length > 0
            ? ` · praznine: ${coverageLedger.gaps.join('; ')}`
            : ''}
        </p>
      ) : null}

      {degraded.length > 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          {degraded.map((item, index) => (
            <span key={`degraded-${index}`} className="mr-3 inline-block">
              <span className="text-warning" aria-hidden="true">⚠</span>{' '}
              {item.reason || item.condition}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}