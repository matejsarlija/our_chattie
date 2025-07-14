const fs = require('fs');
const path = require('path');
const { AnalyzeDocumentsTool } = require('../court-analysis/agents/analysis-agent');
const AdmZip = require('adm-zip');

describe('AnalyzeDocumentsTool', () => {
    const testPdfPath = path.resolve(__dirname, 'test-analysis.pdf');
    const testDocxPath = path.resolve(__dirname, 'test-analysis.docx');
    const testTxtPath = path.resolve(__dirname, 'test-analysis.txt');
    const testText = 'Case number: 12345\nParties: Alice vs Bob\nDate: 2025-07-05\nSummary: This is a test case.';

    beforeAll(() => {
        // Create a simple PDF for testing
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument();
        doc.text(testText);
        doc.end();
        const stream = fs.createWriteStream(testPdfPath);
        doc.pipe(stream);
        // Create a simple DOCX for testing
        const { Document, Packer, Paragraph, TextRun } = require('docx');
        const docx = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        children: [
                            new TextRun(testText)
                        ]
                    })
                ]
            }]
        });
        return Promise.all([
            new Promise(resolve => stream.on('finish', resolve)),
            Packer.toBuffer(docx).then(buffer => fs.writeFileSync(testDocxPath, buffer)),
            fs.promises.writeFile(testTxtPath, testText)
        ]);
    });

    afterAll(() => {
        if (fs.existsSync(testPdfPath)) fs.unlinkSync(testPdfPath);
        if (fs.existsSync(testDocxPath)) fs.unlinkSync(testDocxPath);
        if (fs.existsSync(testTxtPath)) fs.unlinkSync(testTxtPath);
    });

    it('extracts text from a PDF and calls Gemini (mocked)', async () => {
        // Mock Gemini
        const tool = new AnalyzeDocumentsTool();
        tool._call = jest.fn(async ({ files }) => {
            return files.map(f => ({ ...f, aiResult: { summary: 'Mock summary', extracted: { caseNumber: '12345' } } }));
        });
        const files = [{ filePath: testPdfPath, url: 'mock', text: 'Test PDF' }];
        const result = await tool._call({ files });
        expect(result[0].aiResult).toHaveProperty('summary');
        expect(result[0].aiResult).toHaveProperty('extracted');
    });

    it('returns error for missing file', async () => {
        const tool = new AnalyzeDocumentsTool();
        const files = [{ filePath: 'nonexistent.pdf', url: 'mock', text: 'Missing PDF' }];
        const result = await tool._call({ files });
        expect(result[0].aiResult).toBeNull();
        expect(result[0].error).toMatch(/no such file|not found|ENOENT/i);
    });

    it('extracts text from a DOCX file', async () => {
        const tool = new AnalyzeDocumentsTool();
        const files = [{ filePath: testDocxPath, url: 'mock', text: 'Test DOCX' }];
        const result = await tool._call({ files });
        expect(result[0].aiResult).toBeDefined();
        expect(typeof result[0].aiResult).toBe('object');
    });

    it('extracts text from a TXT file', async () => {
        const tool = new AnalyzeDocumentsTool();
        const files = [{ filePath: testTxtPath, url: 'mock', text: 'Test TXT' }];
        const result = await tool._call({ files });
        expect(result[0].aiResult).toBeDefined();
        expect(typeof result[0].aiResult).toBe('object');
    });
});
