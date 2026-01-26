import {
    validateChatFile,
    validateCanvasFile,
    validateFileSize,
    validateFileType,
    getFileType,
    formatFileSize
} from '../fileValidation';

// Mock File object
const createMockFile = (name = 'test.pdf', type = 'application/pdf', size = 1024 * 1024) => {
    const file = new File(['test content'], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
};

describe('fileValidation utilities', () => {
    describe('validateChatFile', () => {
        test('should validate valid PDF file', () => {
            const file = createMockFile('document.pdf', 'application/pdf', 1024 * 1024);
            const result = validateChatFile(file);

            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test('should validate valid image files', () => {
            const jpegFile = createMockFile('image.jpg', 'image/jpeg', 500 * 1024);
            const pngFile = createMockFile('image.png', 'image/png', 800 * 1024);

            expect(validateChatFile(jpegFile).isValid).toBe(true);
            expect(validateChatFile(pngFile).isValid).toBe(true);
        });

        test('should reject unsupported file types', () => {
            const docFile = createMockFile('document.doc', 'application/msword');
            const txtFile = createMockFile('text.txt', 'text/plain');
            const videoFile = createMockFile('video.mp4', 'video/mp4');

            expect(validateChatFile(docFile).isValid).toBe(false);
            expect(validateChatFile(txtFile).isValid).toBe(false);
            expect(validateChatFile(videoFile).isValid).toBe(false);

            expect(validateChatFile(docFile).errors[0]).toContain('Nepodržani format datoteke');
        });

        test('should reject files larger than 2MB', () => {
            const largeFile = createMockFile('large.pdf', 'application/pdf', 5 * 1024 * 1024);
            const result = validateChatFile(largeFile);

            expect(result.isValid).toBe(false);
            expect(result.errors[0]).toContain('prevelika');
        });
    });

    describe('validateCanvasFile', () => {
        test('should validate all canvas-supported file types', () => {
            const pdfFile = createMockFile('document.pdf', 'application/pdf');
            const jpegFile = createMockFile('image.jpg', 'image/jpeg');
            const pngFile = createMockFile('image.png', 'image/png');
            const docFile = createMockFile('document.doc', 'application/msword');
            const docxFile = createMockFile('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            const txtFile = createMockFile('text.txt', 'text/plain');

            expect(validateCanvasFile(pdfFile).isValid).toBe(true);
            expect(validateCanvasFile(jpegFile).isValid).toBe(true);
            expect(validateCanvasFile(pngFile).isValid).toBe(true);
            expect(validateCanvasFile(docFile).isValid).toBe(true);
            expect(validateCanvasFile(docxFile).isValid).toBe(true);
            expect(validateCanvasFile(txtFile).isValid).toBe(true);
        });

        test('should reject files with wrong extensions', () => {
            const file = createMockFile('document.exe', 'application/octet-stream');
            const result = validateCanvasFile(file);

            expect(result.isValid).toBe(false);
            expect(result.errors[0]).toContain('Nepodržani format');
        });

        test('should reject files larger than 2MB', () => {
            const largeFile = createMockFile('large.pdf', 'application/pdf', 5 * 1024 * 1024);
            const result = validateCanvasFile(largeFile);

            expect(result.isValid).toBe(false);
            expect(result.errors[0]).toContain('prevelika');
        });
    });

    describe('validateFileSize', () => {
        test('should validate file within limit', () => {
            const file = createMockFile('small.pdf', 'application/pdf', 1024 * 1024); // 1MB
            const result = validateFileSize(file, 2 * 1024 * 1024); // 2MB limit

            expect(result.isValid).toBe(true);
        });

        test('should reject file exceeding limit', () => {
            const file = createMockFile('large.pdf', 'application/pdf', 5 * 1024 * 1024); // 5MB
            const result = validateFileSize(file, 2 * 1024 * 1024); // 2MB limit

            expect(result.isValid).toBe(false);
            expect(result.error).toContain('prevelika');
        });

        test('should use default 2MB limit when not specified', () => {
            const largeFile = createMockFile('large.pdf', 'application/pdf', 5 * 1024 * 1024);
            const result = validateFileSize(largeFile);

            expect(result.isValid).toBe(false);
        });
    });

    describe('validateFileType', () => {
        test('should validate allowed file type', () => {
            const file = createMockFile('document.pdf', 'application/pdf');
            const allowedTypes = ['application/pdf', 'image/jpeg'];
            const result = validateFileType(file, allowedTypes);

            expect(result.isValid).toBe(true);
        });

        test('should reject disallowed file type', () => {
            const file = createMockFile('video.mp4', 'video/mp4');
            const allowedTypes = ['application/pdf', 'image/jpeg'];
            const result = validateFileType(file, allowedTypes);

            expect(result.isValid).toBe(false);
            expect(result.error).toContain('Nepodržani format');
            expect(result.error).toContain('application/pdf, image/jpeg');
        });
    });

    describe('getFileType', () => {
        test('should identify image files', () => {
            const jpegFile = createMockFile('image.jpg', 'image/jpeg');
            const pngFile = createMockFile('image.png', 'image/png');
            const gifFile = createMockFile('image.gif', 'image/gif');

            expect(getFileType(jpegFile)).toBe('image');
            expect(getFileType(pngFile)).toBe('image');
            expect(getFileType(gifFile)).toBe('image');
        });

        test('should identify PDF files', () => {
            const file = createMockFile('document.pdf', 'application/pdf');
            expect(getFileType(file)).toBe('pdf');
        });

        test('should identify document files', () => {
            const docFile = createMockFile('document.doc', 'application/msword');
            const docxFile = createMockFile('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            const txtFile = createMockFile('text.txt', 'text/plain');

            expect(getFileType(docFile)).toBe('document');
            expect(getFileType(docxFile)).toBe('document');
            expect(getFileType(txtFile)).toBe('document');
        });

        test('should return unknown for unsupported types', () => {
            const videoFile = createMockFile('video.mp4', 'video/mp4');
            expect(getFileType(videoFile)).toBe('unknown');
        });
    });

    describe('formatFileSize', () => {
        test('should format zero bytes', () => {
            expect(formatFileSize(0)).toBe('0 Bytes');
        });

        test('should format bytes', () => {
            expect(formatFileSize(512)).toBe('512 Bytes');
            expect(formatFileSize(1023)).toBe('1023 Bytes');
        });

        test('should format kilobytes', () => {
            expect(formatFileSize(1024)).toBe('1 KB');
            expect(formatFileSize(1536)).toBe('1.5 KB');
            expect(formatFileSize(1024 * 1023)).toBe('1023 KB');
        });

        test('should format megabytes', () => {
            expect(formatFileSize(1024 * 1024)).toBe('1 MB');
            expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
        });

        test('should format gigabytes', () => {
            expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
            expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
        });

        test('should handle decimal precision correctly', () => {
            expect(formatFileSize(1234567)).toBe('1.18 MB');
            expect(formatFileSize(1234567890)).toBe('1.15 GB');
        });
    });
});