import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { extractAndCleanMarkdown } from '../hooks/utils/markdownParser';
import { convertMarkdownWithCitations } from '../hooks/utils/markdownToHTML';

const ChatContext = createContext();

const initialState = {
    messages: (() => {
        try {
            const saved = localStorage.getItem('chatMessages');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Failed to load messages from localStorage', error);
            return [];
        }
    })(),
    textSize: (() => {
        try {
            const savedSize = localStorage.getItem('textSize') ? parseInt(localStorage.getItem('textSize')) : 16;
            return Math.min(Math.max(savedSize, 16), 18);
        } catch {
            return 16;
        }
    })(),
    error: '',
    isLoading: false
};

function chatReducer(state, action) {
    switch (action.type) {
        case 'SET_LOADING':
            return { ...state, isLoading: action.payload };
        
        case 'SET_ERROR':
            return { ...state, error: action.payload };
        
        case 'CLEAR_ERROR':
            return { ...state, error: '' };
        
        case 'SET_TEXT_SIZE':
            return { ...state, textSize: action.payload };

        case 'ADD_MESSAGES': {
            const processed = action.payload.map((msg, offset) => ({
                ...msg,
                timestamp: msg.timestamp || new Date(Date.now() + offset).toISOString()
            }));
            return { ...state, messages: [...state.messages, ...processed] };
        }

        case 'UPDATE_MESSAGE': {
            const { id, updates } = action.payload;
            const newMessages = [...state.messages];
            const index = typeof id === 'number'
                ? id
                : newMessages.findIndex(msg => msg.timestamp === id);

            if (index === -1) return state;

            const message = { ...newMessages[index], ...updates };

            // Logic from useWorkspaceState for AI message processing
            if (updates.text && !message.isUser) {
                try {
                    message.rawText = updates.text;
                    const { blocks, cleanedText } = extractAndCleanMarkdown(updates.text, index);

                    if (blocks.length > 0) {
                        message.editors = blocks.map(block => ({
                            id: block.id,
                            content: convertMarkdownWithCitations(block.markdown),
                            originalMarkdown: block.originalMarkdown,
                            lastModified: new Date().toISOString()
                        }));
                        message.text = cleanedText;
                    } else {
                        delete message.editors;
                        message.text = cleanedText;
                    }
                } catch (error) {
                    console.error('Error updating message markdown blocks:', error);
                    message.text = updates.text;
                }
            }

            newMessages[index] = message;
            return { ...state, messages: newMessages };
        }

        case 'UPDATE_EDITOR_CONTENT': {
            const { messageId, editorId, content } = action.payload;
            const newMessages = [...state.messages];
            const index = newMessages.findIndex(msg => msg.timestamp === messageId);

            if (index === -1) return state;

            const message = { ...newMessages[index] };
            if (!message.editors) message.editors = [];

            const editorIndex = message.editors.findIndex(ed => ed.id === editorId);
            const now = new Date().toISOString();

            if (editorIndex !== -1) {
                const newEditors = [...message.editors];
                newEditors[editorIndex] = { ...newEditors[editorIndex], content, lastModified: now };
                message.editors = newEditors;
            } else {
                message.editors = [...message.editors, { id: editorId, content, originalMarkdown: content, lastModified: now }];
            }

            newMessages[index] = message;
            return { ...state, messages: newMessages };
        }

        case 'REMOVE_MESSAGE':
            return { ...state, messages: state.messages.filter(msg => msg.timestamp !== action.payload) };

        case 'CLEAR_MESSAGES':
            return { ...state, messages: [] };

        default:
            return state;
    }
}

export function ChatProvider({ children }) {
    const [state, dispatch] = useReducer(chatReducer, initialState);
    const autoSaveTimerRef = useRef(null);

    // Persistence Effect
    useEffect(() => {
        try {
            const messagesToStore = state.messages.slice(-50);
            localStorage.setItem('chatMessages', JSON.stringify(messagesToStore));
        } catch (error) {
            console.error('Failed to save messages:', error);
        }
    }, [state.messages]);

    useEffect(() => {
        localStorage.setItem('textSize', state.textSize.toString());
    }, [state.textSize]);

    // Dispatcher wrappers for convenience (Vercel style)
    const addMessages = useCallback((messages) => dispatch({ type: 'ADD_MESSAGES', payload: messages }), []);
    const updateMessage = useCallback((id, updates) => dispatch({ type: 'UPDATE_MESSAGE', payload: { id, updates } }), []);
    const updateEditorContent = useCallback((messageId, editorId, content) => {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => {
            dispatch({ type: 'UPDATE_EDITOR_CONTENT', payload: { messageId, editorId, content } });
        }, 500);
    }, []);
    const removeMessage = useCallback((id) => dispatch({ type: 'REMOVE_MESSAGE', payload: id }), []);
    const clearMessages = useCallback(() => dispatch({ type: 'CLEAR_MESSAGES' }), []);
    const setTextSize = useCallback((size) => dispatch({ type: 'SET_TEXT_SIZE', payload: size }), []);
    const setError = useCallback((error) => dispatch({ type: 'SET_ERROR', payload: error }), []);
    const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);
    const setLoading = useCallback((loading) => dispatch({ type: 'SET_LOADING', payload: loading }), []);

    const value = {
        ...state,
        addMessages,
        updateMessage,
        updateEditorContent,
        removeMessage,
        clearMessages,
        setTextSize,
        setError,
        clearError,
        setLoading
    };

    return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
}
