// Server-Sent Events (SSE) parsing utilities

export class StreamParser {
    constructor() {
        this.buffer = '';
        this.accumulatedContent = '';
    }

    // Parse stream data chunk by chunk
    parseChunk(chunk) {
        if (!chunk) return this.accumulatedContent;

        this.buffer += chunk;
        const results = [];

        // Split by double newlines to find complete messages
        let boundaryIndex;
        while ((boundaryIndex = this.buffer.indexOf('\n\n')) >= 0) {
            const completeMessage = this.buffer.substring(0, boundaryIndex);
            this.buffer = this.buffer.substring(boundaryIndex + 2);

            const parsed = this.parseMessage(completeMessage);
            if (parsed) {
                results.push(parsed);
            }
        }

        return results;
    }

    // Parse individual message
    parseMessage(message) {
        if (!message.trim()) return null;

        // Handle SSE format: "data: {json}"
        if (message.startsWith('data:')) {
            try {
                const jsonData = message.replace(/^data:\s*/, '');
                return JSON.parse(jsonData);
            } catch (error) {
                console.error('Error parsing SSE message:', error, 'Message:', message);
                return { error: 'Failed to parse server response' };
            }
        }

        // Handle other formats (rare cases)
        try {
            return JSON.parse(message);
        } catch (error) {
            console.warn('Non-JSON message received:', message);
            return null;
        }
    }

    // Process parsed message with callbacks
    processMessage(parsedMessage, callbacks = {}) {
        const {
            onContent,
            onProgress,
            onComplete,
            onError,
            onMessage
        } = callbacks;

        if (!parsedMessage) return this.accumulatedContent;

        // Handle content updates (for chat streaming)
        if (parsedMessage.content) {
            this.accumulatedContent += parsedMessage.content;
            onContent?.(this.accumulatedContent, parsedMessage);
        }

        // Handle progress updates (for court analysis)
        if (parsedMessage.progress !== undefined) {
            onProgress?.(parsedMessage);
        }

        // Handle error messages
        if (parsedMessage.error) {
            onError?.(parsedMessage.error);
        }

        // Handle completion
        if (parsedMessage.step === 'complete' || parsedMessage.complete) {
            onComplete?.(parsedMessage.data || parsedMessage);
        }

        // Handle generic messages
        if (onMessage) {
            onMessage(parsedMessage);
        }

        return this.accumulatedContent;
    }

    // Reset parser state
    reset() {
        this.buffer = '';
        this.accumulatedContent = '';
    }

    // Get remaining buffer
    getRemainingBuffer() {
        return this.buffer;
    }
}

// Create a parser instance for immediate use
export const createStreamParser = () => new StreamParser();

// Parse SSE response from fetch
export const parseSSEResponse = async (response, callbacks = {}) => {
    if (!response.body) {
        throw new Error('Response body is not available');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new StreamParser();

    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                // Process any remaining data
                const remaining = parser.getRemainingBuffer();
                if (remaining.trim()) {
                    const parsed = parser.parseMessage(remaining);
                    if (parsed) {
                        parser.processMessage(parsed, callbacks);
                    }
                }
                break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const messages = parser.parseChunk(chunk);

            for (const message of messages) {
                parser.processMessage(message, callbacks);
            }
        }
    } finally {
        reader.releaseLock();
    }

    return parser.accumulatedContent;
};

// Validate SSE message format
export const validateSSEMessage = (message) => {
    if (!message || typeof message !== 'string') {
        return { isValid: false, error: 'Message must be a non-empty string' };
    }

    if (!message.startsWith('data:')) {
        return { isValid: false, error: 'Message must start with "data:"' };
    }

    try {
        const jsonData = message.replace(/^data:\s*/, '');
        JSON.parse(jsonData);
        return { isValid: true };
    } catch (error) {
        return { isValid: false, error: 'Invalid JSON in message' };
    }
};

// Message type detection
export const getMessageType = (message) => {
    if (message.content !== undefined) {
        return 'content';
    }
    if (message.progress !== undefined) {
        return 'progress';
    }
    if (message.error) {
        return 'error';
    }
    if (message.step === 'complete' || message.complete) {
        return 'complete';
    }
    return 'unknown';
};

// Extract relevant data from message based on type
export const extractMessageData = (message) => {
    const type = getMessageType(message);
    
    switch (type) {
        case 'content':
            return { type, data: message.content, fullMessage: message };
        case 'progress':
            return { type, data: message.progress, fullMessage: message };
        case 'error':
            return { type, data: message.error, fullMessage: message };
        case 'complete':
            return { type, data: message.data || message, fullMessage: message };
        default:
            return { type: 'unknown', data: message, fullMessage: message };
    }
};

// Utility for handling streaming with timeout
export const createStreamWithTimeout = (streamCallback, timeoutMs = 30000) => {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Stream timed out'));
        }, timeoutMs);

        streamCallback()
            .then(result => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
};