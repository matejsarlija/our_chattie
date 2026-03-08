import React from 'react';
import AnalysisCitationList from './AnalysisCitationList';

const getFindingText = (finding) => finding?.claim || finding?.text || finding?.summary || '';
const getTimelineText = (item) => item?.event || item?.description || item?.text || '';
const getConflictText = (item) => item?.description || item?.text || item?.summary || '';
const getOpenQuestionText = (item) => item?.question || item?.text || item?.description || '';

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

function TimelineSection({ timeline, showEmpty }) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    if (!showEmpty) return null;
    return (
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Vremenska crta</h3>
        <p className="text-sm text-[var(--text-muted)]">Nema dostupnih stavki vremenske crte.</p>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Vremenska crta</h3>
      <ul className="space-y-2">
        {timeline.map((item, index) => (
          <li key={`timeline-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]">
            {getTimelineText(item) || '-'}
            <AnalysisCitationList citations={item?.citations} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConflictsSection({ conflicts, showEmpty }) {
  if (!Array.isArray(conflicts) || conflicts.length === 0) {
    if (!showEmpty) return null;
    return (
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Konflikti</h3>
        <p className="text-sm text-[var(--text-muted)]">Nema prijavljenih konflikata.</p>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Konflikti</h3>
      <ul className="space-y-2">
        {conflicts.map((conflict, index) => (
          <li key={`conflict-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {getConflictText(conflict) || '-'}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenQuestionsSection({ openQuestions, showEmpty }) {
  if (!Array.isArray(openQuestions) || openQuestions.length === 0) {
    if (!showEmpty) return null;
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Otvorena pitanja</h3>
        <p className="text-sm text-[var(--text-muted)]">Nema otvorenih pitanja.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Otvorena pitanja</h3>
      <ul className="space-y-2">
        {openQuestions.map((item, index) => (
          <li key={`open-question-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]">
            {getOpenQuestionText(item) || '-'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalysisReportAnnex({
  findings,
  timeline,
  conflicts,
  openQuestions,
  hasStructuredReport = false,
}) {
  const hasAnnexData = (findings?.length || 0) > 0
    || (timeline?.length || 0) > 0
    || (conflicts?.length || 0) > 0
    || (openQuestions?.length || 0) > 0;
  if (!hasStructuredReport && !hasAnnexData) return null;
  const showEmpty = hasStructuredReport;

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Prilozi analize</h2>
      <FindingsSection findings={findings} showEmpty={showEmpty} />
      <TimelineSection timeline={timeline} showEmpty={showEmpty} />
      <ConflictsSection conflicts={conflicts} showEmpty={showEmpty} />
      <OpenQuestionsSection openQuestions={openQuestions} showEmpty={showEmpty} />
    </section>
  );
}
