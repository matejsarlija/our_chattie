import React from 'react';

const rows = [
  {
    variant: 'SubtleRailDefault',
    status: 'Candidate',
    primarySignal: 'Stepper + latest timeline items',
    bestFor: 'Balanced default for mixed running/completed usage',
    risk: 'May still feel busy for highly result-focused readers',
    tryState: 'RunningRichEvents',
  },
  {
    variant: 'QuietFullStack',
    status: 'Candidate',
    primarySignal: 'Always-visible full stepper + full timeline',
    bestFor: 'Ops-heavy users who monitor process depth continuously',
    risk: 'Higher visual density; result can feel secondary',
    tryState: 'RunningRichEvents',
  },
  {
    variant: 'SignalLine',
    status: 'Candidate',
    primarySignal: 'Single current-stage line',
    bestFor: 'Minimal chrome with strong result focus',
    risk: 'May hide too much diagnostic detail by default',
    tryState: 'RunningSparseEvents',
  },
  {
    variant: 'ContextStrip',
    status: 'Candidate',
    primarySignal: 'Thin contextual strip under metadata',
    bestFor: 'Fast orientation with low visual footprint',
    risk: 'Less obvious progression through full pipeline',
    tryState: 'RunningSparseEvents',
  },
  {
    variant: 'RightRailMonitor',
    status: 'Candidate',
    primarySignal: 'Sticky side monitor (desktop)',
    bestFor: 'Long legal markdown reading + passive progress watch',
    risk: 'Can feel asymmetrical on narrow layouts',
    tryState: 'CompletedWithResult',
  },
  {
    variant: 'MilestoneDots',
    status: 'Candidate',
    primarySignal: 'Coarse milestones only',
    bestFor: 'Very quiet UI, high glanceability',
    risk: 'Lower fidelity for debugging or support',
    tryState: 'RunningSparseEvents',
  },
  {
    variant: 'ChronicleFirst',
    status: 'Candidate',
    primarySignal: 'Timeline first, stepper second',
    bestFor: 'Teams who trust event text over stage taxonomy',
    risk: 'Less structured pipeline narrative at glance',
    tryState: 'RunningRichEvents',
  },
  {
    variant: 'TerminalCompression',
    status: 'Candidate',
    primarySignal: 'Compressed process after terminal status',
    bestFor: 'Result-dominant completed workflow',
    risk: 'Post-mortem/debug context hidden until expanded',
    tryState: 'CompletedWithResult',
  },
  {
    variant: 'DashboardRichMetadata',
    status: 'Approved',
    primarySignal: 'Dashboard baseline + case-entry metadata + structured annex from result_json.report',
    bestFor: 'Users needing operational progress plus publication metadata and structured legal findings',
    risk: 'Annex can add vertical density when narrative + structured sections are both present',
    tryState: 'DashboardRichMetadata',
  },
  {
    variant: 'DashboardRichMetadataCompact',
    status: 'Candidate',
    primarySignal: 'Compact metadata card density with same field coverage',
    bestFor: 'Narrower detail pages or mobile-first density control',
    risk: 'Compact layout reduces scan comfort for long court names',
    tryState: 'DashboardRichMetadataCompact',
  },
];

function DecisionMatrixStory() {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8">
      <div className="mx-auto max-w-6xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-lg font-semibold text-[var(--text)]">Decision Matrix</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Pick a candidate variant here, then open the corresponding story under ProgressPresentation for visual validation.
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Baseline sync (2026-03-08): `DashboardRichMetadata` is the approved route direction.
        </p>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Governance reference: `D-08-full-governance-pass`.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-3 py-2">Variant</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Primary Signal</th>
                <th className="px-3 py-2">Best For</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Try State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-sm">
              {rows.map((row) => (
                <tr key={row.variant}>
                  <td className="px-3 py-2 font-medium text-[var(--text)]">{row.variant}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.status === 'Approved'
                          ? 'bg-emerald-100 text-emerald-700'
                          : row.status === 'Deprecated'
                            ? 'bg-slate-200 text-slate-600'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.primarySignal}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.bestFor}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{row.risk}</td>
                  <td className="px-3 py-2 text-[var(--accent)]">{row.tryState}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

export default {
  title: 'Dashboard/AnalysisDetail/DecisionMatrix',
  component: DecisionMatrixStory,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Selection helper matrix. Use it to choose a variant, then inspect that variant under Dashboard/AnalysisDetail/ProgressPresentation.',
      },
    },
  },
  tags: ['autodocs'],
};

export const Default = {};
