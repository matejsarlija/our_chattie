import ReactMarkdown from 'react-markdown';
import ErrorBoundary from '../../ErrorBoundary';
import AnalysisCitationList from '../AnalysisCitationList';
import { profileLabel } from './labMeta';

const findingText = (finding) => {
  if (typeof finding === 'string') return finding;
  if (finding && typeof finding === 'object') {
    for (const key of ['text', 'claim', 'summary']) {
      if (typeof finding[key] === 'string' && finding[key].trim()) return finding[key];
    }
  }
  return '';
};

const questionText = (question) => {
  if (typeof question === 'string') return question;
  if (question && typeof question === 'object') {
    for (const key of ['text', 'question', 'description']) {
      if (typeof question[key] === 'string' && question[key].trim()) return question[key];
    }
  }
  return '';
};
const hasSourceReference = (finding) => {
  const references = [...(Array.isArray(finding?.citations) ? finding.citations : []), ...(Array.isArray(finding?.evidence) ? finding.evidence : [])];
  return references.some((reference) => {
    const id = reference?.sourceId || reference?.source || reference?.id || reference?.fileName;
    return typeof id === 'string' && id.trim().length > 0;
  });
};

function MarkdownNarrative({ narrative }) {
  if (!narrative || !String(narrative).trim()) {
    return <p className="text-sm text-[var(--text-muted)]">Pripovijest nije dostupna za ovu varijantu.</p>;
  }
  return (
    <ErrorBoundary>
      <article className="prose max-w-none prose-sm prose-slate">
        <ReactMarkdown>{String(narrative)}</ReactMarkdown>
      </article>
    </ErrorBoundary>
  );
}

export default function LabVariantReport({ profileId, variant, onOpenFragments }) {
  const failed = !variant || variant.status === 'error' || !variant.report;
  const report = variant?.report || {};
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const openQuestions = Array.isArray(report.openQuestions) ? report.openQuestions : [];
  const scope = report?.meta?.scope && typeof report.meta.scope === 'object' ? report.meta.scope : null;
  const scorecard = variant?.deterministicScorecard;
  const citedCount = scorecard?.sourceSupport?.reportFindingsWithValidCitations;
  const findingCount = scorecard?.sourceSupport?.reportFindingsTotal ?? findings.length;
  const calls = scorecard?.cost?.calls ?? variant?.usage?.calls;
  const totalTokens = scorecard?.cost?.totalTokens ?? variant?.usage?.totalTokens;
  const scopeStatus = scope?.analysisStatus || scorecard?.coverage?.scopeStatus;
  const scopeLabel = scopeStatus === 'sufficient'
    ? 'Dovoljna analiza'
    : scopeStatus === 'partial' || scopeStatus === 'insufficient'
      ? 'Djelomična analiza'
      : 'Status pokrivenosti nije dostupan';
  const citationLabel = citedCount == null || citedCount === 'unknown'
    ? 'Broj nalaza s navedenim izvorom nije dostupan'
    : `${citedCount} od ${findingCount === 'unknown' ? 'nepoznatog broja' : findingCount} nalaza navodi izvorni dokument`;

  return (
    <article
      aria-label={`Izvještaj profila ${profileLabel(profileId)}`}
      className="flex min-w-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <strong className="block text-base font-semibold text-[var(--text)]">{profileLabel(profileId)}</strong>
          <details className="mt-1 text-xs text-[var(--text-muted)]">
            <summary className="w-fit cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2">
              Tehnički ID profila
            </summary>
            <code className="mt-1 block break-all">{profileId}</code>
          </details>
        </div>
        <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]">
          {failed ? 'Neuspjela' : variant.status === 'partial' || scopeStatus === 'partial' ? 'Djelomična' : 'Dovršena'}
        </span>
      </div>

      {failed ? (
        <div role="alert" className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <strong className="block">Varijanta nije uspjela.</strong>
          {variant?.errorMessage || 'Pozadinski poziv nije uspio; uspješne varijante ostaju čitljive.'}
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4">
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Pokrivenost</dt>
              <dd className="mt-0.5 text-sm font-medium text-[var(--text)]">{scopeLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Izvori navedeni uz nalaz</dt>
              <dd className="mt-0.5 text-sm font-medium text-[var(--text)]">{citationLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Otvorena pitanja</dt>
              <dd className="mt-0.5 text-sm font-medium text-[var(--text)]">{openQuestions.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-muted)]">Trošak modela</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-[var(--text)]">
                {calls ?? '?'} poziva · {totalTokens ?? '?'} tokena
              </dd>
            </div>
          </dl>

          <details className="border-t border-[var(--border)]">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
              <span>Otvori puni izvještaj</span>
              <span className="text-xs font-normal text-[var(--text-muted)]">
                {findingCount} nalaza · {openQuestions.length} pitanja
              </span>
            </summary>

            {scope && (
              <div className="flex items-start gap-2 border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
                <span aria-hidden="true" className="font-bold text-amber-700">!</span>
                <div>
                  <b className="block text-sm text-[var(--text)]">{scopeLabel}</b>
                  {Array.isArray(scope.blocked) && scope.blocked.length > 0 && (
                    <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                      {scope.blocked.length} blokiranih zaključaka.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="border-t border-[var(--border)] px-4 py-4">
              <MarkdownNarrative narrative={report.narrative} />
            </div>

            <div className="border-t border-[var(--border)] px-4 py-4">
              <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Nalazi</h3>
              {findings.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Nema strukturiranih nalaza.</p>
              ) : (
                <ul className="space-y-2">
                  {findings.map((finding, index) => (
                    <li key={`lab-finding-${profileId}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]">
                      {findingText(finding) || '-'}
                      <AnalysisCitationList citations={finding?.citations} />
                      {!hasSourceReference(finding) && (
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          Ovaj nalaz nema poveznicu na izvorni dokument.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {openQuestions.length > 0 && (
              <div className="border-t border-[var(--border)] px-4 py-4">
                <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Otvoreno za provjeru</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text)]">
                  {openQuestions.map((question, index) => (
                    <li key={`lab-open-${profileId}-${index}`}>{questionText(question) || '-'}</li>
                  ))}
                </ul>
              </div>
            )}
          </details>

          <div className="mt-auto border-t border-[var(--border)] px-4 py-3">
            <button
              type="button"
              onClick={() => onOpenFragments?.(profileId)}
              className="min-h-11 w-full rounded border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Pregledaj izvore →
            </button>
          </div>
        </>
      )}
    </article>
  );
}
