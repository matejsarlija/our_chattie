import {
    AppError,
    NetworkError,
    ValidationError,
    StorageError,
    FileError,
    ERROR_MESSAGES,
    getErrorMessage,
    handleAsyncError,
    createErrorHandler,
    getErrorBoundaryMessage,
    retryOperation
} from '../errorHandler';

describe('errorHandler utilities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.error = jest.fn();
    });

    describe('Error Classes', () => {
        test('AppError should create error with required properties', () => {
            const error = new AppError('Test message', 'test', 'TEST_CODE', { extra: 'data' });

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe('AppError');
            expect(error.message).toBe('Test message');
            expect(error.type).toBe('test');
            expect(error.code).toBe('TEST_CODE');
            expect(error.details).toEqual({ extra: 'data' });
            expect(error.timestamp).toBeDefined();
        });

        test('NetworkError should extend AppError correctly', () => {
            const error = new NetworkError('Network failed', 'server_error');

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('NetworkError');
            expect(error.type).toBe('network');
            expect(error.status).toBe(500);
            expect(error.response).toEqual({ status: 'error' });
        });

        test('ValidationError should extend AppError correctly', () => {
            const error = new ValidationError('Invalid input', 'email', 'invalid@email');

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('ValidationError');
            expect(error.type).toBe('validation');
            expect(error.field).toBe('email');
            expect(error.value).toBe('invalid@email');
        });

        test('StorageError should extend AppError correctly', () => {
            const error = new StorageError('Storage full', 'write');

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('StorageError');
            expect(error.type).toBe('storage');
            expect(error.operation).toBe('write');
        });

        test('FileError should extend AppError correctly', () => {
            const mockFile = new File(['content'], 'test.pdf');
            const error = new FileError('Upload failed', mockFile, 'upload');

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('FileError');
            expect(error.type).toBe('file');
            expect(error.file).toBe(mockFile);
            expect(error.operation).toBe('upload');
        });
    });

    describe('ERROR_MESSAGES', () => {
        test('should have messages for all error categories', () => {
            expect(ERROR_MESSAGES.network).toBeDefined();
            expect(ERROR_MESSAGES.validation).toBeDefined();
            expect(ERROR_MESSAGES.storage).toBeDefined();
            expect(ERROR_MESSAGES.file).toBeDefined();

            expect(ERROR_MESSAGES.network.default).toBeDefined();
            expect(ERROR_MESSAGES.validation.default).toBeDefined();
            expect(ERROR_MESSAGES.storage.default).toBeDefined();
            expect(ERROR_MESSAGES.file.default).toBeDefined();
        });
    });

    describe('getErrorMessage', () => {
        test('should return message from AppError with matching code', () => {
            const error = new NetworkError('Connection failed', 'server_error');
            const message = getErrorMessage(error);

            expect(message).toBe(ERROR_MESSAGES.network.server_error);
        });

        test('should return default message for unknown code', () => {
            const error = new AppError('Custom message', 'network', 'UNKNOWN_CODE');
            const message = getErrorMessage(error);

            expect(message).toBe('Custom message');
        });

        test('should return default category message for AppError', () => {
            const error = new AppError('Some error', 'unknown');
            const message = getErrorMessage(error);

            expect(message).toBe('Some error');
        });

        test('should handle TypeError', () => {
            const error = new TypeError('Invalid type');
            const message = getErrorMessage(error);

            expect(message).toBe(ERROR_MESSAGES.validation.default);
        });

        test('should handle AbortError', () => {
            const error = new Error('Request aborted');
            error.name = 'AbortError';
            const message = getErrorMessage(error);

            expect(message).toBe(ERROR_MESSAGES.network.abort);
        });

        test('should return message for generic Error', () => {
            const error = new Error('Generic error');
            const message = getErrorMessage(error);

            expect(message).toBe('Generic error');
        });

        test('should return default message for error without message', () => {
            const error = new Error();
            const message = getErrorMessage(error);

            expect(message).toBe(ERROR_MESSAGES.network.default);
        });
    });

    describe('handleAsyncError', () => {
        test('should return result when async function succeeds', async () => {
            const successFn = jest.fn().mockResolvedValue('success');
            const result = await handleAsyncError(successFn);

            expect(result).toBe('success');
            expect(successFn).toHaveBeenCalled();
        });

        test('should log error when async function fails', async () => {
            const errorFn = jest.fn().mockRejectedValue(new Error('Async error'));
            
            await expect(handleAsyncError(errorFn)).rejects.toThrow('Async error');
            expect(console.error).toHaveBeenCalledWith('Async error:', expect.any(Error));
        });

        test('should return fallback when provided and async function fails', async () => {
            const errorFn = jest.fn().mockRejectedValue(new Error('Async error'));
            const fallbackFn = jest.fn().mockReturnValue('fallback');

            const result = await handleAsyncError(errorFn, fallbackFn);

            expect(result).toBe('fallback');
            expect(fallbackFn).toHaveBeenCalled();
        });
    });

    describe('createErrorHandler', () => {
        test('should create error handler function', () => {
            const setError = jest.fn();
            const errorHandler = createErrorHandler(setError, { component: 'Test' });

            expect(typeof errorHandler).toBe('function');
        });

        test('should handle error and set user message', () => {
            const setError = jest.fn();
            const errorHandler = createErrorHandler(setError, { component: 'Test' });
            const error = new NetworkError('Connection failed', 'server_error');

            const result = errorHandler(error);

            expect(setError).toHaveBeenCalledWith(ERROR_MESSAGES.network.server_error);
            expect(console.error).toHaveBeenCalledWith(
                'Application Error:',
                expect.objectContaining({
                    message: 'Connection failed',
                    type: 'network',
                    code: 'server_error',
                    context: { component: 'Test' }
                })
            );
            expect(result).toEqual({
                handled: true,
                message: ERROR_MESSAGES.network.server_error
            });
        });

        test('should track analytics in production', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            window.gtag = jest.fn();

            const setError = jest.fn();
            const errorHandler = createErrorHandler(setError);
            const error = new Error('Test error');

            errorHandler(error);

            expect(window.gtag).toHaveBeenCalledWith('event', 'exception', {
                description: 'Test error',
                fatal: false
            });

            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('getErrorBoundaryMessage', () => {
        test('should return user-friendly error boundary message', () => {
            const error = new NetworkError('Connection failed', 'server_error');
            const message = getErrorBoundaryMessage(error);

            expect(message).toEqual({
                title: 'Something went wrong',
                message: ERROR_MESSAGES.network.server_error,
                showRetry: true,
                showDetails: false // Not in development
            });
        });

        test('should show details in development mode', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            const error = new Error('Development error');
            const message = getErrorBoundaryMessage(error);

            expect(message.showDetails).toBe(true);

            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('retryOperation', () => {
        test('should succeed on first attempt', async () => {
            const operation = jest.fn().mockResolvedValue('success');
            const result = await retryOperation(operation);

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(1);
        });

        test('should retry on failure and eventually succeed', async () => {
            const operation = jest.fn()
                .mockRejectedValueOnce(new Error('First failure'))
                .mockRejectedValueOnce(new Error('Second failure'))
                .mockResolvedValue('success');

            const result = await retryOperation(operation, 3, 100);

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(3);
        });

        test('should fail after max retries', async () => {
            const operation = jest.fn().mockRejectedValue(new Error('Always fails'));

            await expect(retryOperation(operation, 2, 100))
                .rejects.toThrow('Always fails');

            expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
        });

        test('should not retry on validation errors', async () => {
            const validationError = new ValidationError('Invalid data');
            const operation = jest.fn().mockRejectedValue(validationError);

            await expect(retryOperation(operation, 3, 100))
                .rejects.toThrow('Invalid data');

            expect(operation).toHaveBeenCalledTimes(1); // No retries
        });

        test('should not retry on AbortError', async () => {
            const abortError = new Error('Request aborted');
            abortError.name = 'AbortError';
            const operation = jest.fn().mockRejectedValue(abortError);

            await expect(retryOperation(operation, 3, 100))
                .rejects.toThrow('Request aborted');

            expect(operation).toHaveBeenCalledTimes(1); // No retries
        });

        test('should use exponential backoff', async () => {
            const startTime = Date.now();
            const operation = jest.fn()
                .mockRejectedValueOnce(new Error('First failure'))
                .mockRejectedValueOnce(new Error('Second failure'))
                .mockResolvedValue('success');

            await retryOperation(operation, 3, 100);
            const endTime = Date.now();

            // Should have waited approximately 100ms + 200ms for retries
            expect(endTime - startTime).toBeGreaterThan(250);
            expect(endTime - startTime).toBeLessThan(400); // Allow some tolerance
        });
    });
});