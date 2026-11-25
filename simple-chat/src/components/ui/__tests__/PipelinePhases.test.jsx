import React from 'react';
import { render, screen } from '@testing-library/react';
import PipelinePhases from '../PipelinePhases';

describe('PipelinePhases', () => {
  test('uses persisted terminal run status even when the last event is still marked active', () => {
    render(<PipelinePhases runStatus="done" stages={[{ key: 'complete', label: 'Završeno', active: true }]} />);

    expect(screen.getByRole('heading', { name: 'Završeno' })).toBeInTheDocument();
  });

  test('shows in-progress when the run is active', () => {
    render(<PipelinePhases runStatus="running" stages={[{ key: 'extracting', label: 'Obrada', active: true }]} />);

    expect(screen.getByRole('heading', { name: 'U tijeku' })).toBeInTheDocument();
  });

  test.each([
    ['queued', 'U redu čekanja', 'ink-muted'],
    ['partial', 'Djelomično', 'warning'],
    ['interrupted', 'Prekinuto', 'warning'],
    ['canceled', 'Otkazano', 'ink-muted'],
  ])('renders %s with a glyph, label, and tone', (status, label, tone) => {
    render(<PipelinePhases runStatus={status} stages={[]} />);
    const heading = screen.getByRole('heading', { name: label });
    expect(heading.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(heading.querySelector(`.text-${tone}`)).toBeTruthy();
  });
});
