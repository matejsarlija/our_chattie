/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import AltChat from '../AltChat';
import { ChatProvider } from '../../contexts/ChatContext';

const mockStreamChat = jest.fn(async (messages, file, callbacks) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  callbacks?.onContent?.('Intro\n```markdown\nBlock content\n```');
  return Promise.resolve();
});

jest.mock('../../hooks/useStreamingAPI', () => ({
  useStreamingAPI: () => ({
    isLoading: false,
    streamChat: mockStreamChat,
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

jest.mock('../Chat/TipTapEditor', () => ({
  __esModule: true,
  default: ({ initialContent }) => (
    <div data-testid="tiptap-editor">{initialContent}</div>
  ),
}));

describe('AltChat streaming finalize', () => {
  test('finalizes markdown into editor after stream completes', async () => {
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
      expect(screen.getByTestId('tiptap-editor')).toBeInTheDocument();
    });

    expect(screen.getByText('Intro')).toBeInTheDocument();
  });
});
