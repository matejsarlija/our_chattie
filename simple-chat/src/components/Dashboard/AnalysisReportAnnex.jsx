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
const getTimelineText = (item) => getText(item, ['event', 'description', 'title', 'text']);

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
            {item?.date && (
              <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                {String(item.date)}
              </span>
            )}
            {getTimelineText(item) || '-'}
            <AnalysisCitationList citations={item?.citations} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalysisReportAnnex({
  findings,
  timeline,
  hasStructuredReport = false,
}) {
  const hasAnnexData = (findings?.length || 0) > 0 || (timeline?.length || 0) > 0;
  if (!hasStructuredReport && !hasAnnexData) return null;
  const showEmpty = hasStructuredReport;

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Prilozi analize</h2>
      <FindingsSection findings={findings} showEmpty={showEmpty} />
      <TimelineSection timeline={timeline} showEmpty={showEmpty} />
    </section>
  );
}
