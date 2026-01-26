/**
 * @jest-environment jsdom
 */

import { 
    convertMarkdownToHTML, 
    convertMarkdownWithCitations,
    cleanHTMLForTipTap,
    validateHTML,
    batchConvertMarkdown 
} from '../markdownToHTML';

// Mock document and DOM APIs
const mockDocument = {
    createElement: jest.fn(() => ({
        textContent: '',
        innerHTML: ''
    }))
};

Object.defineProperty(global, 'document', {
    value: mockDocument,
    writable: true
});

describe('markdownToHTML', () => {
    describe('convertMarkdownToHTML', () => {
        test('should convert basic markdown to HTML', () => {
            const markdown = '# Heading\n\nThis is **bold** and *italic* text.';
            const result = convertMarkdownToHTML(markdown);
            
            expect(result).toContain('<h1>Heading</h1>');
            expect(result).toContain('<strong>bold</strong>');
            expect(result).toContain('<em>italic</em>');
        });

        test('should handle lists', () => {
            const markdown = '- Item 1\n- Item 2\n- Item 3';
            const result = convertMarkdownToHTML(markdown);
            
            expect(result).toContain('<ul>');
            expect(result).toContain('<li>Item 1</li>');
            expect(result).toContain('<li>Item 2</li>');
            expect(result).toContain('<li>Item 3</li>');
            expect(result).toContain('</ul>');
        });

        test('should handle line breaks', () => {
            const markdown = 'Line 1\n\nLine 2';
            const result = convertMarkdownToHTML(markdown);
            
            expect(result).toContain('<p>Line 1</p>');
            expect(result).toContain('<p>Line 2</p>');
        });

        test('should return empty string for empty input', () => {
            const result = convertMarkdownToHTML('');
            
            expect(result).toBe('');
        });

        test('should return empty string for null/undefined', () => {
            expect(convertMarkdownToHTML(null)).toBe('');
            expect(convertMarkdownToHTML(undefined)).toBe('');
        });

        test('should return empty string for non-string input', () => {
            expect(convertMarkdownToHTML(123)).toBe('');
            expect(convertMarkdownToHTML({})).toBe('');
        });

        test('should handle links', () => {
            const markdown = '[Link text](https://example.com)';
            const result = convertMarkdownToHTML(markdown);
            
            expect(result).toContain('<a href="https://example.com"');
        });

        test('should sanitize HTML when sanitize option is true', () => {
            const markdown = '# Heading<script>alert("xss")</script>';
            const result = convertMarkdownToHTML(markdown, { sanitize: true });
            
            expect(result).not.toContain('<script>');
        });

        test('should handle custom options', () => {
            const markdown = 'Test content';
            const options = {
                breaks: false,
                linkTarget: '_self',
                allowedElements: ['p', 'strong']
            };
            
            expect(() => convertMarkdownToHTML(markdown, options)).not.toThrow();
        });
    });

    describe('convertMarkdownWithCitations', () => {
        test('should preserve citation tags', () => {
            const markdown = 'This is text with <citation label="Test" sourceId="1" /> citation.';
            const result = convertMarkdownWithCitations(markdown);
            
            expect(result).toContain('<citation label="Test" sourceId="1" />');
        });

        test('should convert markdown while preserving citations', () => {
            const markdown = '# Heading\n\nThis is **bold** with <citation label="Test" /> citation.';
            const result = convertMarkdownWithCitations(markdown);
            
            expect(result).toContain('<h1>Heading</h1>');
            expect(result).toContain('<strong>bold</strong>');
            expect(result).toContain('<citation label="Test" />');
        });

        test('should handle multiple citations', () => {
            const markdown = 'Text with <citation label="One" /> and <citation label="Two" /> citations.';
            const result = convertMarkdownWithCitations(markdown);
            
            expect(result).toContain('<citation label="One" />');
            expect(result).toContain('<citation label="Two" />');
        });

        test('should return empty string for empty input', () => {
            const result = convertMarkdownWithCitations('');
            
            expect(result).toBe('');
        });
    });

    describe('cleanHTMLForTipTap', () => {
        test('should return cleaned HTML', () => {
            const html = '<p>Test content</p>';
            const result = cleanHTMLForTipTap(html);
            
            expect(result).toBe(html);
        });

        test('should return empty string for empty input', () => {
            expect(cleanHTMLForTipTap('')).toBe('');
            expect(cleanHTMLForTipTap(null)).toBe('');
            expect(cleanHTMLForTipTap(undefined)).toBe('');
        });

        test('should return empty string for non-string input', () => {
            expect(cleanHTMLForTipTap(123)).toBe('');
            expect(cleanHTMLForTipTap({})).toBe('');
        });
    });

    describe('validateHTML', () => {
        test('should validate valid HTML', () => {
            const html = '<p>Valid content</p>';
            const result = validateHTML(html);
            
            expect(result.isValid).toBe(true);
            expect(result.issues).toHaveLength(0);
            expect(result.size).toBe(html.length);
        });

        test('should reject empty HTML', () => {
            const result = validateHTML('');
            
            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('HTML content is empty or invalid');
        });

        test('should reject null/undefined HTML', () => {
            expect(validateHTML(null).isValid).toBe(false);
            expect(validateHTML(undefined).isValid).toBe(false);
        });

        test('should detect script tags', () => {
            const html = '<p>Content<script>alert("xss")</script></p>';
            const result = validateHTML(html);
            
            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('HTML contains script tags - security risk');
        });

        test('should detect very large HTML', () => {
            const largeHtml = '<p>' + 'x'.repeat(100001) + '</p>';
            const result = validateHTML(largeHtml);
            
            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('HTML content is very large (>100KB), may impact performance');
        });

        test('should return size information', () => {
            const html = '<p>Content</p>';
            const result = validateHTML(html);
            
            expect(result.size).toBe(html.length);
        });
    });

    describe('batchConvertMarkdown', () => {
        test('should convert array of blocks', () => {
            const blocks = [
                { id: 'editor-1', markdown: '# Heading 1' },
                { id: 'editor-2', markdown: '**Bold text**' }
            ];
            const result = batchConvertMarkdown(blocks);
            
            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                id: 'editor-1',
                markdown: '# Heading 1'
            });
            expect(result[1]).toMatchObject({
                id: 'editor-2',
                markdown: '**Bold text**'
            });
            expect(result[0].html).toContain('<h1>Heading 1</h1>');
            expect(result[1].html).toContain('<strong>Bold text</strong>');
        });

        test('should handle empty blocks array', () => {
            const result = batchConvertMarkdown([]);
            
            expect(result).toHaveLength(0);
        });

        test('should handle non-array input', () => {
            const result = batchConvertMarkdown(null);
            
            expect(result).toHaveLength(0);
        });

        test('should handle blocks with missing markdown', () => {
            const blocks = [
                { id: 'editor-1' }, // missing markdown
                { id: 'editor-2', markdown: 'Content' }
            ];
            const result = batchConvertMarkdown(blocks);
            
            expect(result).toHaveLength(2);
            expect(result[0].html).toBe('');
            expect(result[1].html).toContain('Content');
        });

        test('should include validation status', () => {
            const blocks = [
                { id: 'editor-1', markdown: 'Valid content' },
                { id: 'editor-2', markdown: 'Also valid' }
            ];
            const result = batchConvertMarkdown(blocks);
            
            expect(result[0].isValid).toBe(true);
            expect(result[1].isValid).toBe(true);
        });
    });
});