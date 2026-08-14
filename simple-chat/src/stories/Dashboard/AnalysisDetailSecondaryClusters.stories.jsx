import React from 'react';
import SecondaryClustersSection from '../../components/Dashboard/SecondaryClustersSection';

function StoryShell({ clusters = [] }) {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8">
      <div className="mx-auto max-w-6xl">
        {clusters.length === 0 && (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
            Single-cluster upit — sekcija „Ostali pronađeni predmeti“ se ne prikazuje.
          </p>
        )}
        <SecondaryClustersSection clusters={clusters} />
      </div>
    </main>
  );
}

const SAMPLE_CLUSTERS = [
  {
    clusterId: 'Povrv-297/2020',
    entryCount: 4,
    documentCount: 7,
    participantNames: ['KERUM d.o.o.', 'Republika Hrvatska'],
    identityConsistency: 'consistent',
    acquisitionProvenance: [{ mode: 'case-number-follow-up' }],
  },
  {
    clusterId: 'P-170/2023',
    entryCount: 2,
    documentCount: 3,
    participantNames: ['KERUM d.o.o.'],
    identityConsistency: 'ambiguous',
    acquisitionProvenance: [{ mode: 'cluster-expansion' }],
  },
];

export default {
  title: 'Dashboard/AnalysisDetail/SecondaryClusters',
  component: StoryShell,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Secondary discovered clusters surfaced below the primary case analysis, with entry/doc counts, participant names, and an identity-consistency badge. Hidden entirely for single-cluster runs.',
      },
    },
  },
  tags: ['autodocs'],
};

export const MultipleClusters = {
  args: {
    clusters: SAMPLE_CLUSTERS,
  },
};

export const SingleClusterHidden = {
  args: {
    clusters: [],
  },
};
