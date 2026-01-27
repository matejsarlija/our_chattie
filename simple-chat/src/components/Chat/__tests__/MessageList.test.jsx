import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessageList from '../MessageList';
import { useChat } from '../../../contexts/ChatContext';

// Mock the context hook
jest.mock('../../../contexts/ChatContext', () => ({
  useChat: jest.fn(),
}));

// Mock child components
jest.mock('../MessageBubble', () => {
  return function MockMessageBubble({ msg }) {
    return <div data-testid="message-bubble">{msg.text}</div>;
  };
});

jest.mock('../TypingBubble', () => {
  return function MockTypingBubble() {
    return <div data-testid="typing-bubble">Typing...</div>;
  };
});

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

describe('MessageList', () => {
  const mockMessages = [
    { isUser: true, text: 'User message', timestamp: '1' },
    { isUser: false, text: 'AI response', timestamp: '2' },
  ];

  beforeEach(() => {
    useChat.mockReturnValue({
      messages: [],
      error: '',
      isLoading: false,
      textSize: 16,
    });
  });

  it('renders empty state when no messages', () => {
    render(<MessageList />);
    
    expect(screen.getByText('Dobrodošli na Alimentacija.info')).toBeInTheDocument();
  });

  it('renders messages using MessageBubble', () => {
    useChat.mockReturnValue({
      messages: mockMessages,
      error: '',
      isLoading: false,
      textSize: 16,
    });

    render(<MessageList />);

    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toHaveTextContent('User message');
    expect(bubbles[1]).toHaveTextContent('AI response');
  });

  it('displays TypingBubble when isLoading is true', () => {
    useChat.mockReturnValue({
      messages: mockMessages,
      error: '',
      isLoading: true,
      textSize: 16,
    });

    render(<MessageList />);

    expect(screen.getByTestId('typing-bubble')).toBeInTheDocument();
    expect(screen.queryByText('AI odgovara...')).not.toBeInTheDocument(); // Old indicator should be gone
  });

  it('displays error message when provided', () => {
    useChat.mockReturnValue({
      messages: [],
      error: 'Something went wrong',
      isLoading: false,
      textSize: 16,
    });

    render(<MessageList />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
