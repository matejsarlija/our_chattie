/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import MessageList from '../MessageList';

jest.mock('../../../contexts/ChatContext', () => ({
  useChat: jest.fn(),
}));

const { useChat } = require('../../../contexts/ChatContext');

const baseChatState = {
  error: '',
  isLoading: false,
  textSize: 16,
};

const makeMessages = (count) =>
  Array.from({ length: count }, (_, i) => ({
    text: `msg-${i}`,
    isUser: i % 2 === 0,
    timestamp: `t-${i}`,
  }));

const setScrollMetrics = (el, { scrollHeight, scrollTop, clientHeight }) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
};

describe('MessageList scroll behavior', () => {
  let scrollSpy;

  beforeEach(() => {
    scrollSpy = jest.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  });

  afterEach(() => {
    scrollSpy.mockRestore();
  });

  test('auto-scrolls when user is near bottom', () => {
    useChat.mockReturnValue({
      ...baseChatState,
      messages: makeMessages(1),
    });

    const { rerender, container } = render(
      <div data-scroll-container="chat">
        <MessageList />
      </div>
    );

    const scrollContainer = container.querySelector('[data-scroll-container="chat"]');
    setScrollMetrics(scrollContainer, { scrollHeight: 1000, scrollTop: 900, clientHeight: 200 });

    scrollContainer.dispatchEvent(new Event('scroll'));

    useChat.mockReturnValue({
      ...baseChatState,
      messages: makeMessages(2),
    });

    rerender(
      <div data-scroll-container="chat">
        <MessageList />
      </div>
    );

    expect(scrollSpy).toHaveBeenCalled();
  });

  test('does not auto-scroll when user is far from bottom', () => {
    useChat.mockReturnValue({
      ...baseChatState,
      messages: makeMessages(1),
    });

    const { rerender, container } = render(
      <div data-scroll-container="chat">
        <MessageList />
      </div>
    );

    const scrollContainer = container.querySelector('[data-scroll-container="chat"]');
    setScrollMetrics(scrollContainer, { scrollHeight: 2000, scrollTop: 200, clientHeight: 200 });

    act(() => {
        scrollContainer.dispatchEvent(new Event('scroll'));
    });
    scrollSpy.mockClear();

    useChat.mockReturnValue({
      ...baseChatState,
      messages: makeMessages(2),
    });

    rerender(
      <div data-scroll-container="chat">
        <MessageList />
      </div>
    );

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
