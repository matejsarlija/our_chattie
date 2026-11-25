/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewAnalysisModal from '../NewAnalysisModal';
import { useCourtAnalysisStream } from '../../../hooks/useCourtAnalysisStream';
import { useSettings } from '../../../hooks/useSettings';

const mockNavigate = jest.fn();
const mockStreamCourtAnalysis = jest.fn();

jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

jest.mock('../../../hooks/useCourtAnalysisStream', () => ({
  useCourtAnalysisStream: jest.fn(),
}));
jest.mock('../../../hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

describe('NewAnalysisModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettings.mockReturnValue({ settings: { defaultScanDepth: 'balanced' } });
    useCourtAnalysisStream.mockReturnValue({
      isLoading: false,
      streamCourtAnalysis: mockStreamCourtAnalysis,
    });
  });

  test('uses the saved scan depth when opening a new analysis', () => {
    useSettings.mockReturnValue({ settings: { defaultScanDepth: 'full' } });
    render(<NewAnalysisModal isOpen onClose={jest.fn()} />);

    expect(screen.getByLabelText(/dubina pretrage/i)).toHaveValue('full');
  });

  test('blocks an empty query before submit', async () => {
    render(<NewAnalysisModal isOpen onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pokreni/i }));

    const queryInput = screen.getByLabelText('Upit');
    expect(await screen.findByRole('alert')).toHaveTextContent(/upit ne smije biti prazan/i);
    expect(queryInput).toHaveAttribute('aria-invalid', 'true');
    expect(queryInput).toHaveAttribute('aria-describedby');
    expect(mockStreamCourtAnalysis).not.toHaveBeenCalled();
  });

  test('focuses the query field and closes with Escape', () => {
    const onClose = jest.fn();
    render(
      <>
        <button type="button">Otvori analizu</button>
        <NewAnalysisModal isOpen onClose={onClose} />
      </>,
    );

    expect(screen.getByLabelText('Upit')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });


  test('navigates to detail when the 202 response includes analysisId', async () => {
    const onClose = jest.fn();
    mockStreamCourtAnalysis.mockResolvedValue({ analysisId: 'run-123', status: 'queued' });

    render(<NewAnalysisModal isOpen onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Upit'), { target: { value: '12345678901' } });
    fireEvent.click(screen.getByRole('button', { name: /pokreni/i }));

    await waitFor(() => {
      expect(mockStreamCourtAnalysis).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard/runs/run-123');
    });
  });

  test.each(['12345678901', 'St-357/2013', 'građevinska dozvola'])(
    'passes the query unchanged to streamCourtAnalysis: %s',
    async (query) => {
      mockStreamCourtAnalysis.mockResolvedValue(undefined);
      render(<NewAnalysisModal isOpen onClose={jest.fn()} />);

      fireEvent.change(screen.getByLabelText('Upit'), { target: { value: query } });
      fireEvent.click(screen.getByRole('button', { name: /pokreni/i }));

      await waitFor(() => {
        expect(mockStreamCourtAnalysis).toHaveBeenCalledWith(query, expect.any(Object), {
          scanDepth: 'balanced',
        });
      });
    },
  );

  test('threads the selected scan depth into the stream request', async () => {
    mockStreamCourtAnalysis.mockResolvedValue(undefined);

    render(<NewAnalysisModal isOpen onClose={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Upit'), { target: { value: '12345678901' } });
    fireEvent.change(screen.getByLabelText(/dubina pretrage/i), { target: { value: 'full' } });
    fireEvent.click(screen.getByRole('button', { name: /pokreni/i }));

    await waitFor(() => {
      expect(mockStreamCourtAnalysis).toHaveBeenCalledWith(
        '12345678901',
        expect.any(Object),
        { scanDepth: 'full' },
      );
    });
  });

  test('shows error message when streaming fails', async () => {
    mockStreamCourtAnalysis.mockImplementation(async (_searchTerm, callbacks) => {
      callbacks.onError('Neuspjelo pokretanje analize.', { status: 500 });
    });

    render(<NewAnalysisModal isOpen onClose={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Upit'), { target: { value: '12345678901' } });
    fireEvent.click(screen.getByRole('button', { name: /pokreni/i }));

    expect(await screen.findByText(/neuspjelo pokretanje analize/i)).toBeInTheDocument();
  });

});
