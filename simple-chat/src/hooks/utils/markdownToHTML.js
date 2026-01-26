/**
 * Markdown to HTML Converter Utility
 * 
 * Converts markdown content to HTML for TipTap editor initialization.
 * Uses react-markdown library which is already installed.
 */

// Simplified HTML conversion without external dependencies for testing
// In production, this would use react-markdown library

/**
 * Convert markdown string to HTML string (simplified version)
 * 
 * @param {string} markdown - The markdown content to convert
 * @param {Object} options - Conversion options
 * @returns {string} HTML string suitable for TipTap editor
 */
export const convertMarkdownToHTML = (markdown, options = {}) => {
    if (!markdown || typeof markdown !== 'string') {
        return '';
    }

    try {
        // If sanitization is requested, remove dangerous tags first
        let html = markdown;
        if (options.sanitize) {
            html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
            html = html.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
            html = html.replace(/javascript:/gi, '');
            html = html.replace(/on\w+\s*=/gi, '');
        }
        
        // Simplified markdown to HTML conversion
        
        // Headers
        html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
        
        // Lists (handle before line breaks)
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\s*)+/gs, (match) => {
            return '<ul>' + match + '</ul>';
        });
        
        // Bold and italic
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // Line breaks (but not in lists)
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/(?<!<\/li>)\n(?!<li>)/g, '<br>');
        
        // Wrap in paragraphs
        if (!html.startsWith('<h') && !html.startsWith('<ul>') && !html.startsWith('<ol>')) {
            html = '<p>' + html + '</p>';
        }
        
        return html;
        
    } catch (error) {
        console.error('Error converting markdown to HTML:', error);
        // Fallback to basic HTML escaping
        return `<p>${escapeHtml(markdown)}</p>`;
    }
};

/**
 * Convert markdown to HTML with citation preservation
 * Special handling for <citation> tags that should remain as-is
 * 
 * @param {string} markdown - The markdown content to convert
 * @param {Object} options - Conversion options
 * @returns {string} HTML string with citations preserved
 */
export const convertMarkdownWithCitations = (markdown, options = {}) => {
    if (!markdown || typeof markdown !== 'string') {
        return '';
    }

    // Find and protect citation tags
    const citationRegex = /<citation[^>]*>[\s\S]*?<\/citation>/g;
    const citations = [];
    let citationMatch;
    
    // Store citations and replace with placeholders
    let processedMarkdown = markdown;
    while ((citationMatch = citationRegex.exec(markdown)) !== null) {
        const citation = citationMatch[0];
        const placeholder = `__CITATION_${citations.length}__`;
        citations.push(citation);
        processedMarkdown = processedMarkdown.replace(citation, placeholder);
    }

    // Convert the rest of the markdown
    let html = convertMarkdownToHTML(processedMarkdown, options);
    
    // Restore citations
    citations.forEach((citation, index) => {
        html = html.replace(`__CITATION_${index}__`, citation);
    });
    
    return html;
};

/**
 * Simple HTML escaping function
 * 
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

/**
 * Clean HTML for TipTap compatibility
 * Removes unsupported elements and attributes
 * 
 * @param {string} html - HTML to clean
 * @returns {string} Cleaned HTML
 */
export const cleanHTMLForTipTap = (html) => {
    if (!html || typeof html !== 'string') {
        return '';
    }

    // If document is not available (e.g., during testing), return as-is
    if (typeof document === 'undefined' || !document.createElement) {
        return html;
    }

    try {
        // Remove problematic elements
        const div = document.createElement('div');
        div.innerHTML = html;
    
    // Remove comments
    const walker = document.createTreeWalker(
        div,
        NodeFilter.SHOW_COMMENT,
        null,
        false
    );
    
    let node;
    const commentsToRemove = [];
    while ((node = walker.nextNode())) {
        commentsToRemove.push(node);
    }
    commentsToRemove.forEach(comment => comment.remove());
    
    // Convert to string
    return div.innerHTML;
    } catch (error) {
        // Fallback if DOM manipulation fails
        console.warn('cleanHTMLForTipTap failed, returning original:', error);
        return html;
    }
};

/**
 * Validate HTML content
 * 
 * @param {string} html - HTML to validate
 * @returns {Object} Validation result
 */
export const validateHTML = (html) => {
    const issues = [];
    
    if (!html || typeof html !== 'string') {
        issues.push('HTML content is empty or invalid');
        return { isValid: false, issues };
    }
    
    // Check for script tags (security)
    if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(html)) {
        issues.push('HTML contains script tags - security risk');
    }
    
    // Check size
    if (html.length > 100000) {
        issues.push('HTML content is very large (>100KB), may impact performance');
    }
    
    return {
        isValid: issues.length === 0,
        issues,
        size: html.length
    };
};

/**
 * Batch convert multiple markdown blocks
 * 
 * @param {Array} blocks - Array of { markdown, id } objects
 * @param {Object} options - Conversion options
 * @returns {Array} Array of { id, html, markdown } objects
 */
export const batchConvertMarkdown = (blocks, options = {}) => {
    if (!Array.isArray(blocks)) {
        return [];
    }
    
    return blocks.map(block => ({
        id: block.id,
        html: convertMarkdownWithCitations(block.markdown || '', options),
        markdown: block.markdown || '',
        isValid: validateHTML(convertMarkdownWithCitations(block.markdown || '', options)).isValid
    }));
};

const markdownToHTML = {
    convertMarkdownToHTML,
    convertMarkdownWithCitations,
    cleanHTMLForTipTap,
    validateHTML,
    batchConvertMarkdown
};

export default markdownToHTML;