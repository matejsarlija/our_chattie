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
  const citedCount = variant?.deterministicScorecard?.sourceSupport?.reportFindingsWithValidCitations;

  return (
    <article
      aria-label={`Izvještaj profila ${profileLabel(profileId)}`}
      className="flex min-w-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <strong className="text-base font-semibold text-[var(--text)]">{profileLabel(profileId)}</strong>
        <span className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          {profileId}
        </span>
      </div>

      {failed ? (
        <div role="alert" className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <strong className="block">Varijanta nije uspjela.</strong>
          {variant?.errorMessage || 'Pozadinski poziv nije uspio; uspješne varijante ostaju čitljive.'}
        </div>
      ) : (
        <>
          {scope && (
            <div className="flex items-start gap-2 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <span aria-hidden="true" className="font-bold text-amber-700">!</span>
              <div>
                <b className="block text-sm text-[var(--text)]">
                  {scope.analysisStatus === 'sufficient' ? 'Dovoljna analiza' : 'Djelomična analiza'}
                </b>
                {Array.isArray(scope.blocked) && scope.blocked.length > 0 && (
                  <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                    {scope.blocked.length} blokiranih zaključaka.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="border-b border-[var(--border)] px-4 py-4">
            <MarkdownNarrative narrative={report.narrative} />
          </div>

          <div className="border-b border-[var(--border)] px-4 py-4">
            <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Nalazi</h3>
            {findings.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Nema strukturiranih nalaza.</p>
            ) : (
              <ul className="space-y-2">
                {findings.map((finding, index) => (
                  <li key={`lab-finding-${profileId}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]">
                    {findingText(finding) || '-'}
                    <AnalysisCitationList citations={finding?.citations} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {openQuestions.length > 0 && (
            <div className="border-b border-[var(--border)] px-4 py-4">
              <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Otvoreno za provjeru</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text)]">
                {openQuestions.map((question, index) => (
                  <li key={`lab-open-${profileId}-${index}`}>{questionText(question) || '-'}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-auto flex items-center justify-between gap-2 px-4 py-3 font-mono text-xs text-[var(--text-muted)]">
            <span aria-label={`${citedCount ?? findings.length} nalaza s valjanim citatima`}>
              {citedCount ?? findings.length} nalaza s valjanim citatima
            </span>
            <button
              type="button"
              onClick={() => onOpenFragments?.(profileId)}
              className="rounded border border-[var(--border)] px-2 py-1 text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Pogledaj fragmente →
            </button>
          </div>
        </>
      )}
    </article>
  );
}
