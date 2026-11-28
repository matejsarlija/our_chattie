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

const VERIFICATION_LABELS = {
  verified_deterministic: { glyph: '✓', label: 'Potvrđeno (zapis)' },
  verified_llm: { glyph: '✓', label: 'Potvrđeno (AI)' },
  unverified: { glyph: '⚠', label: 'Nepotvrđeno' },
  not_checked: { glyph: '•', label: 'Strukturno' },
};

function FindingsSection({ findings, showEmpty, onOpenEvidence }) {
  if (!Array.isArray(findings) || findings.length === 0) {
    if (!showEmpty) return null;
    return (
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">Nalazi</h3>
        <p className="text-sm text-ink-muted">Nema strukturiranih nalaza.</p>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">Nalazi</h3>
      <ul className="space-y-2">
        {findings.map((finding, index) => {
          const vMeta = finding?.verificationStatus ? VERIFICATION_LABELS[finding.verificationStatus] : null;
          return (
            <li key={finding?.id || `finding-${index}`} className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-ink">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span>{getFindingText(finding) || '-'}</span>
                {vMeta ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-ink-muted"
                    title={finding.verificationNote || vMeta.label}
                  >
                    <span aria-hidden="true">{vMeta.glyph}</span>
                    <span>{vMeta.label}</span>
                  </span>
                ) : null}
              </div>
              {finding?.verificationStatus === 'unverified' && finding?.verificationNote ? (
                <p className="mt-1 text-xs text-ink-muted">{finding.verificationNote}</p>
              ) : null}
              <AnalysisCitationList citations={finding?.citations} onOpenEvidence={onOpenEvidence} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Findings annex - ONE owner for findings.
 */
export default function AnalysisReportAnnex({
  findings,
  timeline: _unusedTimeline,
  hasStructuredReport = false,
  onOpenEvidence,
}) {
  const hasAnnexData = (findings?.length || 0) > 0;
  if (!hasStructuredReport && !hasAnnexData) return null;
  const showEmpty = hasStructuredReport;

  return (
    <section id="analysis-findings" className="card mt-5 scroll-mt-20 p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink">Prilozi analize</h2>
      <FindingsSection findings={findings} showEmpty={showEmpty} onOpenEvidence={onOpenEvidence} />
    </section>
  );
}
