/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import AltChat from '../AltChat';
import { ChatProvider } from '../../contexts/ChatContext';

jest.mock('../../hooks/useStreamingAPI', () => ({
  useStreamingAPI: () => ({
    isLoading: false,
    streamChat: jest.fn(async (messages, file, callbacks) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      callbacks?.onContent?.('Hello');
      callbacks?.onContent?.('Hello world');
      return Promise.resolve();
    }),
    streamCourtAnalysis: jest.fn(),
    streamDocumentEdit: jest.fn(),
    stopGeneration: jest.fn(),
  }),
}));

jest.mock('../../hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    selectedFile: null,
    handleFileSelect: jest.fn(),
    clearUploadState: jest.fn(),
    removeFile: jest.fn(),
    triggerFileInput: jest.fn(),
    fileInputRef: { current: null },
  }),
}));

jest.mock('../../hooks/useFirstVisit', () => ({
  useFirstVisit: () => ({
    isFirstVisit: false,
    loading: false,
  }),
}));

describe('AltChat streaming UI', () => {
  test('shows streaming content in the assistant bubble', async () => {
    render(
      <ChatProvider>
        <AltChat />
      </ChatProvider>
    );

    const textarea = screen.getByLabelText('Polje za unos pravnog pitanja');
    fireEvent.change(textarea, { target: { value: 'Test message' } });

    const sendButton = screen.getByLabelText('Pošalji');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
  });
});
