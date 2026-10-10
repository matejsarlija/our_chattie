import React from 'react';
import ReactMarkdown from 'react-markdown';
import ErrorBoundary from '../ErrorBoundary';

function getNextStepText(step) {
  if (typeof step === 'string') return step.trim();
  if (step && typeof step.text === 'string') return step.text.trim();
  return '';
}

export default function AnalysisCaseBrief({
  narrative,
  nextSteps = [],
  fallback,
  retryAction,
}) {
  const steps = (Array.isArray(nextSteps) ? nextSteps : [])
    .map(getNextStepText)
    .filter(Boolean);
  const text = typeof narrative === 'string' ? narrative.trim() : '';

  return (
    <section
      id="case-brief"
      className="card border-t-2 border-t-ink-muted p-5 sm:p-6"
      aria-labelledby="case-brief-heading"
      data-testid="analysis-case-brief"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Pregled izvještaja</p>
          <h2 id="case-brief-heading" className="mt-1 text-xl font-semibold tracking-tight text-ink">
            Sažetak predmeta
          </h2>
        </div>
        {retryAction}
      </div>
      {fallback ? <p className="mt-3 text-sm leading-relaxed text-ink-muted">{fallback}</p> : null}
      {text ? (
        <ErrorBoundary>
          <article className="prose prose-sm mt-3 max-w-[72ch] leading-relaxed text-ink prose-headings:font-semibold prose-headings:text-ink prose-p:text-ink prose-li:text-ink">
            <ReactMarkdown>{text}</ReactMarkdown>
          </article>
        </ErrorBoundary>
      ) : null}
      {steps.length > 0 ? (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-medium text-ink hover:text-accent">
            Sljedeći koraci ({steps.length})
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink-muted">
            {steps.map((step, index) => <li key={`next-step-${index}`}>{step}</li>)}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
