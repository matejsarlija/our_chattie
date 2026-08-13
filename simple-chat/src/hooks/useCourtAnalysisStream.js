import { useState, useRef, useCallback } from 'react';
import { env } from '../lib/env';

const isNonProductionRuntime = () => {
    try {
        return typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
    } catch {
        return true;
    }
};

const classifyQueryType = (value) => {
    if (/^\d{11}$/.test(value)) return 'oib';
    if (/^[A-Za-zČĆŽŠĐčćžšđ]{1,6}\s*-\s*\d+\s*\/\s*\d{2,4}$/.test(value)) return 'case_number';
    return 'text';
};

export const buildCourtAnalysisPayload = (input) => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const typedType = String(input.type || '').trim();
        const typedValue = String(input.value || '').trim();
        if (typedType && typedValue) {
            return {
                query: {
                    type: typedType,
                    value: typedValue,
                },
                searchTerm: typedValue,
            };
        }
    }

    const searchTerm = String(input || '').trim();
    return {
        query: {
            type: classifyQueryType(searchTerm),
            value: searchTerm,
        },
        searchTerm,
    };
};

export const useCourtAnalysisStream = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const controllerRef = useRef(null);

    const streamCourtAnalysis = async (queryInput, callbacks = {}) => {
        const COURT_ANALYSIS_URL = env.courtAnalysisUrl;
        const payload = buildCourtAnalysisPayload(queryInput);

        setIsLoading(true);
        setProgress(0);
        controllerRef.current = new AbortController();

        if (isNonProductionRuntime()) {
            // Useful for debugging payload contract changes during rollout.
            console.debug('[streamCourtAnalysis] payload query:', payload.query);
        }

        try {
            const response = await fetch(COURT_ANALYSIS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controllerRef.current.signal,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const apiError = new Error(errorData.error || `Server error: ${response.status}`);
                apiError.code = errorData.code;
                apiError.status = response.status;
                throw apiError;
            }

            if (!response.body) {
                throw new Error('Response body is not available');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let messageBuffer = '';

            const dispatch = (data) => {
                if (!data || !data.trim()) return;
                if (!data.startsWith('data:')) return;

                try {
                    const jsonData = data.replace(/^data:\s*/, '');
                    const parsedData = JSON.parse(jsonData);

                    if (parsedData.progress !== undefined) {
                        setProgress(parsedData.progress);
                        callbacks.onProgress?.(parsedData);
                    }

                    if (parsedData.error) {
                        callbacks.onError?.(parsedData.error, parsedData);
                    }

                    if (parsedData.step === 'complete' || parsedData.complete || parsedData.done) {
                        callbacks.onComplete?.(parsedData.data || parsedData);
                    }

                    callbacks.onMessage?.(parsedData);
                } catch (e) {
                    console.error('Error parsing stream data:', e);
                    callbacks.onError?.('Failed to process server response', e);
                }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                messageBuffer += decoder.decode(value, { stream: true });

                let boundaryIndex;
                while ((boundaryIndex = messageBuffer.indexOf('\n\n')) >= 0) {
                    const completeMessage = messageBuffer.substring(0, boundaryIndex);
                    messageBuffer = messageBuffer.substring(boundaryIndex + 2);
                    dispatch(completeMessage);
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                callbacks.onError?.(err.message || 'Unknown error occurred', err);
            }
        } finally {
            setIsLoading(false);
            controllerRef.current = null;
            setProgress(0);
        }
    };

    const stopGeneration = useCallback(() => {
        if (controllerRef.current) {
            controllerRef.current.abort();
            setIsLoading(false);
            setProgress(0);
        }
    }, []);

    return {
        isLoading,
        progress,
        streamCourtAnalysis,
        stopGeneration,
    };
};
