import React from 'react';
import AnalysisCoverageBanner from '../../components/Dashboard/AnalysisCoverageBanner';

function StoryShell({ coverage }) {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <AnalysisCoverageBanner coverage={coverage} />
      </div>
    </main>
  );
}

export default {
  title: 'Dashboard/AnalysisDetail/CoverageBanner',
  component: StoryShell,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Transparency banner showing how many documents were actually read by the AI. Complete state is neutral; a partial state uses an amber warning and exposes the failed file list. Renders nothing when coverage is absent.',
      },
    },
  },
  tags: ['autodocs'],
};

export const Complete = {
  args: {
    coverage: {
      analyzed: 50,
      total: 50,
      failed: 0,
      complete: true,
      failedFiles: [],
    },
  },
};

export const Partial = {
  args: {
    coverage: {
      analyzed: 13,
      total: 18,
      failed: 5,
      complete: false,
      coverageRatio: 0.72,
      failedFiles: [
        { fileName: 'dokument-004.pdf', reason: 'Gemini timeout' },
        { fileName: 'dokument-009.pdf', reason: 'Nečitljiv PDF' },
        { fileName: 'dokument-013.pdf', reason: 'Gemini timeout' },
      ],
    },
  },
};
