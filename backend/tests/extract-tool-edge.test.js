const { ExtractArchiveTool } = require('../court-analysis/agents/extract-tool');
const fs = require('fs');
const path = require('path');

describe('ExtractArchiveTool edge/error cases', () => {
    it('returns error for unsupported file type', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: __filename, destination: __dirname });
        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/Extraction failed/i);
    });

    it('returns error for missing destination', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: 'nonexistent.zip', destination: '' });
        expect(result.status).toBe('error');
    });
});
