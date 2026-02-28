/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { render } from '@testing-library/react';
import { useAnalysisEvents } from '../useAnalysisEvents';

function Harness({ events, onValue }) {
  const value = useAnalysisEvents(events);

  useEffect(() => {
    onValue(value);
  }, [value, onValue]);

  return null;
}

describe('useAnalysisEvents canonical stage parity', () => {
  test('exposes canonical stage keys in expected order', () => {
    let latest = null;

    render(
      <Harness
        events={[]}
        onValue={(value) => {
          latest = value;
        }}
      />,
    );

    expect(latest.stages.map((stage) => stage.key)).toEqual([
      'queued',
      'starting',
      'discovering',
      'grouping',
      'downloading',
      'extracting',
      'chunking',
      'retrieving',
      'reasoning',
      'verifying',
      'complete',
    ]);
  });

  test('maps legacy stage events to canonical timeline stages', () => {
    let latest = null;

    render(
      <Harness
        events={[
          { id: 'e1', event_type: 'fetching', message: 'Preuzimanje zapisa', created_at: '2026-02-27T10:00:00.000Z' },
          { id: 'e2', event_type: 'analyzing', message: 'Analiza sadržaja', created_at: '2026-02-27T10:01:00.000Z' },
          { id: 'e3', event_type: 'complete', message: 'Analiza je završena', created_at: '2026-02-27T10:02:00.000Z' },
        ]}
        onValue={(value) => {
          latest = value;
        }}
      />, 
    );

    expect(latest.timeline.map((event) => event.stage)).toEqual(['downloading', 'reasoning', 'complete']);
    expect(latest.current).toBe('complete');
  });

  test('flags terminal error stage and keeps stage list stable', () => {
    let latest = null;

    render(
      <Harness
        events={[
          { id: 'e1', event_type: 'starting', message: 'Start', created_at: '2026-02-27T10:00:00.000Z' },
          { id: 'e2', event_type: 'error', message: 'Greška u obradi', created_at: '2026-02-27T10:01:00.000Z' },
        ]}
        onValue={(value) => {
          latest = value;
        }}
      />,
    );

    expect(latest.isErrored).toBe(true);
    expect(latest.timeline[1].stage).toBe('error');
    expect(latest.stages.map((stage) => stage.key)).toContain('complete');
  });
});
