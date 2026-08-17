import React, { useState } from 'react';
import DepthDial from '../../components/Dashboard/DepthDial';

function StoryShell({ value: initialValue, disabled = false }) {
  const [value, setValue] = useState(initialValue);

  return (
    <main className="flex min-h-screen items-start justify-center bg-[var(--bg)] px-4 py-12">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
        <DepthDial value={value} onChange={setValue} disabled={disabled} />
      </div>
    </main>
  );
}

export default {
  title: 'Dashboard/NewAnalysis/DepthDial',
  component: StoryShell,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Rotary scan-depth control for the new-analysis modal. Three detents — Standardno (default window), Uravnoteženo (default window + 10 oldest entries), Sve dostupne (every page). Vertical drag or click-hold-and-turn to change; keyboard: ArrowUp/ArrowRight (+), ArrowDown/ArrowLeft (−), Home/End extremes. Exposes ARIA slider semantics with an informative value text.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    value: {
      control: 'select',
      options: ['standard', 'balanced', 'full'],
    },
  },
};

export const Standard = {
  args: { value: 'standard' },
};

export const Balanced = {
  args: { value: 'balanced' },
};

export const Full = {
  args: { value: 'full' },
};

export const Disabled = {
  args: { value: 'balanced', disabled: true },
};
