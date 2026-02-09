/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { render, act, waitFor, screen } from '@testing-library/react';
import { ChatProvider, useChat } from '../ChatContext';

function Harness({ onReady }) {
  const chat = useChat();

  useEffect(() => {
    onReady(chat);
  }, [chat, onReady]);

  return (
    <div data-testid="messages">{JSON.stringify(chat.messages)}</div>
  );
}

describe('ChatContext streaming behavior', () => {
  beforeEach(() => {
    window.localStorage?.clear();
  });

  test('keeps raw streaming text without creating editors', async () => {
    let api;

    render(
      <ChatProvider>
        <Harness onReady={(ctx) => { api = ctx; }} />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(api).toBeDefined();
    });

    act(() => {
      api.clearMessages();
      api.addMessages([
        { text: 'hi', isUser: true, timestamp: 'u1' },
        { text: '', isUser: false, timestamp: 'a1' },
      ]);
    });

    const streamingText = 'Intro\n```markdown\nBlock\n```';

    act(() => {
      api.updateMessage('a1', { text: streamingText, isStreaming: true });
    });

    await waitFor(() => {
      const messages = JSON.parse(screen.getByTestId('messages').textContent);
      expect(messages).toHaveLength(2);
      expect(messages[1].text).toBe(streamingText);
      expect(messages[1].editors).toBeUndefined();
    });
  });

  test('parses markdown on finalize and creates editors', async () => {
    let api;

    render(
      <ChatProvider>
        <Harness onReady={(ctx) => { api = ctx; }} />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(api).toBeDefined();
    });

    act(() => {
      api.clearMessages();
      api.addMessages([
        { text: 'hi', isUser: true, timestamp: 'u1' },
        { text: '', isUser: false, timestamp: 'a1' },
      ]);
    });

    const markdownText = 'Intro\n```markdown\nBlock\n```';

    act(() => {
      api.updateMessage('a1', { text: markdownText, finalize: true });
    });

    await waitFor(() => {
      const messages = JSON.parse(screen.getByTestId('messages').textContent);
      expect(messages).toHaveLength(2);
      expect(messages[1].text).toBe('Intro');
      expect(messages[1].editors).toHaveLength(1);
      expect(messages[1].rawText).toBe(markdownText);
    });
  });
});
