import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { buildCourtAnalysisPayload, useCourtAnalysisStream } from '../useCourtAnalysisStream';

jest.mock('../../lib/env', () => ({
  env: {
    courtAnalysisUrl: '/api/court-analysis',
  },
}));


describe('useCourtAnalysisStream request builder', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 202,
        json: () => Promise.resolve({ analysisId: 'run-123', status: 'queued' }),
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

  test('threads scanDepth option into the request payload', async () => {
    function Harness() {
      const api = useCourtAnalysisStream();

      useEffect(() => {
        api.streamCourtAnalysis('12345678901', { onComplete: () => {}, onError: () => {} }, { scanDepth: 'full' });
      }, [api]);

      return null;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const call = global.fetch.mock.calls[0];
    const payload = JSON.parse(call[1].body);

    expect(payload.options).toEqual({ scanDepth: 'full' });
  });

  test('buildCourtAnalysisPayload defaults to balanced scanDepth', () => {
    expect(buildCourtAnalysisPayload('12345678901').options).toEqual({ scanDepth: 'balanced' });
    expect(buildCourtAnalysisPayload('12345678901', { scanDepth: 'standard' }).options).toEqual({ scanDepth: 'standard' });
  });

  test('consumes the 202 queued response JSON instead of opening an SSE body', async () => {
    const onAccepted = jest.fn();
    function Harness() {
      const api = useCourtAnalysisStream();
      useEffect(() => {
        api.streamCourtAnalysis('66124057408', { onAccepted });
      }, [api]);
      return null;
    }

    render(<Harness />);
    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledWith({ analysisId: 'run-123', status: 'queued' });
    });
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
  });
});
