// Standardized error handling utilities

export class AppError extends Error {
    constructor(message, type = 'general', code = null, details = null) {
        super(message);
        this.name = 'AppError';
        this.type = type;
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
}

export class NetworkError extends AppError {
    constructor(message, status = null, response = null) {
        super(message, 'network', status, response);
        this.name = 'NetworkError';
        this.status = status;
        this.response = response;
    }
}

export class ValidationError extends AppError {
    constructor(message, field = null, value = null) {
        super(message, 'validation', null, { field, value });
        this.name = 'ValidationError';
        this.field = field;
        this.value = value;
    }
}

export class StorageError extends AppError {
    constructor(message, operation = null) {
        super(message, 'storage', null, { operation });
        this.name = 'StorageError';
        this.operation = operation;
    }
}

export class FileError extends AppError {
    constructor(message, file = null, operation = null) {
        super(message, 'file', null, { fileName: file?.name, operation });
        this.name = 'FileError';
        this.file = file;
        this.operation = operation;
    }
}

// Error message mappings
export const ERROR_MESSAGES = {
    network: {
        connection_failed: 'Connection failed. Please check your internet connection.',
        server_error: 'Server error. Please try again later.',
        timeout: 'Request timed out. Please try again.',
        abort: 'Request was cancelled.',
        default: 'Network error occurred. Please try again.'
    },
    validation: {
        file_too_large: 'File is too large. Maximum size is 2MB.',
        invalid_file_type: 'Invalid file type. Please upload a supported file format.',
        required_field: 'This field is required.',
        invalid_input: 'Invalid input provided.',
        default: 'Validation error occurred.'
    },
    storage: {
        quota_exceeded: 'Storage quota exceeded. Please clear some data.',
        access_denied: 'Storage access denied.',
        data_corrupted: 'Data appears to be corrupted.',
        default: 'Storage error occurred.'
    },
    file: {
        upload_failed: 'File upload failed.',
        parsing_failed: 'Failed to parse file content.',
        not_found: 'File not found.',
        default: 'File error occurred.'
    }
};

// Get user-friendly error message
export const getErrorMessage = (error) => {
    if (error instanceof AppError) {
        const categoryMessages = ERROR_MESSAGES[error.type];
        if (categoryMessages) {
            return categoryMessages[error.code] || categoryMessages.default || error.message;
        }
        return error.message;
    }

    if (error instanceof TypeError) {
        return ERROR_MESSAGES.validation.default;
    }

    if (error.name === 'AbortError') {
        return ERROR_MESSAGES.network.abort;
    }

    return error.message || ERROR_MESSAGES.network.default;
};

// Handle async errors with fallback
export const handleAsyncError = async (asyncFn, fallback = null) => {
    try {
        return await asyncFn();
    } catch (error) {
        console.error('Async error:', error);
        if (fallback) {
            return fallback();
        }
        throw error;
    }
};

// Create error logging function
export const logError = (error, context = {}) => {
    const errorInfo = {
        message: error.message,
        name: error.name,
        type: error.type || 'unknown',
        code: error.code || null,
        timestamp: new Date().toISOString(),
        context,
        stack: error.stack
    };

    console.error('Application Error:', errorInfo);

    // In production, you might send this to an error tracking service
    const isProduction = (typeof process !== 'undefined' && process.env.NODE_ENV === 'production');
    if (isProduction && window.gtag) {
        window.gtag('event', 'exception', {
            description: error.message,
            fatal: false
        });
    }
};

// Create user-friendly error handler
export const createErrorHandler = (setError, context = {}) => {
    return (error) => {
        const userMessage = getErrorMessage(error);
        logError(error, context);
        setError(userMessage);
        return { handled: true, message: userMessage };
    };
};

// Error boundary fallback component helper
export const getErrorBoundaryMessage = (error) => {
    const isDevelopment = (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');
    return {
        title: 'Something went wrong',
        message: getErrorMessage(error),
        showRetry: true,
        showDetails: isDevelopment
    };
};

// Retry logic for failed operations
export const retryOperation = async (operation, maxRetries = 3, delay = 1000) => {
    let lastError;

    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            // Don't retry on validation or abort errors
            if (error instanceof ValidationError || error.name === 'AbortError') {
                throw error;
            }

            // If this is the last attempt, throw the error
            if (i === maxRetries) {
                throw error;
            }

            // Wait before retrying with exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        }
    }

    throw lastError;
};