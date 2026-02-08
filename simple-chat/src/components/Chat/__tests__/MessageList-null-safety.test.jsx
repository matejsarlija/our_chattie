/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import MessageList from '../MessageList';

jest.mock('../../../contexts/ChatContext', () => ({
    useChat: jest.fn(),
}));

const { useChat } = require('../../../contexts/ChatContext');

describe('MessageList - Null Safety', () => {
    test('should render message when markdown parsing returns undefined', () => {
        const messages = [
            { text: 'Test message without markdown', isUser: false }
        ];

        useChat.mockReturnValue({
            messages,
            textSize: 16,
            error: null,
            isLoading: false,
        });

        render(<MessageList />);

        expect(screen.getByText('Test message without markdown')).toBeInTheDocument();
    });

    test('should render message when blocks is empty array', () => {
        const messages = [
            { text: 'Test message', isUser: false }
        ];

        useChat.mockReturnValue({
            messages,
            textSize: 16,
            error: null,
            isLoading: false,
        });

        render(<MessageList />);

        expect(screen.getByText('Test message')).toBeInTheDocument();
    });

    test('should handle undefined markdownData gracefully', () => {
        const messages = [
            { text: 'Simple text', isUser: false }
        ];

        useChat.mockReturnValue({
            messages,
            textSize: 16,
            error: null,
            isLoading: false,
        });

        expect(() => {
            render(<MessageList />);
        }).not.toThrow();
    });
});
