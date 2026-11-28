/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RunTracesDrawer from '../RunTracesDrawer';
import { listRunTraces, getRunTrace } from '../../../lib/apiClient';

vi.mock('../../../lib/apiClient', () => ({
  listRunTraces: vi.fn(),
  getRunTrace: vi.fn(),
}));

describe('RunTracesDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('loads traces lazily on open and fetches trace detail on click', async () => {
    listRunTraces.mockResolvedValue({
      traces: [
        {
          id: 'trace-1',
          taskType: 'extraction',
          actualModel: 'z-ai/glm-5.3-flash',
          actualProvider: 'openrouter',
          finishReason: 'stop',
          costUsd: 0.0021,
          validationErrors: ['missing_date'],
          createdAt: '2026-03-01T12:00:00.000Z',
        },
      ],
      total: 1,
    });
    getRunTrace.mockResolvedValue({
      id: 'trace-1',
      actualModel: 'z-ai/glm-5.3-flash',
      actualProvider: 'openrouter',
      finishReason: 'stop',
      ttftMs: 210,
      latencyMs: 950,
      costUsd: 0.0021,
      validationErrors: ['missing_date'],
      rawResponse: '{"amounts": []}',
    });

    render(<RunTracesDrawer runId="run-1" isOpen onClose={vi.fn()} />);

    await waitFor(() => {
      expect(listRunTraces).toHaveBeenCalledWith('run-1', { limit: 50, offset: 0 }, expect.any(Object));
    });

    const traceBtn = await screen.findByText(/extraction · z-ai\/glm-5\.3-flash/);
    fireEvent.click(traceBtn);

    await waitFor(() => {
      expect(getRunTrace).toHaveBeenCalledWith('run-1', 'trace-1');
    });
    expect(await screen.findByText('{"amounts": []}')).toBeInTheDocument();
    expect(screen.getByText(/210 ms \/ 950 ms/)).toBeInTheDocument();
  });
});
