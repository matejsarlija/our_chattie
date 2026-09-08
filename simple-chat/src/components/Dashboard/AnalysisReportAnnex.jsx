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
const getConflictText = (item) => getText(item, ['description', 'text', 'summary', 'reason', 'finding']);
const getOpenQuestionText = (item) => getText(item, ['question', 'text', 'description']);

// M-05: group conflicts/open questions by provenance class instead of one
// flat list — code-proven arithmetic mismatches, unresolved lifecycle-chain
// questions, and model-speculative follow-ups. Tagged items (source/kind from
// reconciliation) group deterministically; untagged legacy items (plain
// strings from older runs) fall back to text heuristics so old runs still group.
const GROUP_DEFS = [
  { key: 'code', label: 'Utvrđeno kodom — aritmetička nepodudaranja', kinds: ['arithmetic', 'property'] },
  { key: 'lifecycle', label: 'Životni ciklus tražbina — nerazriješena pitanja', kinds: ['lifecycle'] },
  { key: 'model', label: 'Modelska opažanja i provjera', kinds: [] },
];

const CODE_HINT = /ukupn|zbroj|različit/i;
const LIFECYCLE_HINT = /tražbin|lanca|potraživanju|stjecatelj|konkurentsk/i;

function itemKind(item, text) {
  if (item && typeof item === 'object' && typeof item.kind === 'string' && item.kind) return item.kind;
  if (CODE_HINT.test(text)) return 'arithmetic';
  if (LIFECYCLE_HINT.test(text)) return 'lifecycle';
  return 'model';
}

function groupItems(items, getTextFn) {
  const groups = { code: [], lifecycle: [], model: [] };
  for (const item of items || []) {
    const text = getTextFn(item);
    const kind = itemKind(item, text);
    if (GROUP_DEFS[0].kinds.includes(kind)) groups.code.push(item);
    else if (GROUP_DEFS[1].kinds.includes(kind)) groups.lifecycle.push(item);
    else groups.model.push(item);
  }
  return groups;
}

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

  const groups = groupItems(conflicts, getConflictText);
  const activeGroups = GROUP_DEFS.filter((def) => groups[def.key].length > 0);

  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Konflikti</h3>
      {activeGroups.map((def) => (
        <div key={def.key} className="mb-2">
          {activeGroups.length > 1 ? (
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{def.label}</p>
          ) : null}
          <ul className="space-y-2">
            {groups[def.key].map((conflict, index) => (
              <li key={`conflict-${def.key}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {getConflictText(conflict) || '-'}
              </li>
            ))}
          </ul>
        </div>
      ))}
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

  const groups = groupItems(openQuestions, getOpenQuestionText);
  const activeGroups = GROUP_DEFS.filter((def) => groups[def.key].length > 0);

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Otvorena pitanja</h3>
      {activeGroups.map((def) => (
        <div key={def.key} className="mb-2">
          {activeGroups.length > 1 ? (
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{def.label}</p>
          ) : null}
          <ul className="space-y-2">
            {groups[def.key].map((item, index) => (
              <li key={`open-question-${def.key}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]">
                {getOpenQuestionText(item) || '-'}
              </li>
            ))}
          </ul>
        </div>
      ))}
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
