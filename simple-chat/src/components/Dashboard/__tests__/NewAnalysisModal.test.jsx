/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewAnalysisModal from '../NewAnalysisModal';
import { useStreamingAPI } from '../../../hooks/useStreamingAPI';
import { useAuth } from '../../../contexts/AuthContext';

const mockNavigate = jest.fn();
const mockOpenAuthModal = jest.fn();
const mockStreamCourtAnalysis = jest.fn();

jest.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

jest.mock('../../../hooks/useStreamingAPI', () => ({
  useStreamingAPI: jest.fn(),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

describe('NewAnalysisModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.mockReturnValue({
      accessToken: 'token-1',
      openAuthModal: mockOpenAuthModal,
    });
    useStreamingAPI.mockReturnValue({
      isLoading: false,
      streamCourtAnalysis: mockStreamCourtAnalysis,
    });
  });

  test('blocks invalid OIB before submit', async () => {
    render(<NewAnalysisModal isOpen onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/12345678901/i), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /pokreni/i }));

    expect(await screen.findByText(/točno 11 znamenki/i)).toBeInTheDocument();
    expect(mockStreamCourtAnalysis).not.toHaveBeenCalled();
  });

  test('navigates to detail when analysisId arrives', async () => {
    const onClose = jest.fn();
    mockStreamCourtAnalysis.mockImplementation(async (_searchTerm, callbacks) => {
      callbacks.onMessage({ analysisId: 'run-123' });
    });

    render(<NewAnalysisModal isOpen onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText(/12345678901/i), { target: { value: '12345678901' } });
    fireEvent.click(screen.getByRole('button', { name: /pokreni/i }));

    await waitFor(() => {
      expect(mockStreamCourtAnalysis).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard/runs/run-123');
    });
  });

  test('opens auth modal when backend returns AUTH_REQUIRED', async () => {
    mockStreamCourtAnalysis.mockImplementation(async (_searchTerm, callbacks) => {
      callbacks.onError('Please sign in to continue.', { code: 'AUTH_REQUIRED' });
    });

    render(<NewAnalysisModal isOpen onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/12345678901/i), { target: { value: '12345678901' } });
    fireEvent.click(screen.getByRole('button', { name: /pokreni/i }));

    await waitFor(() => {
      expect(mockOpenAuthModal).toHaveBeenCalled();
    });

    expect(await screen.findByText(/please sign in to continue/i)).toBeInTheDocument();
  });
});
