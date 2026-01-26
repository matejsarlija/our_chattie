import { useState, useRef, useCallback } from 'react';

export const useFileUpload = () => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);

    // File validation rules
    const validateFile = useCallback((file) => {
        const errors = [];

        // Allowed file types for chat attachments and document import
        const allowedTypes = [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/gif',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];

        if (!allowedTypes.includes(file.type)) {
            errors.push('Nepodržani format datoteke. Dozvoljeni su PDF, DOC, DOCX, TXT, JPEG, PNG i GIF.');
        }

        // Check file size (2MB default, 15MB for premium)
        const maxSize = 2 * 1024 * 1024; // 2MB
        if (file.size > maxSize) {
            errors.push('Datoteka je prevelika. Maksimalna veličina je 2MB.');
        }

        // Additional checks for document files
        if (file.type.startsWith('application/') || file.type === 'text/plain') {
            // Check file extension
            const validExtensions = ['.pdf', '.doc', '.docx', '.txt'];
            const hasValidExtension = validExtensions.some(ext => 
                file.name.toLowerCase().endsWith(ext)
            );

            if (!hasValidExtension) {
                errors.push('Neispravna ekstenzija datoteke za dokument.');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }, []);

    // Handle file selection
    const handleFileSelect = useCallback((e) => {
        const file = e.target.files[0];
        if (!file) return;

        setError('');

        const validation = validateFile(file);
        if (!validation.isValid) {
            setError(validation.errors[0]);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }

        setSelectedFile(file);
    }, [validateFile]);

    // Remove selected file
    const removeFile = useCallback(() => {
        setSelectedFile(null);
        setError('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    // Trigger file input click
    const triggerFileInput = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    // Format file size
    const formatFileSize = useCallback((bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }, []);

    // Get file icon based on type
    const getFileIcon = useCallback((mimeType) => {
        if (mimeType.startsWith('image/')) {
            return '🖼️';
        } else if (mimeType === 'application/pdf') {
            return '📄';
        } else if (mimeType.includes('document')) {
            return '📝';
        } else if (mimeType === 'text/plain') {
            return '📃';
        } else {
            return '📎';
        }
    }, []);

    // Get file preview information
    const getFilePreview = useCallback((file) => {
        if (!file) return null;

        const isImage = file.type.startsWith('image/');
        const isPDF = file.type === 'application/pdf';
        const isDocument = file.type.includes('document') || file.type === 'text/plain';

        return {
            name: file.name,
            size: formatFileSize(file.size),
            type: file.type,
            isImage,
            isPDF,
            isDocument,
            icon: getFileIcon(file.type)
        };
    }, [formatFileSize, getFileIcon]);

    // Parse document content for embedded editor import
    const parseDocumentContent = useCallback(async (file) => {
        if (!file) return null;

        try {
            const isTextFile = file.type === 'text/plain';
            const isPDF = file.type === 'application/pdf';

            if (isTextFile) {
                return await file.text();
            }

            if (isPDF) {
                // For PDF files, we'd need a PDF parsing library
                // For now, return a placeholder indicating the file was uploaded
                return `[Document: ${file.name}]\n\nPDF content parsing will be implemented with a PDF library.`;
            }

            // For other document types, return a placeholder
            return `[Document: ${file.name}]\n\nDocument content parsing will be implemented for ${file.type} files.`;

        } catch (error) {
            console.error('Error parsing document:', error);
            throw new Error('Failed to parse document content');
        }
    }, []);

    // Handle document import for embedded editor
    const handleDocumentImport = useCallback(async (file) => {
        setIsUploading(true);
        setUploadProgress(0);
        setError('');

        try {
            // Simulate upload progress
            const progressInterval = setInterval(() => {
                setUploadProgress(prev => Math.min(prev + 10, 90));
            }, 100);

            const content = await parseDocumentContent(file);
            
            clearInterval(progressInterval);
            setUploadProgress(100);

            return {
                content,
                fileName: file.name,
                fileType: file.type,
                importedAt: new Date().toISOString()
            };

        } catch (error) {
            setError(error.message || 'Failed to import document');
            throw error;
        } finally {
            setIsUploading(false);
            setTimeout(() => setUploadProgress(0), 1000);
        }
    }, [parseDocumentContent]);

    // Handle chat file attachment
    const handleChatAttachment = useCallback((file) => {
        // For chat, we just need to validate and store the file
        const validation = validateFile(file);
        if (!validation.isValid) {
            setError(validation.errors[0]);
            return null;
        }

        return {
            file,
            preview: getFilePreview(file)
        };
    }, [validateFile, getFilePreview]);

    // Clear upload state
    const clearUploadState = useCallback(() => {
        setSelectedFile(null);
        setUploadProgress(0);
        setIsUploading(false);
        setError('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    // Get upload limits based on user tier
    const getUploadLimits = useCallback(() => {
        return {
            maxFileSize: 2 * 1024 * 1024, // 2MB
            maxFileCount: 1,
            allowedTypes: [
                'application/pdf',
                'image/jpeg',
                'image/png',
                'image/gif',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain'
            ],
            // For premium users (future feature)
            premiumLimits: {
                maxFileSize: 15 * 1024 * 1024, // 15MB
                maxFileCount: 5
            }
        };
    }, []);

    return {
        // State
        selectedFile,
        uploadProgress,
        isUploading,
        error,

        // Methods
        handleFileSelect,
        removeFile,
        triggerFileInput,
        handleDocumentImport,
        handleChatAttachment,
        clearUploadState,

        // Utilities
        getFilePreview,
        formatFileSize,
        getFileIcon,
        getUploadLimits,
        validateFile,

        // Refs
        fileInputRef
    };
};