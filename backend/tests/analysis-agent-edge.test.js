const { AnalyzeDocumentsTool } = require('../court-analysis/agents/analysis-agent');
const fs = require('fs');
const path = require('path');
jest.mock('pdf-parse', () => jest.fn(async () => ({ text: 'Mocked PDF text' })));

describe('AnalyzeDocumentsTool edge/error cases', () => {
    it('returns error for empty file list', async () => {
        const tool = new AnalyzeDocumentsTool();
        const result = await tool._call({ files: [] });
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    it('handles non-PDF file gracefully', async () => {
        // Create a dummy txt file
        const txtPath = path.resolve(__dirname, 'dummy.txt');
        fs.writeFileSync(txtPath, 'Just some text');
        const tool = new AnalyzeDocumentsTool();
        const files = [{ filePath: txtPath, url: 'mock', text: 'Dummy TXT' }];
        const result = await tool._call({ files });
        expect(result[0].aiResult).toBeDefined(); // Should not throw
        fs.unlinkSync(txtPath);
    });
});
