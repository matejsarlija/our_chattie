const STATUS = {
  discovery_only: { label: 'Samo otkrivanje', tone: 'border-slate-300 bg-slate-100 text-slate-700' },
  partial: { label: 'Djelomična analiza', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  sufficient: { label: 'Dostatna pokrivenost', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
};

const CATEGORY_LABELS = {
  docket_timeline: 'Tijek predmeta',
  documented_claims: 'Dokumentirane tražbine',
  current_procedural_status: 'Trenutačni procesni status',
  full_case_outcome: 'Cjelovit ishod predmeta',
};

const REASON_LABELS = {
  'failed-documents': 'Nisu analizirani svi dokumenti',
  'partial-corpus': 'Nije obuhvaćen cijeli pronađeni korpus',
  'no-final-distribution-statement': 'Nedostaje diobeni popis ili završni račun',
  'no-extracted-claims': 'Nema izdvojenih strukturiranih tražbina',
  'no-analyzed-documents': 'Nema uspješno analiziranih dokumenata',
  'latest-entry-not-analyzed': 'Najnoviji unos nije analiziran',
  'newer-evidence-unavailable': 'Noviji dokazi nisu dostupni',
};

const formatRange = (range) => {
  if (!range?.oldestEntryDate && !range?.newestEntryDate) return 'nije dostupno';
  const start = range.oldestEntryDate || '?';
  const end = range.newestEntryDate || '?';
  return start === end ? start : `${start} — ${end}`;
};

export default function AnalysisScopeCard({ scope }) {
  if (!scope) return null;
  const status = STATUS[scope.analysisStatus] || STATUS.discovery_only;
  const corpus = scope.corpus || {};
  const blockers = Array.isArray(scope.blockingEvidence) ? scope.blockingEvidence : [];
  const degraded = Array.isArray(scope.degraded) ? scope.degraded : [];

  return (
    <section className="mb-5 rounded-2xl border border-[var(--border)] border-l-4 border-l-amber-500 bg-[var(--surface)] p-4" aria-labelledby="analysis-scope-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Granice zaključka</p>
          <h2 id="analysis-scope-heading" className="mt-1 text-base font-semibold text-[var(--text)]">Što dokazi u ovoj analizi mogu potvrditi</h2>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-[var(--text-muted)]">Dokumenti</dt><dd className="mt-0.5 font-medium text-[var(--text)]">{corpus.analyzed ?? 0} / {corpus.total ?? 0}</dd></div>
        <div><dt className="text-xs text-[var(--text-muted)]">Unosi</dt><dd className="mt-0.5 font-medium text-[var(--text)]">{corpus.capturedEntries ?? '—'} / {corpus.totalResults ?? '—'}</dd></div>
        <div><dt className="text-xs text-[var(--text-muted)]">Odabrani predmet</dt><dd className="mt-0.5 font-medium text-[var(--text)]">{corpus.selectedCase || '—'}</dd></div>
        <div><dt className="text-xs text-[var(--text-muted)]">Vremenski raspon</dt><dd className="mt-0.5 font-medium text-[var(--text)]">{formatRange(corpus.dateRange)}</dd></div>
      </dl>

      <div className="mt-4 grid gap-4 border-t border-[var(--border)] pt-3 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Podržani zaključci</h3>
          <ul className="mt-2 space-y-1 text-sm text-[var(--text)]">
            {(scope.supported || []).map((category) => <li key={category}>✓ {CATEGORY_LABELS[category] || category}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Ograničenja</h3>
          {blockers.length > 0 || degraded.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-[var(--text-muted)]">
              {blockers.map((item, index) => <li key={`block-${index}`}>⚠ {CATEGORY_LABELS[item.category] || item.category}: {REASON_LABELS[item.reason] || item.reason}</li>)}
              {degraded.map((item, index) => <li key={`degraded-${index}`}>⚠ {item.reason || item.condition}</li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-[var(--text-muted)]">Nema zabilježenih ograničenja pokrivenosti.</p>}
        </div>
      </div>
    </section>
  );
}
