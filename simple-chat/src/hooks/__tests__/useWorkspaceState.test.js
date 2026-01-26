/**
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { useWorkspaceState } from '../useWorkspaceState';

// Mock localStorage
const localStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn()
};
Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
});

// Mock the utility functions
jest.mock('../utils/markdownParser', () => ({
    parseMarkdownBlocks: jest.fn((text, index) => {
        if (text.includes('```markdown')) {
            return [{
                id: `editor-${index}-0`,
                markdown: 'Test markdown content',
                originalMarkdown: 'Test markdown content'
            }];
        }
        return [];
    }),
    extractAndCleanMarkdown: jest.fn().mockReturnValue({
        cleanedText: 'Here is your draft:\n\nHope this helps!',
        blocks: [{
            id: 'editor-0-0',
            markdown: 'Test markdown content',
            originalMarkdown: 'Test markdown content'
        }],
        hasBlocks: true
    })
}));

jest.mock('../utils/markdownToHTML', () => ({
    convertMarkdownWithCitations: jest.fn().mockReturnValue('<p>Test markdown content</p>')
}));

describe('useWorkspaceState', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorageMock.getItem.mockReturnValue(null);
    });

    describe('initialization', () => {
        test('should initialize with default values', () => {
            localStorageMock.getItem.mockImplementation((key) => {
                switch (key) {
                    case 'chatMessages': return '[]';
                    case 'textSize': return '16';
                    default: return null;
                }
            });

            const { result } = renderHook(() => useWorkspaceState());

            expect(result.current.messages).toEqual([]);
            expect(result.current.textSize).toBe(16);
            expect(result.current.error).toBe('');
        });

        test('should load from localStorage if available', () => {
            const mockMessages = [
                { text: 'Test message', isUser: true, timestamp: '2023-01-01T00:00:00Z' }
            ];

            localStorageMock.getItem.mockImplementation((key) => {
                switch (key) {
                    case 'chatMessages': return JSON.stringify(mockMessages);
                    case 'textSize': return '18';
                    default: return null;
                }
            });

            const { result } = renderHook(() => useWorkspaceState());

            expect(result.current.messages).toEqual(mockMessages);
            expect(result.current.textSize).toBe(18); // Should be clamped to 18
        });

        test('should clamp text size to valid range', () => {
            localStorageMock.getItem.mockImplementation((key) => {
                switch (key) {
                    case 'chatMessages': return '[]';
                    case 'textSize': return '20'; // Above max
                    default: return null;
                }
            });

            const { result } = renderHook(() => useWorkspaceState());

            expect(result.current.textSize).toBe(18); // Should be clamped to max
        });
    });

    describe('message management', () => {
        test('should add new message', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            const newMessage = { text: 'Test message', isUser: true };
            
            act(() => {
                result.current.addMessage(newMessage);
            });

            expect(result.current.messages).toHaveLength(1);
            expect(result.current.messages[0]).toMatchObject({
                text: 'Test message',
                isUser: true
            });
            expect(result.current.messages[0].timestamp).toBeDefined();
        });

        test('should add AI message with markdown blocks', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            const aiMessage = {
                text: 'Here is your draft:\n```markdown\nTest markdown content\n```\nHope this helps!',
                isUser: false
            };

            act(() => {
                result.current.addMessage(aiMessage);
            });

            expect(result.current.messages).toHaveLength(1);
            expect(result.current.messages[0].editors).toBeDefined();
            expect(result.current.messages[0].editors).toHaveLength(1);
            expect(result.current.messages[0].editors[0]).toMatchObject({
                id: 'editor-0-0',
                content: '<p>Test markdown content</p>',
                originalMarkdown: 'Test markdown content'
            });
        });

        test('should update existing message', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            // Add initial message
            act(() => {
                result.current.addMessage({ text: 'Original', isUser: true });
            });

            // Update message
            act(() => {
                result.current.updateMessage(0, { text: 'Updated' });
            });

            expect(result.current.messages[0].text).toBe('Updated');
        });

        test('should update AI message with markdown blocks', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            // Add initial AI message
            act(() => {
                result.current.addMessage({ text: 'Original', isUser: false });
            });

            // Update with markdown content
            act(() => {
                result.current.updateMessage(0, { text: 'Updated:\n```markdown\nNew content\n```' });
            });

            expect(result.current.messages[0].editors).toBeDefined();
            expect(result.current.messages[0].editors).toHaveLength(1);
        });

        test('should remove last message', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            // Add two messages
            act(() => {
                result.current.addMessage({ text: 'Message 1', isUser: true });
                result.current.addMessage({ text: 'Message 2', isUser: true });
            });

            expect(result.current.messages).toHaveLength(2);

            // Remove last message
            act(() => {
                result.current.removeLastMessage();
            });

            expect(result.current.messages).toHaveLength(1);
            expect(result.current.messages[0].text).toBe('Message 1');
        });

        test('should clear all messages', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            // Add messages
            act(() => {
                result.current.addMessage({ text: 'Message 1', isUser: true });
                result.current.addMessage({ text: 'Message 2', isUser: true });
            });

            expect(result.current.messages).toHaveLength(2);

            // Clear messages
            act(() => {
                result.current.clearMessages();
            });

            expect(result.current.messages).toHaveLength(0);
        });
    });

    describe('editor management', () => {
        test('should update editor content', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            // Add message with editor
            const aiMessage = {
                text: 'Here is your draft:\n```markdown\nTest markdown content\n```\nHope this helps!',
                isUser: false
            };

            act(() => {
                result.current.addMessage(aiMessage);
            });

            const messageId = result.current.messages[0].timestamp;
            const editorId = 'editor-0-0';
            const newContent = '<p>Updated content</p>';

            // Update editor content
            act(() => {
                result.current.updateEditorContent(messageId, editorId, newContent);
            });

            // Due to debouncing, we need to wait for the timeout
            jest.advanceTimersByTime(500);

            expect(result.current.messages[0].editors[0].content).toBe(newContent);
        });

        test('should add new editor to message', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            // Add message without editors
            act(() => {
                result.current.addMessage({ text: 'Simple message', isUser: false });
            });

            const messageId = result.current.messages[0].timestamp;
            const editorId = 'new-editor';
            const content = '<p>New editor content</p>';

            // Add new editor
            act(() => {
                result.current.updateEditorContent(messageId, editorId, content);
            });

            jest.advanceTimersByTime(500);

            expect(result.current.messages[0].editors).toBeDefined();
            expect(result.current.messages[0].editors).toHaveLength(1);
        });

        test('should get message editors', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            const aiMessage = {
                text: '```markdown\nContent\n```',
                isUser: false
            };

            act(() => {
                result.current.addMessage(aiMessage);
            });

            const messageId = result.current.messages[0].timestamp;
            const editors = result.current.getMessageEditors(messageId);

            expect(editors).toBeDefined();
            expect(editors).toHaveLength(1);
            expect(editors[0].id).toBe('editor-0-0');
        });

        test('should get specific editor content', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            const aiMessage = {
                text: '```markdown\nContent\n```',
                isUser: false
            };

            act(() => {
                result.current.addMessage(aiMessage);
            });

            const messageId = result.current.messages[0].timestamp;
            const editorId = 'editor-0-0';
            const content = result.current.getEditorContent(messageId, editorId);

            expect(content).toBe('<p>Test markdown content</p>');
        });

        test('should remove editor from message', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            const aiMessage = {
                text: '```markdown\nContent\n```',
                isUser: false
            };

            act(() => {
                result.current.addMessage(aiMessage);
            });

            const messageId = result.current.messages[0].timestamp;
            const editorId = 'editor-0-0';

            // Remove editor
            act(() => {
                result.current.removeEditor(messageId, editorId);
            });

            expect(result.current.messages[0].editors).toBeUndefined();
        });

        test('should handle debouncing for editor updates', () => {
            jest.useFakeTimers();
            const { result } = renderHook(() => useWorkspaceState());
            
            const aiMessage = {
                text: '```markdown\nContent\n```',
                isUser: false
            };

            act(() => {
                result.current.addMessage(aiMessage);
            });

            const messageId = result.current.messages[0].timestamp;
            const editorId = 'editor-0-0';

            // Multiple rapid updates
            act(() => {
                result.current.updateEditorContent(messageId, editorId, 'Content 1');
                result.current.updateEditorContent(messageId, editorId, 'Content 2');
                result.current.updateEditorContent(messageId, editorId, 'Content 3');
            });

            // Should not update immediately
            expect(result.current.messages[0].editors[0].content).toBe('<p>Test markdown content</p>');

            // Advance timer
            act(() => {
                jest.advanceTimersByTime(500);
            });

            expect(result.current.messages[0].editors[0].content).toBe('Content 3');
            
            jest.useRealTimers();
        });
    });

    describe('error management', () => {
        test('should set and clear error', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            // Set error
            act(() => {
                result.current.setError('Test error');
            });

            expect(result.current.error).toBe('Test error');

            // Clear error
            act(() => {
                result.current.clearError();
            });

            expect(result.current.error).toBe('');
        });
    });

    describe('text size management', () => {
        test('should update text size', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            act(() => {
                result.current.setTextSize(18);
            });

            expect(result.current.textSize).toBe(18);
            expect(localStorageMock.setItem).toHaveBeenCalledWith('textSize', '18');
        });
    });

    describe('localStorage persistence', () => {
        test('should save messages to localStorage on update', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            act(() => {
                result.current.addMessage({ text: 'Test message', isUser: true });
            });

            expect(localStorageMock.setItem).toHaveBeenCalledWith(
                'chatMessages',
                expect.any(String)
            );
        });

        test('should limit messages to 50 in localStorage', () => {
            const { result } = renderHook(() => useWorkspaceState());
            
            // Add 55 messages
            for (let i = 0; i < 55; i++) {
                act(() => {
                    result.current.addMessage({ text: `Message ${i}`, isUser: true });
                });
            }

            const savedCall = localStorageMock.setItem.mock.calls.find(
                call => call[0] === 'chatMessages'
            );
            const savedMessages = JSON.parse(savedCall[1]);

            expect(savedMessages).toHaveLength(50);
            expect(savedMessages[49].text).toBe('Message 54'); // Last message
        });
    });

    describe('cleanup and migration', () => {
        test('should cleanup old canvas data on mount', () => {
            renderHook(() => useWorkspaceState());

            expect(localStorageMock.removeItem).toHaveBeenCalledWith('canvasDocument');
            expect(localStorageMock.removeItem).toHaveBeenCalledWith('canvasMode');
        });

        test('should run migration on mount', () => {
            localStorageMock.getItem.mockImplementation((key) => {
                switch (key) {
                    case 'chatMessages': return '[{"text":"test","isUser":true}]';
                    case 'textSize': return '15';
                    default: return null;
                }
            });

            renderHook(() => useWorkspaceState());

            // Should save migrated data
            expect(localStorageMock.setItem).toHaveBeenCalledWith(
                'chatMessages',
                expect.stringContaining('timestamp')
            );
            expect(localStorageMock.setItem).toHaveBeenCalledWith(
                'textSize',
                '16' // Clamped to minimum
            );
        });
    });
});