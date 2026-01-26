/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import MessageList from '../MessageList';

describe('MessageList - Null Safety', () => {
    test('should render message when markdown parsing returns undefined', () => {
        const messages = [
            { text: 'Test message without markdown', isUser: false }
        ];
        
        render(
            <MessageList
                messages={messages}
                textSize={16}
                error={null}
                isLoading={false}
            />
        );

        expect(screen.getByText('Test message without markdown')).toBeInTheDocument();
    });

    test('should render message when blocks is empty array', () => {
        const messages = [
            { text: 'Test message', isUser: false }
        ];
        
        render(
            <MessageList
                messages={messages}
                textSize={16}
                error={null}
                isLoading={false}
            />
        );

        expect(screen.getByText('Test message')).toBeInTheDocument();
    });

    test('should handle undefined markdownData gracefully', () => {
        const messages = [
            { text: 'Simple text', isUser: false }
        ];
        
        expect(() => {
            render(
                <MessageList
                    messages={messages}
                    textSize={16}
                    error={null}
                    isLoading={false}
                />
            );
        }).not.toThrow();
    });
});