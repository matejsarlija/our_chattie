import { formatRatio } from '../ui/format';

/**
 * "Pokrivenost analize" — the trust gate, and the first thing in the answer
 * column.
 *
 * The old version used an amber-tinted pill for an incomplete run and a neutral
 * one for a complete run, which reads as an alarm on most rows. This version
 * states the figures plainly, keeps the meter neutral, and separates "we
 * analysed less than everything" from "the run never finished" — for a legal
 * matter those are different facts and must not look alike.
 *
 * `failedFiles` exists as OBJECTS from the current producer but as bare STRINGS
 * in the frozen replay fixture; both are normalised so the old shape cannot
 * render `undefined`.
 *
 * The `reason` is kept when present — it is the part that tells the reader what
 * to do next ("Dnevni limit AI analize je iscrpljen. Pokušajte ponovno
 * sutra."). An earlier rewrite of this card kept only the filename and lost it.
 */
function failedFileEntry(file) {
  if (typeof file === 'string') return { name: file, reason: null };
  return { name: file?.fileName || null, reason: file?.reason || null };
}

export default function AnalysisCoverageBanner({ coverage, status }) {
  if (!coverage) return null;

  const analyzed = Number.isFinite(coverage.analyzed) ? coverage.analyzed : null;
  const total = Number.isFinite(coverage.total) ? coverage.total : null;
  const failed = Number.isFinite(coverage.failed) ? coverage.failed : null;
  const partial = Number.isFinite(coverage.partial) ? coverage.partial : null;

  const grounded = Number.isFinite(coverage.groundedClaims) ? coverage.groundedClaims : null;
  const totalClaims = Number.isFinite(coverage.totalClaims) ? coverage.totalClaims : null;
  const showGrounding = grounded !== null && totalClaims !== null && totalClaims > 0;

  const ratio = formatRatio(coverage.coverageRatio)
    ?? (total && analyzed !== null ? formatRatio(analyzed / total) : null);

  const failedFiles = (Array.isArray(coverage.failedFiles) ? coverage.failedFiles : [])
    .map(failedFileEntry)
    .filter((file) => file.name);
  const partialFiles = (Array.isArray(coverage.partialFiles) ? coverage.partialFiles : [])
    .filter((file) => file?.fileName);
  return (
    <section id="analysis-coverage" className="card p-5 scroll-mt-20" aria-labelledby="coverage-heading">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 id="coverage-heading" className="sec-title">Pokrivenost analize</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {analyzed ?? '—'} od {total ?? '—'} dokumenata
            {failed ? ` · ${failed} nije uspjelo` : ''}
            {partial ? ` · ${partial} djelomično obrađeno` : ''}
          </p>
        </div>
        {showGrounding ? (
          <div className="text-right">
            <div className="text-base tabular-nums text-ink">
              <span className="text-xl">{grounded}</span>
              <span className="text-ink-muted">/{totalClaims}</span>
            </div>
            <div className="text-xs text-ink-muted">navoda potvrđeno u izvornom tekstu</div>
          </div>
        ) : null}
      </div>

      {ratio ? (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
          role="img"
          aria-label={`Analizirano ${analyzed ?? '—'} od ${total ?? '—'} dokumenata, ${ratio}`}
        >
          <div className="h-full rounded-full bg-ink-muted" style={{ width: ratio }} />
        </div>
      ) : null}

      {showGrounding ? (
        <p className="sr-only" data-testid="grounding-banner">
          {grounded}/{totalClaims} navoda potvrđeno u izvornom tekstu
        </p>
      ) : null}

      {failedFiles.length > 0 ? (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs text-ink-muted hover:text-ink">
            Dokumenti koji nisu analizirani ({failedFiles.length})
          </summary>
          <ul className="mt-2 space-y-1 border-l-2 border-line pl-3">
            {failedFiles.map((file) => (
              <li key={file.name} className="text-xs text-ink-muted">
                <span className="font-medium text-ink">{file.name}</span>
                {file.reason ? <> — {file.reason}</> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {partialFiles.length > 0 ? (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs text-ink-muted hover:text-ink">
            Dokumenti obrađeni djelomično ({partialFiles.length})
          </summary>
          <ul className="mt-2 space-y-1 border-l-2 border-line pl-3">
            {partialFiles.map((file) => {
              const chunks = file.analysisChunks;
              const detail = file.degraded && chunks
                ? `${chunks.completed ?? 0}/${chunks.total ?? '?'} odlomaka analizirano`
                : file.extraction?.truncated
                  ? `izdvajanje teksta skraćeno${file.extraction.pages ? ` nakon ${file.extraction.pages} stranica` : ''}`
                  : 'izdvajanje teksta nije potpuno';
              return (
                <li key={file.fileName} className="text-xs text-ink-muted">
                  <span className="font-medium text-ink">{file.fileName}</span> — {detail}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}