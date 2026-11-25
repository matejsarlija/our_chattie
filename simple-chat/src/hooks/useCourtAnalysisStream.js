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

export const buildCourtAnalysisPayload = (input, options = {}) => {
    const scanDepth = options.scanDepth || 'balanced';

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
                options: { scanDepth },
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
        options: { scanDepth },
    };
};

export const useCourtAnalysisStream = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const controllerRef = useRef(null);

    const streamCourtAnalysis = async (queryInput, callbacks = {}, options = {}) => {
        const payload = buildCourtAnalysisPayload(queryInput, options);
        setIsLoading(true);
        setProgress(0);
        controllerRef.current = new AbortController();

        if (isNonProductionRuntime()) {
            console.debug('[streamCourtAnalysis] payload query:', payload.query);
        }

        try {
            const response = await fetch(env.courtAnalysisUrl, {
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

            const accepted = await response.json();
            if (response.status !== 202 || !accepted?.analysisId || accepted.status !== 'queued') {
                throw new Error('Server returned an invalid queued-analysis response.');
            }
            callbacks.onAccepted?.(accepted);
            return accepted;
        } catch (err) {
            if (err.name !== 'AbortError') callbacks.onError?.(err.message || 'Unknown error occurred', err);
            return null;
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
