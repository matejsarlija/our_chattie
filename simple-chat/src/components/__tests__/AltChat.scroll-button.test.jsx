/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, act, screen } from '@testing-library/react';
import AltChat from '../AltChat';
import { ChatProvider } from '../../contexts/ChatContext';

jest.mock('../../hooks/useStreamingAPI', () => ({
  useStreamingAPI: () => ({
    isLoading: false,
    streamChat: jest.fn(),
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

jest.mock('../Chat', () => ({
  MessageList: () => <div data-testid="message-list">messages</div>,
  ChatInput: () => <div data-testid="chat-input">input</div>,
  ChatHeader: () => <div data-testid="chat-header">header</div>,
  ControlPanel: () => <div data-testid="control-panel">panel</div>,
  MobileControls: () => <div data-testid="mobile-controls">mobile</div>,
  ScrollToBottomButton: ({ onClick, visible }) => (
    <button
      onClick={onClick}
      aria-label="Idi na kraj razgovora"
      className={visible ? 'opacity-100' : 'opacity-0'}
    >
      Novi odgovor
    </button>
  ),
}));

const setScrollMetrics = (el, { scrollHeight, scrollTop, clientHeight }) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
};

describe('AltChat scroll-to-bottom button', () => {
  const dispatchScroll = (scrollContainer, scrollTop) => {
    Object.defineProperty(scrollContainer, 'scrollTop', {
      value: scrollTop,
      configurable: true,
      writable: true,
    });

    act(() => {
      scrollContainer.dispatchEvent(new Event('scroll'));
    });
  };

  test('renders as overlay outside the scrollable container and becomes visible when scrolled up', () => {
    const { container } = render(
      <ChatProvider>
        <AltChat />
      </ChatProvider>
    );

    const scrollContainer = container.querySelector('[data-scroll-container="chat"]');
    setScrollMetrics(scrollContainer, { scrollHeight: 2500, scrollTop: 100, clientHeight: 500 });

    dispatchScroll(scrollContainer, 100);

    const button = screen.getByRole('button', { name: /idi na kraj razgovora/i });

    expect(button.className).toContain('opacity-100');
    expect(scrollContainer).not.toContainElement(button);
  });

  test('stays anchored in overlay while scrolling and only hides near bottom', () => {
    const { container } = render(
      <ChatProvider>
        <AltChat />
      </ChatProvider>
    );

    const scrollContainer = container.querySelector('[data-scroll-container="chat"]');
    setScrollMetrics(scrollContainer, { scrollHeight: 3000, scrollTop: 0, clientHeight: 500 });

    const button = screen.getByRole('button', { name: /idi na kraj razgovora/i });
    const overlay = button.parentElement;

    expect(overlay.className).toContain('absolute');
    expect(scrollContainer).not.toContainElement(overlay);

    dispatchScroll(scrollContainer, 0);
    expect(button.className).toContain('opacity-100');
    expect(button.parentElement).toBe(overlay);

    dispatchScroll(scrollContainer, 800);
    expect(button.className).toContain('opacity-100');
    expect(button.parentElement).toBe(overlay);

    dispatchScroll(scrollContainer, 2381);
    expect(button.className).toContain('opacity-0');
    expect(button.parentElement).toBe(overlay);
  });
});
