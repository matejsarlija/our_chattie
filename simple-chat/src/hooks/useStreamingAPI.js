import { useState, useRef, useCallback } from 'react';

export const useStreamingAPI = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const controllerRef = useRef(null);

    // Generic streaming handler for both chat and document editing
    const streamResponse = async ({
        url,
        payload,
        onProgress,
        onContent,
        onComplete,
        onError,
        onMessage
    }) => {
        setIsLoading(true);
        setProgress(0);
        controllerRef.current = new AbortController();

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: payload instanceof FormData
                    ? {} // Let browser set Content-Type for FormData
                    : { 'Content-Type': 'application/json' },
                body: payload instanceof FormData
                    ? payload
                    : JSON.stringify(payload),
                signal: controllerRef.current.signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }

            if (!response.body) {
                throw new Error('Response body is not available');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let messageBuffer = '';
            let accumulatedResponse = '';

            // Update function outside the loop to avoid no-loop-func warning
            const updateAccumulatedResponse = (newVal) => {
                accumulatedResponse = newVal;
            };

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    // Process any remaining data
                    if (messageBuffer.trim()) {
                        processStreamData(messageBuffer, {
                            onProgress,
                            onContent,
                            onComplete,
                            onError,
                            onMessage,
                            accumulatedResponse,
                            setAccumulatedResponse: updateAccumulatedResponse
                        });
                    }
                    break;
                }

                messageBuffer += decoder.decode(value, { stream: true });

                // Process complete messages separated by double newlines
                let boundaryIndex;
                while ((boundaryIndex = messageBuffer.indexOf('\n\n')) >= 0) {
                    const completeMessage = messageBuffer.substring(0, boundaryIndex);
                    messageBuffer = messageBuffer.substring(boundaryIndex + 2);

                    accumulatedResponse = processStreamData(completeMessage, {
                        onProgress,
                        onContent,
                        onComplete,
                        onError,
                        onMessage,
                        accumulatedResponse,
                        setAccumulatedResponse: updateAccumulatedResponse
                    });
                }
            }

        } catch (err) {
            if (err.name !== 'AbortError') {
                const errorMessage = err.message || 'Unknown error occurred';
                onError?.(errorMessage);
            }
        } finally {
            setIsLoading(false);
            controllerRef.current = null;
            setProgress(0);
        }
    };

    // Process individual stream data chunks
    const processStreamData = (data, handlers) => {
        const { onProgress, onContent, onComplete, onError, onMessage, accumulatedResponse, setAccumulatedResponse } = handlers;
        
        // Local variable to track updates within this processing batch
        let currentResponse = accumulatedResponse;

        if (!data.trim()) return currentResponse;

        // Handle SSE format: "data: {json}"
        if (data.startsWith('data:')) {
            try {
                const jsonData = data.replace(/^data:\s*/, '');
                const parsedData = JSON.parse(jsonData);

                // Handle progress updates (for court analysis)
                if (parsedData.progress !== undefined) {
                    setProgress(parsedData.progress);
                    onProgress?.(parsedData);
                }

                // Handle content updates (for chat streaming)
                if (parsedData.content) {
                    const newResponse = currentResponse + parsedData.content;
                    setAccumulatedResponse(newResponse);
                    currentResponse = newResponse; // Update local tracker
                    onContent?.(newResponse, parsedData);
                }

                // Handle error messages
                if (parsedData.error) {
                    onError?.(parsedData.error);
                }

                // Handle completion
                if (parsedData.step === 'complete' || parsedData.complete || parsedData.done) {
                    onComplete?.(parsedData.data || parsedData);
                }

                // Handle generic messages
                if (onMessage) {
                    onMessage(parsedData);
                }

            } catch (e) {
                console.error('Error parsing stream data:', e);
                onError?.('Failed to process server response');
            }
        } else {
            // Handle non-SSE responses (rare case)
            console.warn('Received non-SSE data:', data);
        }

        return currentResponse;
    };

    // Chat-specific streaming function
    const streamChat = async (messages, file, callbacks) => {
        const API_URL = import.meta.env?.VITE_API_URL || 
                        import.meta.env?.REACT_APP_API_URL || 
                        (typeof process !== 'undefined' ? process.env.REACT_APP_API_URL : undefined) || 
                        '/api/chat';

        // Prepare chat messages for API
        const chatMessages = messages.map(msg => ({
            role: msg.isUser ? 'user' : 'assistant',
            // Use rawText (uncleaned markdown) for AI messages if available,
            // this ensures Gemini sees the full context of previous documents it edited.
            content: (!msg.isUser && msg.rawText) ? msg.rawText : msg.text
        })).filter(msg => msg.content.trim() !== '' || msg.hasAttachment);

        // Use FormData for file uploads
        const formData = new FormData();
        formData.append('messages', JSON.stringify(chatMessages));

        if (file) {
            formData.append('file', file);
        }

        return streamResponse({
            url: API_URL,
            payload: formData,
            onContent: callbacks.onContent,
            onError: callbacks.onError,
            onComplete: callbacks.onComplete
        });
    };

    // Court analysis streaming function
    const streamCourtAnalysis = async (searchTerm, callbacks) => {
        const COURT_ANALYSIS_URL = import.meta.env?.VITE_COURT_ANALYSIS_URL || 
                                   import.meta.env?.REACT_APP_COURT_ANALYSIS_URL || 
                                   (typeof process !== 'undefined' ? process.env.REACT_APP_COURT_ANALYSIS_URL : undefined) || 
                                   '/api/court-analysis';

        return streamResponse({
            url: COURT_ANALYSIS_URL,
            payload: { searchTerm: searchTerm.trim() },
            onProgress: callbacks.onProgress,
            onComplete: callbacks.onComplete,
            onError: callbacks.onError
        });
    };

    // Document editing streaming function (for Bubble Menu AI editing)
    const streamDocumentEdit = async (selectedText, instruction, callbacks, options = {}) => {
        const DOCUMENT_EDIT_URL = import.meta.env?.VITE_DOCUMENT_EDIT_URL || 
                                  import.meta.env?.REACT_APP_DOCUMENT_EDIT_URL || 
                                  (typeof process !== 'undefined' ? process.env.REACT_APP_DOCUMENT_EDIT_URL : undefined) || 
                                  '/api/document-edit';

        // Add Croatian legal context for better AI responses
        const context = {
            language: 'hr', // Croatian
            jurisdiction: 'Croatia',
            legalContext: 'Croatian law and court system',
            includeCitations: false,
            ...options.context
        };

        return streamResponse({
            url: DOCUMENT_EDIT_URL,
            payload: {
                content: selectedText,
                instruction: instruction,
                context: context,
                mode: options.mode || 'preview',
                preserveFormatting: true,
                selectionRange: options.selectionRange
            },
            onContent: callbacks.onContent,
            onComplete: callbacks.onComplete,
            onError: callbacks.onError,
            onMessage: callbacks.onMessage
        });
    };

    // Stop current streaming operation
    const stopGeneration = useCallback(() => {
        if (controllerRef.current) {
            controllerRef.current.abort();
            setIsLoading(false);
            setProgress(0);
        }
    }, []);

    return {
        // State
        isLoading,
        progress,

        // Methods
        streamChat,
        streamCourtAnalysis,
        streamDocumentEdit,
        stopGeneration,

        // Generic stream handler for custom use cases
        streamResponse,

        // Constants for usage
        DOCUMENT_EDIT_URL: import.meta.env?.VITE_DOCUMENT_EDIT_URL || 
                           import.meta.env?.REACT_APP_DOCUMENT_EDIT_URL || 
                           (typeof process !== 'undefined' ? process.env.REACT_APP_DOCUMENT_EDIT_URL : undefined) || 
                           '/api/document-edit'
    };
};
