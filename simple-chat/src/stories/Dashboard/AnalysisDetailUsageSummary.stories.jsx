import React from 'react';
import AnalysisUsageSummary from '../../components/Dashboard/AnalysisUsageSummary';

function StoryShell({ usage, isRunning, model }) {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <AnalysisUsageSummary usage={usage} isRunning={isRunning} model={model} />
      </div>
    </main>
  );
}

export default {
  title: 'Dashboard/AnalysisDetail/UsageSummary',
  component: StoryShell,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Live token-usage summary shown while an analysis is running and retained after completion. Renders input/output/total tokens plus call count; hidden (renders nothing) when usage is absent. The running state adds a pulsing "ažurira se" indicator.',
      },
    },
  },
  tags: ['autodocs'],
};

export const Idle = {
  args: {
    usage: null,
    isRunning: false,
    model: 'gemini-2.5-flash',
  },
};

export const Accumulating = {
  args: {
    usage: {
      inputTokens: 128_432,
      outputTokens: 18_907,
      totalTokens: 147_339,
      calls: 12,
    },
    isRunning: true,
    model: 'gemini-2.5-flash',
  },
};

export const Final = {
  args: {
    usage: {
      inputTokens: 412_880,
      outputTokens: 57_214,
      totalTokens: 470_094,
      calls: 31,
    },
    isRunning: false,
    model: 'gemini-2.5-flash',
  },
};
