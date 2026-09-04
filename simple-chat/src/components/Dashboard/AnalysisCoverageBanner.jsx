export default function AnalysisCoverageBanner({ coverage }) {
  if (!coverage) return null;

  const statusClass = coverage.complete
    ? 'border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text)]'
    : 'border border-amber-200 bg-amber-50 text-amber-800';

  const groundedClaims = Number.isFinite(coverage.groundedClaims) ? coverage.groundedClaims : null;
  const totalClaims = Number.isFinite(coverage.totalClaims) ? coverage.totalClaims : null;
  const showGrounding = groundedClaims !== null && totalClaims !== null && totalClaims > 0;

  return (
    <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">Pokrivenost analize dokumenata</h3>
          {coverage.complete ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Analizirano je {coverage.analyzed} od {coverage.total} dokumenata.
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Analizirano je {coverage.analyzed} od {coverage.total} dokumenata ({coverage.failed} nije uspjelo).
              Nalazi se temelje na uspješno analiziranim dokumentima; preostali mogu biti ključni za potpunu sliku.
            </p>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}>
          {coverage.complete ? 'Kompletno' : `${coverage.failed} neanalizirano`}
        </span>
      </div>
      {showGrounding && (
        <p className="mt-2 text-sm text-[var(--text-muted)]" data-testid="grounding-banner">
          {groundedClaims}/{totalClaims} navoda potvrđeno u izvornom tekstu
          {groundedClaims < totalClaims ? ' — nepotvrđeni navodi označeni su upozorenjem.' : '.'}
        </p>
      )}
      {Array.isArray(coverage.failedFiles) && coverage.failedFiles.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
            Prikaži neanalizirane datoteke ({coverage.failedFiles.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            {coverage.failedFiles.map((file, index) => (
              <li key={`failed-${index}`} className="flex flex-wrap gap-x-2 gap-y-0.5">
                <span className="font-medium text-[var(--text)]">{file.fileName}</span>
                <span>— {file.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
