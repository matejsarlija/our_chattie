/**
 * Markdown Parser Utility
 * 
 * Detects and extracts ```markdown``` code blocks from AI responses.
 * Used to identify content that should be rendered as embedded TipTap editors.
 */

/**
 * Regex pattern to detect ```markdown``` code blocks
 * Matches: ```markdown\n[content]\n```
 * Captures the content inside the markdown fences
 */
const MARKDOWN_BLOCK_REGEX = /```markdown\n([\s\S]*?)\n```/g;

/**
 * Parse message text for markdown code blocks
 * 
 * @param {string} messageText - The message text to parse
 * @param {number} messageIndex - Index of the message for unique ID generation
 * @returns {Array} Array of detected markdown blocks with metadata
 */
export const parseMarkdownBlocks = (messageText, messageIndex = 0) => {
    const blocks = [];
    let match;
    let blockIndex = 0;

    // Reset regex state
    MARKDOWN_BLOCK_REGEX.lastIndex = 0;

    while ((match = MARKDOWN_BLOCK_REGEX.exec(messageText)) !== null) {
        const markdownContent = match[1];
        
        // Skip empty blocks
        if (!markdownContent) {
            continue;
        }

        blocks.push({
            id: `editor-${messageIndex}-${blockIndex}`,
            markdown: markdownContent,
            originalMarkdown: markdownContent,
            position: {
                start: match.index,
                end: match.index + match[0].length,
                contentStart: match.index + match[0].indexOf(match[1]),
                contentEnd: match.index + match[0].indexOf(match[1]) + match[1].length
            }
        });

        blockIndex++;
    }

    return blocks;
};

/**
 * Check if a message contains markdown blocks
 * 
 * @param {string} messageText - The message text to check
 * @returns {boolean} True if markdown blocks are detected
 */
export const hasMarkdownBlocks = (messageText) => {
    MARKDOWN_BLOCK_REGEX.lastIndex = 0;
    return MARKDOWN_BLOCK_REGEX.test(messageText);
};

/**
 * Count the number of markdown blocks in a message
 * 
 * @param {string} messageText - The message text to analyze
 * @returns {number} Number of markdown blocks found
 */
export const countMarkdownBlocks = (messageText) => {
    const blocks = parseMarkdownBlocks(messageText);
    return blocks.length;
};

/**
 * Extract markdown blocks and clean message text
 * 
 * @param {string} messageText - The message text to process
 * @param {number} messageIndex - Index of the message for unique ID generation
 * @returns {Object} Object with cleaned text and parsed blocks
 */
export const extractAndCleanMarkdown = (messageText, messageIndex = 0) => {
    const blocks = parseMarkdownBlocks(messageText, messageIndex);
    
    // Remove markdown code fences from the message text
    let cleanedText = messageText;
    blocks.forEach(block => {
        // Find the exact block and replace it with a marker
        const blockRegex = new RegExp(
            '```markdown\\n' + 
            block.originalMarkdown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 
            '\\n```',
            'g'
        );
        cleanedText = cleanedText.replace(blockRegex, '');
    });
    
    // Clean up extra whitespace
    cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();
    
    return {
        cleanedText,
        blocks,
        hasBlocks: blocks.length > 0
    };
};

/**
 * Validate markdown block content
 * 
 * @param {string} markdownContent - The markdown content to validate
 * @returns {Object} Validation result with isValid flag and any issues
 */
export const validateMarkdownBlock = (markdownContent) => {
    const issues = [];
    
    if (!markdownContent || markdownContent.trim().length === 0) {
        issues.push('Markdown block is empty');
    }
    
    // Check for potential issues
    if (markdownContent.length > 50000) {
        issues.push('Markdown block is very large (>50KB), may impact performance');
    }
    
    // Count lines for potential UI considerations
    const lineCount = markdownContent.split('\n').length;
    if (lineCount > 500) {
        issues.push('Markdown block has many lines (>500), may need scrollbars');
    }
    
    return {
        isValid: issues.length === 0,
        issues,
        size: markdownContent.length,
        lineCount
    };
};

const markdownParser = {
    parseMarkdownBlocks,
    hasMarkdownBlocks,
    countMarkdownBlocks,
    extractAndCleanMarkdown,
    validateMarkdownBlock,
    MARKDOWN_BLOCK_REGEX
};

export default markdownParser;