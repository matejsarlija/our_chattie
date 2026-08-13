import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { useCourtAnalysisStream } from '../useCourtAnalysisStream';

jest.mock('../../lib/env', () => ({
  env: {
    courtAnalysisUrl: '/api/court-analysis',
  },
}));

const createDoneReader = () => ({
  read: jest.fn(() => Promise.resolve({ done: true, value: undefined })),
});

describe('useCourtAnalysisStream request builder', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        body: {
          getReader: () => createDoneReader(),
        },
      }),
    );
  });

  test('sends typed oib query and legacy searchTerm for OIB input', async () => {
    function Harness() {
      const api = useCourtAnalysisStream();

      useEffect(() => {
        api.streamCourtAnalysis('12345678901', {
          onComplete: () => {},
          onError: () => {},
        });
      }, [api]);

      return null;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const call = global.fetch.mock.calls[0];
    const payload = JSON.parse(call[1].body);

    expect(payload).toEqual(expect.objectContaining({
      query: {
        type: 'oib',
        value: '12345678901',
      },
      searchTerm: '12345678901',
    }));
  });

  test('classifies case-number strings as case_number', async () => {
    function Harness() {
      const api = useCourtAnalysisStream();

      useEffect(() => {
        api.streamCourtAnalysis('St-357/2013', {
          onComplete: () => {},
          onError: () => {},
        });
      }, [api]);

      return null;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const call = global.fetch.mock.calls[0];
    const payload = JSON.parse(call[1].body);

    expect(payload.query).toEqual({ type: 'case_number', value: 'St-357/2013' });
    expect(payload.searchTerm).toBe('St-357/2013');
  });

  test('accepts explicit typed query object without reclassification', async () => {
    function Harness() {
      const api = useCourtAnalysisStream();

      useEffect(() => {
        api.streamCourtAnalysis({ type: 'text', value: 'adriatic osiguranje' }, {
          onComplete: () => {},
          onError: () => {},
        });
      }, [api]);

      return null;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const call = global.fetch.mock.calls[0];
    const payload = JSON.parse(call[1].body);

    expect(payload.query).toEqual({ type: 'text', value: 'adriatic osiguranje' });
    expect(payload.searchTerm).toBe('adriatic osiguranje');
  });

  test('does not throw in debug branch when process is unavailable', async () => {
    const previousProcess = global.process;
    Object.defineProperty(global, 'process', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    function Harness() {
      const api = useCourtAnalysisStream();

      useEffect(() => {
        api.streamCourtAnalysis('12345678901', {
          onComplete: () => {},
          onError: () => {},
        });
      }, [api]);

      return null;
    }

    try {
      render(<Harness />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    } finally {
      Object.defineProperty(global, 'process', {
        value: previousProcess,
        configurable: true,
        writable: true,
      });
    }
  });

  test('classifies 6-letter case-number prefix correctly (A-02b parity)', async () => {
    function Harness() {
      const api = useCourtAnalysisStream();

      useEffect(() => {
        api.streamCourtAnalysis('Abcdef-123/2023', {
          onComplete: () => {},
          onError: () => {},
        });
      }, [api]);

      return null;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const call = global.fetch.mock.calls[0];
    const payload = JSON.parse(call[1].body);

    expect(payload.query).toEqual({ type: 'case_number', value: 'Abcdef-123/2023' });
  });

  test('forwards progress events from SSE stream', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"step":"starting","progress":5,"message":"start"}\n\n',
      'data: {"step":"complete","progress":100,"message":"done","data":{"comparativeAnalysis":"ok"}}\n\n',
    ];
    let index = 0;
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        body: {
          getReader: () => ({
            read: jest.fn(() => {
              if (index >= chunks.length) {
                return Promise.resolve({ done: true, value: undefined });
              }
              return Promise.resolve({ done: false, value: encoder.encode(chunks[index++]) });
            }),
          }),
        },
      }),
    );

    const onProgress = jest.fn();
    const onComplete = jest.fn();

    function Harness() {
      const api = useCourtAnalysisStream();

      useEffect(() => {
        api.streamCourtAnalysis('66124057408', { onProgress, onComplete, onError: () => {} });
      }, [api]);

      return null;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ step: 'starting', progress: 5 }));
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ comparativeAnalysis: 'ok' }));
    });
  });
});
