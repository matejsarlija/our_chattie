/**
 * @jest-environment jsdom
 */

import { 
    parseMarkdownBlocks, 
    hasMarkdownBlocks, 
    countMarkdownBlocks,
    extractAndCleanMarkdown,
    validateMarkdownBlock 
} from '../markdownParser';

describe('markdownParser', () => {
    describe('parseMarkdownBlocks', () => {
        test('should parse single markdown block', () => {
            const text = 'Here is your draft:\n```markdown\nSubject: Request\n\nBody content\n```\nHope this helps!';
            const result = parseMarkdownBlocks(text, 0);
            
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                id: 'editor-0-0',
                markdown: 'Subject: Request\n\nBody content',
                originalMarkdown: 'Subject: Request\n\nBody content'
            });
            expect(result[0].position).toBeDefined();
        });

        test('should parse multiple markdown blocks', () => {
            const text = 'First block:\n```markdown\nBlock 1\n```\nSecond block:\n```markdown\nBlock 2\n```';
            const result = parseMarkdownBlocks(text, 1);
            
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('editor-1-0');
            expect(result[1].id).toBe('editor-1-1');
            expect(result[0].markdown).toBe('Block 1');
            expect(result[1].markdown).toBe('Block 2');
        });

        test('should handle nested code blocks correctly', () => {
            const text = '```markdown\n```code\n```\n```';
            const result = parseMarkdownBlocks(text, 0);
            
            expect(result).toHaveLength(1);
            expect(result[0].markdown).toBe('```code');
        });

        test('should skip empty markdown blocks', () => {
            const text = '```markdown\n\n```';
            const result = parseMarkdownBlocks(text, 0);
            
            expect(result).toHaveLength(0);
        });

        test('should return empty array for no blocks', () => {
            const text = 'Just regular text without any markdown blocks';
            const result = parseMarkdownBlocks(text, 0);
            
            expect(result).toHaveLength(0);
        });

        test('should handle messageIndex parameter correctly', () => {
            const text = '```markdown\nContent\n```';
            const result = parseMarkdownBlocks(text, 5);
            
            expect(result[0].id).toBe('editor-5-0');
        });

        test('should trim whitespace from markdown content', () => {
            const text = '```markdown\n  \n  Content with spaces  \n  \n```';
            const result = parseMarkdownBlocks(text, 0);
            
            expect(result[0].markdown).toBe('  \n  Content with spaces  \n  ');
        });
    });

    describe('hasMarkdownBlocks', () => {
        test('should return true for text with markdown blocks', () => {
            const text = '```markdown\nContent\n```';
            const result = hasMarkdownBlocks(text);
            
            expect(result).toBe(true);
        });

        test('should return false for text without markdown blocks', () => {
            const text = 'Just regular text';
            const result = hasMarkdownBlocks(text);
            
            expect(result).toBe(false);
        });

        test('should return false for empty string', () => {
            const result = hasMarkdownBlocks('');
            
            expect(result).toBe(false);
        });

        test('should return false for null/undefined', () => {
            expect(hasMarkdownBlocks(null)).toBe(false);
            expect(hasMarkdownBlocks(undefined)).toBe(false);
        });
    });

    describe('countMarkdownBlocks', () => {
        test('should count single block', () => {
            const text = '```markdown\nContent\n```';
            const result = countMarkdownBlocks(text);
            
            expect(result).toBe(1);
        });

        test('should count multiple blocks', () => {
            const text = '```markdown\nBlock 1\n```\n```markdown\nBlock 2\n```';
            const result = countMarkdownBlocks(text);
            
            expect(result).toBe(2);
        });

        test('should return 0 for no blocks', () => {
            const text = 'No markdown blocks here';
            const result = countMarkdownBlocks(text);
            
            expect(result).toBe(0);
        });
    });

    describe('extractAndCleanMarkdown', () => {
        test('should extract blocks and clean text', () => {
            const text = 'Here is your draft:\n```markdown\nSubject: Request\n\nBody content\n```\nHope this helps!';
            const result = extractAndCleanMarkdown(text, 0);
            
            expect(result.hasBlocks).toBe(true);
            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0].markdown).toBe('Subject: Request\n\nBody content');
            expect(result.cleanedText).toBe('Here is your draft:\n\nHope this helps!');
        });

        test('should handle multiple blocks', () => {
            const text = '```markdown\nBlock 1\n```\nMiddle text\n```markdown\nBlock 2\n```';
            const result = extractAndCleanMarkdown(text, 0);
            
            expect(result.hasBlocks).toBe(true);
            expect(result.blocks).toHaveLength(2);
            expect(result.cleanedText).toBe('Middle text');
        });

        test('should return hasBlocks: false for no blocks', () => {
            const text = 'Just regular text';
            const result = extractAndCleanMarkdown(text, 0);
            
            expect(result.hasBlocks).toBe(false);
            expect(result.blocks).toHaveLength(0);
            expect(result.cleanedText).toBe('Just regular text');
        });

        test('should clean up extra whitespace', () => {
            const text = '```markdown\nBlock\n```\n\n\n\nExtra newlines';
            const result = extractAndCleanMarkdown(text, 0);
            
            expect(result.cleanedText).toBe('Extra newlines');
        });
    });

    describe('validateMarkdownBlock', () => {
        test('should validate empty block', () => {
            const result = validateMarkdownBlock('');
            
            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('Markdown block is empty');
        });

        test('should validate very large block', () => {
            const largeContent = 'x'.repeat(50001);
            const result = validateMarkdownBlock(largeContent);
            
            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('Markdown block is very large (>50KB), may impact performance');
        });

        test('should validate block with many lines', () => {
            const manyLines = Array(501).fill('line').join('\n');
            const result = validateMarkdownBlock(manyLines);
            
            expect(result.isValid).toBe(false);
            expect(result.issues).toContain('Markdown block has many lines (>500), may need scrollbars');
        });

        test('should validate valid block', () => {
            const validContent = 'Subject: Request\n\nThis is a valid content.';
            const result = validateMarkdownBlock(validContent);
            
            expect(result.isValid).toBe(true);
            expect(result.issues).toHaveLength(0);
            expect(result.size).toBe(validContent.length);
            expect(result.lineCount).toBe(3);
        });

        test('should return size and line count', () => {
            const content = 'Line 1\nLine 2\nLine 3';
            const result = validateMarkdownBlock(content);
            
            expect(result.size).toBe(content.length);
            expect(result.lineCount).toBe(3);
        });
    });
});