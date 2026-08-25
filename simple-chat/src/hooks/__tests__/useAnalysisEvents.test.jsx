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

  test('maps processing_case and enriching aliases to grouping', () => {
    let latest = null;

    render(
      <Harness
        events={[
          { id: 'e1', event_type: 'processing_case', message: 'Obrada predmeta', created_at: '2026-02-27T10:00:00.000Z' },
          { id: 'e2', event_type: 'enriching', message: 'Obogaćivanje metapodataka', created_at: '2026-02-27T10:01:00.000Z' },
        ]}
        onValue={(value) => {
          latest = value;
        }}
      />,
    );

    expect(latest.timeline.map((event) => event.stage)).toEqual(['grouping', 'grouping']);
    expect(latest.current).toBe('grouping');
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

  test('separates file/heartbeat activity from the stage timeline', () => {
    let latest = null;

    render(
      <Harness
        events={[
          { id: 'e1', event_type: 'reasoning', message: 'Analiziram 3 datoteka...', created_at: '2026-08-21T10:00:00.000Z' },
          {
            id: 'a1',
            event_type: 'analyzing',
            message: 'Analiziran dokument 1/3: A.pdf',
            created_at: '2026-08-21T10:00:05.000Z',
            metadata: { kind: 'file', fileName: 'A.pdf', status: 'ok', done: 1, failed: 0, total: 3, durationMs: 4200 },
          },
          {
            id: 'a2',
            event_type: 'analyzing',
            message: '',
            created_at: '2026-08-21T10:00:35.000Z',
            metadata: { kind: 'heartbeat', done: 1, failed: 0, total: 3, currentFile: 'B.pdf' },
          },
          { id: 'e2', event_type: 'complete', message: 'Analiza je završena!', created_at: '2026-08-21T10:01:00.000Z' },
        ]}
        onValue={(value) => {
          latest = value;
        }}
      />,
    );

    // Activity events must not flood the timeline or advance the stepper.
    expect(latest.timeline.map((event) => event.id)).toEqual(['e1', 'e2']);
    expect(latest.current).toBe('complete');

    expect(latest.activity.map((event) => event.id)).toEqual(['a1', 'a2']);
    expect(latest.activity[0].kind).toBe('file');
    expect(latest.activity[0].fileName).toBe('A.pdf');
    expect(latest.activity[0].status).toBe('ok');
    expect(latest.activity[0].total).toBe(3);
    expect(latest.activity[1].kind).toBe('heartbeat');
    expect(latest.activity[1].currentFile).toBe('B.pdf');
  });

  test('surfaces the backend-classified reason alongside the raw error on failed file events', () => {
    let latest = null;

    render(
      <Harness
        events={[
          {
            id: 'a1',
            event_type: 'analyzing',
            message: 'Neuspješna analiza 1/2: A.pdf',
            created_at: '2026-08-21T10:00:05.000Z',
            metadata: {
              kind: 'file',
              fileName: 'A.pdf',
              status: 'failed',
              done: 0,
              failed: 1,
              total: 2,
              error: 'Gemini request timed out after 30000ms',
              reason: 'Zahtjev AI servisu je premašio dopušteno vrijeme čekanja i automatski je prekinut. Pokušajte ponovno.',
              reasonCode: 'timeout',
            },
          },
        ]}
        onValue={(value) => {
          latest = value;
        }}
      />,
    );

    expect(latest.activity[0].reason).toBe('Zahtjev AI servisu je premašio dopušteno vrijeme čekanja i automatski je prekinut. Pokušajte ponovno.');
    expect(latest.activity[0].error).toBe('Gemini request timed out after 30000ms');
  });
});
