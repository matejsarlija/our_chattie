import React from 'react';
import AnalysisCitationList from './AnalysisCitationList';

const getFindingText = (finding) => finding?.claim || finding?.text || finding?.summary || '';
const getTimelineText = (item) => item?.event || item?.description || item?.text || '';
const getConflictText = (item) => item?.description || item?.text || item?.summary || '';

function FindingsSection({ findings }) {
  if (!Array.isArray(findings) || findings.length === 0) return null;

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

function TimelineSection({ timeline }) {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;

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

function ConflictsSection({ conflicts }) {
  if (!Array.isArray(conflicts) || conflicts.length === 0) return null;

  return (
    <div>
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

export default function AnalysisReportAnnex({ findings, timeline, conflicts }) {
  const hasAnnex = (findings?.length || 0) > 0 || (timeline?.length || 0) > 0 || (conflicts?.length || 0) > 0;
  if (!hasAnnex) return null;

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Prilozi analize</h2>
      <FindingsSection findings={findings} />
      <TimelineSection timeline={timeline} />
      <ConflictsSection conflicts={conflicts} />
    </section>
  );
}
