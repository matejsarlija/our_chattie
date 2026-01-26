import { renderHook, act } from '@testing-library/react';
import { useWorkspaceState } from '../useWorkspaceState';

// Mock localStorage for basic testing
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: jest.fn((key) => store[key] || null),
        setItem: jest.fn((key, value) => {
            store[key] = value.toString();
        }),
        removeItem: jest.fn((key) => {
            delete store[key];
        }),
        clear: jest.fn(() => {
            store = {};
        }),
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

describe('useWorkspaceState Integration', () => {
    test('should initialize without errors', () => {
        const { result } = renderHook(() => useWorkspaceState());
        
        expect(result.current.messages).toBeDefined();
        expect(result.current.textSize).toBe(16);
        expect(result.current.error).toBe('');
    });

    test('should add messages correctly', () => {
        const { result } = renderHook(() => useWorkspaceState());
        
        act(() => {
            result.current.addMessage({ text: 'Hello', isUser: true });
        });

        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0]).toMatchObject({
            text: 'Hello',
            isUser: true
        });
    });

    test('should update editor content correctly', () => {
        const { result } = renderHook(() => useWorkspaceState());
        
        // First add a message with editor
        act(() => {
            result.current.addMessage({ 
                text: '```markdown\nTest content\n```', 
                isUser: false 
            });
        });

        // Then update editor content
        act(() => {
            result.current.updateEditorContent('msg-1', 'editor-0-0', 'Updated content');
        });

        expect(result.current.messages[0].editors[0].content).toBe('Updated content');
    });

    test('should manage text size correctly', () => {
        const { result } = renderHook(() => useWorkspaceState());
        
        act(() => {
            result.current.setTextSize(18);
        });

        expect(result.current.textSize).toBe(18);
    });

    test('should handle errors correctly', () => {
        const { result } = renderHook(() => useWorkspaceState());
        
        act(() => {
            result.current.setError('Test error');
        });

        expect(result.current.error).toBe('Test error');

        act(() => {
            result.current.clearError();
        });

        expect(result.current.error).toBe('');
    });
});