// File validation utilities extracted from AltChat component
export const validateChatFile = (file) => {
    const errors = [];
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif'];
    const maxSize = 2 * 1024 * 1024; // 2MB

    if (!allowedTypes.includes(file.type)) {
        errors.push('Nepodržani format datoteke. Dozvoljeni su samo PDF, JPEG i PNG.');
    }

    if (file.size > maxSize) {
        errors.push('Datoteka je prevelika. Maksimalna veličina je 2MB.');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
};

export const validateCanvasFile = (file) => {
    const errors = [];
    const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/gif',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ];
    const maxSize = 2 * 1024 * 1024; // 2MB

    if (!allowedTypes.includes(file.type)) {
        errors.push('Nepodržani format datoteke. Dozvoljeni su PDF, DOC, DOCX, TXT, JPEG, PNG i GIF.');
    }

    if (file.size > maxSize) {
        errors.push('Datoteka je prevelika. Maksimalna veličina je 2MB.');
    }

    // Additional checks for document files
        if (file.type.startsWith('application/') || file.type === 'text/plain') {
            const validExtensions = ['.pdf', '.doc', '.docx', '.txt'];
            const hasValidExtension = validExtensions.some(ext => 
                file.name.toLowerCase().endsWith(ext)
            );

            if (!hasValidExtension) {
                errors.push('Nepodržani format datoteke. Dozvoljeni su PDF, DOC, DOCX, TXT, JPEG, PNG i GIF.');
            }
        }

    return {
        isValid: errors.length === 0,
        errors
    };
};

export const validateFileSize = (file, maxSize = 2 * 1024 * 1024) => {
    if (file.size > maxSize) {
        return {
            isValid: false,
            error: 'Datoteka je prevelika. Maksimalna veličina je 2MB.'
        };
    }
    return { isValid: true };
};

export const validateFileType = (file, allowedTypes) => {
    if (!allowedTypes.includes(file.type)) {
        return {
            isValid: false,
            error: `Nepodržani format datoteke. Dozvoljeni su: ${allowedTypes.join(', ')}.`
        };
    }
    return { isValid: true };
};

export const getFileType = (file) => {
    if (file.type.startsWith('image/')) {
        return 'image';
    } else if (file.type === 'application/pdf') {
        return 'pdf';
    } else if (file.type.includes('document') || 
               file.type === 'text/plain' || 
               file.type === 'application/msword' ||
               file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return 'document';
    } else {
        return 'unknown';
    }
};

export const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};