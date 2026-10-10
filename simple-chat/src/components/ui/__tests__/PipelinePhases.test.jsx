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
});
