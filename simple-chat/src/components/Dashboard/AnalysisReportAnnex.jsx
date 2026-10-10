import React from 'react';
import AnalysisCitationList from './AnalysisCitationList';

const getText = (item, keys) => {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  for (const key of keys) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key];
  }
  return '';
};

const getFindingText = (finding) => getText(finding, ['claim', 'text', 'summary']);

function FindingsSection({ findings, showEmpty }) {
  if (!Array.isArray(findings) || findings.length === 0) {
    if (!showEmpty) return null;
    return (
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Nalazi</h3>
        <p className="text-sm text-[var(--text-muted)]">Nema strukturiranih nalaza.</p>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Nalazi</h3>
      <ul className="space-y-2">
        {findings.map((finding, index) => (
          <li key={`finding-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]">
            {getFindingText(finding) || '-'}
            <AnalysisCitationList citations={finding?.citations} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Findings annex - ONE owner for findings.
 *
 * The chronology that used to be rendered here as `TimelineSection` is now
 * `CaseTimeline`, which shows every recorded event with its citations in reading
 * order. Keeping both meant the same events rendered twice on one screen, which
 * is worse than either alone (AGENTS.md: "a single duplicated rendering surface
 * is worse than a missing one"). `timeline` is still accepted so the call site and
 * its tests stay stable, but it is deliberately not rendered.
 */
export default function AnalysisReportAnnex({
  findings,
  timeline: _unusedTimeline,
  hasStructuredReport = false,
}) {
  const hasAnnexData = (findings?.length || 0) > 0;
  if (!hasStructuredReport && !hasAnnexData) return null;
  const showEmpty = hasStructuredReport;

  return (
    <section id="analysis-findings" className="mt-5 scroll-mt-20 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Prilozi analize</h2>
      <FindingsSection findings={findings} showEmpty={showEmpty} />
    </section>
  );
}
