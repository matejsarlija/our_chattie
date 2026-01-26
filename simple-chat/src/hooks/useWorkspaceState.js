import { useState, useEffect, useCallback, useRef } from 'react';
import { parseMarkdownBlocks, extractAndCleanMarkdown } from './utils/markdownParser';
import { convertMarkdownWithCitations } from './utils/markdownToHTML';

export const useWorkspaceState = () => {
    // Chat messages state with localStorage persistence
    const [messages, setMessages] = useState(() => {
        try {
            const saved = localStorage.getItem('chatMessages');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Failed to load messages from localStorage', error);
            return [];
        }
    });

    // Text size preference state
    const [textSize, setTextSize] = useState(() => {
        try {
            const savedSize = localStorage.getItem('textSize') ? parseInt(localStorage.getItem('textSize')) : 16;
            // Enforce the 16-18 range even for saved values
            return Math.min(Math.max(savedSize, 16), 18);
        } catch {
            return 16;
        }
    });

    // Error state management
    const [error, setError] = useState('');

    // Auto-save debounce timer ref
    const autoSaveTimerRef = useRef(null);

    // Cleanup old canvas-related localStorage entries
    const cleanupOldCanvasData = useCallback(() => {
        try {
            localStorage.removeItem('canvasDocument');
            localStorage.removeItem('canvasMode');
        } catch (error) {
            console.warn('Failed to cleanup old canvas data:', error);
        }
    }, []);

    // Save messages to localStorage with 50-message limit and editor processing
    useEffect(() => {
        try {
            // Process messages to ensure editor consistency
            const processedMessages = messages.map((msg, index) => {
                if (msg.isUser || !msg.text) {
                    return msg;
                }

                 // Check for markdown blocks and ensure editor state
                 try {
                     const { blocks } = extractAndCleanMarkdown(msg.text, index);

                     if (blocks.length > 0 && !msg.editors) {
                         // Initialize editors for existing messages with markdown blocks
                         const editors = blocks.map(block => ({
                             id: block.id,
                             content: convertMarkdownWithCitations(block.markdown),
                             originalMarkdown: block.originalMarkdown,
                             lastModified: new Date().toISOString()
                         }));

                         return { ...msg, editors };
                     } else if (blocks.length === 0 && msg.editors) {
                         // Remove editors if no markdown blocks
                         const { editors, ...cleanMsg } = msg;
                         return cleanMsg;
                     }

                     return msg;
                 } catch (error) {
                     console.error('Error processing message editors:', error);
                     return msg; // Return original message if processing fails
                 }
            });

            // Limit storage to last 50 messages to prevent quota issues
            const messagesToStore = processedMessages.slice(-50);
            localStorage.setItem('chatMessages', JSON.stringify(messagesToStore));
        } catch (error) {
            console.error('Failed to save messages to localStorage', error);
            setError('Failed to save conversation history. Storage may be full.');
        }
    }, [messages]);

    // Save text size preference
    useEffect(() => {
        try {
            localStorage.setItem('textSize', textSize.toString());
        } catch (error) {
            console.error('Failed to save text size preference', error);
        }
    }, [textSize]);

    // Auto-save editor content with debouncing
    const saveEditorContent = useCallback((messageId, editorId, content) => {
        // Clear existing timer
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
        }

        // Set new timer for auto-save (500ms debounce)
        autoSaveTimerRef.current = setTimeout(() => {
            setMessages(prev => {
                const newMessages = [...prev];
                const messageIndex = newMessages.findIndex(msg => msg.timestamp === messageId);

                if (messageIndex !== -1) {
                    const message = newMessages[messageIndex];

                    if (!message.editors) {
                        message.editors = [];
                    }

                    const editorIndex = message.editors.findIndex(editor => editor.id === editorId);

                    if (editorIndex !== -1) {
                        // Update existing editor
                        message.editors[editorIndex] = {
                            ...message.editors[editorIndex],
                            content,
                            lastModified: new Date().toISOString()
                        };
                    } else {
                        // Add new editor
                        message.editors.push({
                            id: editorId,
                            content,
                            originalMarkdown: content, // Will be updated by parsing
                            lastModified: new Date().toISOString()
                        });
                    }
                }

                return newMessages;
            });
        }, 500);
    }, []);

    // Add multiple messages atomically
    const addMessages = useCallback((newMsgs) => {
        const processed = newMsgs.map((msg, offset) => ({
            ...msg,
            timestamp: msg.timestamp || new Date(Date.now() + offset).toISOString()
        }));
        setMessages(prev => [...prev, ...processed]);
    }, []);

    // Add a new message to chat
    const addMessage = useCallback((message) => {
        addMessages([message]);
    }, [addMessages]);

    // Remove last message (useful for failed API calls)
    const removeLastMessage = useCallback(() => {
        setMessages(prev => prev.slice(0, -1));
    }, []);

    // Remove specific message by ID
    const removeMessage = useCallback((id) => {
        setMessages(prev => prev.filter(msg => msg.timestamp !== id));
    }, []);

    // Clear all messages
    const clearMessages = useCallback(() => {
        setMessages([]);
        try {
            localStorage.removeItem('chatMessages');
        } catch (error) {
            console.error('Failed to clear messages from localStorage', error);
        }
    }, []);

    // Update existing message (for streaming responses)
    // Uses timestamp (id) instead of index to avoid stale closure issues
    const updateMessage = useCallback((id, updates) => {
        setMessages(prev => {
            const newMessages = [...prev];
            // Support both index (old) and timestamp (new)
            const index = typeof id === 'number'
                ? id
                : newMessages.findIndex(msg => msg.timestamp === id);

            const message = newMessages[index];

            if (!message) {
                console.warn(`Update failed: Message not found for ${id}`);
                return prev;
            }

            // Update message content
            newMessages[index] = { ...message, ...updates };

             // If text updated and it's an AI message, reprocess markdown blocks
             // Store the "raw" streaming text so we don't lose markdown data during cleaning
             if (updates.text && !message.isUser) {
                 try {
                     newMessages[index].rawText = updates.text; // Keep the original markdown

                     const { blocks, cleanedText } = extractAndCleanMarkdown(
                         updates.text,
                         index
                     );

                     if (blocks.length > 0) {
                         const editors = blocks.map(block => ({
                             id: block.id,
                             content: convertMarkdownWithCitations(block.markdown),
                             originalMarkdown: block.originalMarkdown,
                             lastModified: new Date().toISOString()
                         }));

                         newMessages[index].editors = editors;
                         newMessages[index].text = cleanedText;
                     } else {
                         // Remove editors if no markdown blocks
                         delete newMessages[index].editors;
                         newMessages[index].text = cleanedText;
                     }
                 } catch (error) {
                     console.error('Error updating message markdown blocks:', error);
                     // If markdown processing fails, just update the text directly
                     newMessages[index].text = updates.text;
                 }
             }

            return newMessages;
        });
    }, []);

    // Update editor content for a specific message
    const updateEditorContent = useCallback((messageId, editorId, content) => {
        saveEditorContent(messageId, editorId, content);
    }, [saveEditorContent]);

    // Remove editor from a message
    const removeEditor = useCallback((messageId, editorId) => {
        setMessages(prev => {
            const newMessages = [...prev];
            const messageIndex = newMessages.findIndex(msg => msg.timestamp === messageId);

            if (messageIndex !== -1) {
                const message = newMessages[messageIndex];
                if (message.editors) {
                    message.editors = message.editors.filter(editor => editor.id !== editorId);

                    // If no editors left, remove the editors property
                    if (message.editors.length === 0) {
                        delete message.editors;
                    }
                }
            }

            return newMessages;
        });
    }, []);

    // Get all editors for a message
    const getMessageEditors = useCallback((messageId) => {
        const message = messages.find(msg => msg.timestamp === messageId);
        return message?.editors || [];
    }, [messages]);

    // Get specific editor content
    const getEditorContent = useCallback((messageId, editorId) => {
        const message = messages.find(msg => msg.timestamp === messageId);
        if (!message?.editors) {
            return null;
        }

        const editor = message.editors.find(ed => ed.id === editorId);
        return editor?.content || null;
    }, [messages]);

    // Clear error state
    const clearError = useCallback(() => {
        setError('');
    }, []);

    // Migration utilities
    const migrateLocalStorage = useCallback(() => {
        try {
            // Check for old data formats and migrate
            const oldMessages = localStorage.getItem('chatMessages');
            const oldTextSize = localStorage.getItem('textSize');

            // Clean up old canvas data
            cleanupOldCanvasData();

            // Ensure message format is current
            if (oldMessages) {
                const parsed = JSON.parse(oldMessages);
                const migrated = parsed.map(msg => ({
                    ...msg,
                    timestamp: msg.timestamp || new Date().toISOString(),
                    isUser: msg.isUser !== undefined ? msg.isUser : false
                }));
                localStorage.setItem('chatMessages', JSON.stringify(migrated));
            }

            // Ensure text size is in valid range
            if (oldTextSize) {
                const size = parseInt(oldTextSize);
                const validSize = Math.min(Math.max(size, 16), 18);
                localStorage.setItem('textSize', validSize.toString());
            }
        } catch (error) {
            console.error('Migration failed:', error);
        }
    }, [cleanupOldCanvasData]);

    // Run migration on mount
    useEffect(() => {
        migrateLocalStorage();
    }, [migrateLocalStorage]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
        };
    }, []);

    return {
        // Chat state
        messages,
        addMessage,
        addMessages,
        removeLastMessage,
        removeMessage,
        clearMessages,
        updateMessage,

        // Editor state management
        updateEditorContent,
        removeEditor,
        getMessageEditors,
        getEditorContent,

        // Settings state
        textSize,
        setTextSize,

        // Error state
        error,
        setError,
        clearError,

        // Utilities
        migrateLocalStorage,
        cleanupOldCanvasData
    };
};