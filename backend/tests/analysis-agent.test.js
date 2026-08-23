const fs = require('fs');
const path = require('path');

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    invoke: mockGeminiInvoke,
  })),
}));

jest.mock('../helpers/geminiRetry', () => ({
  withGeminiRetry: (fn) => fn(),
  withGeminiTimeout: (fn) => fn(),
}));

jest.mock('../helpers/geminiUsage', () => ({
  trackGeminiInvoke: (_gemini, prompt, _opts) => mockGeminiInvoke(prompt),
}));

const mockGeminiInvoke = jest.fn();
const { AnalyzeDocumentsTool } = require('../court-analysis/agents/analysis-agent');

describe('AnalyzeDocumentsTool', () => {
    const testDocxPath = path.resolve(__dirname, 'test-analysis.docx');
    const testTxtPath = path.resolve(__dirname, 'test-analysis.txt');
    const testText = 'Case number: 12345\nParties: Alice vs Bob\nDate: 2025-07-05\nSummary: This is a test case.';

    beforeAll(() => {
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
            Packer.toBuffer(docx).then(buffer => fs.writeFileSync(testDocxPath, buffer)),
            fs.promises.writeFile(testTxtPath, testText)
        ]);
    });

    afterAll(() => {
        if (fs.existsSync(testDocxPath)) fs.unlinkSync(testDocxPath);
        if (fs.existsSync(testTxtPath)) fs.unlinkSync(testTxtPath);
    });

    beforeEach(() => {
        mockGeminiInvoke.mockReset();
        mockGeminiInvoke.mockResolvedValue({
            content: JSON.stringify({
                caseNumber: '12345',
                decisionDate: '2025-07-05',
                summary: 'Test summary.',
                amounts: [],
            }),
        });
    });

    it('extracts text from a DOCX file and calls Gemini', async () => {
        const tool = new AnalyzeDocumentsTool();
        const result = await tool._call({
            files: [{ filePath: testDocxPath, url: 'mock', text: 'Test DOCX' }],
            caseInfo: { participants: [] },
        });
        expect(result.individualAnalyses[0].aiResult).toBeDefined();
        expect(result.individualAnalyses[0].aiResult.summary).toBe('Test summary.');
        expect(mockGeminiInvoke).toHaveBeenCalledTimes(1);
    });

    it('extracts text from a TXT file and calls Gemini', async () => {
        const tool = new AnalyzeDocumentsTool();
        const result = await tool._call({
            files: [{ filePath: testTxtPath, url: 'mock', text: 'Test TXT' }],
            caseInfo: { participants: [] },
        });
        expect(result.individualAnalyses[0].aiResult).toBeDefined();
        expect(result.individualAnalyses[0].aiResult.summary).toBe('Test summary.');
        expect(mockGeminiInvoke).toHaveBeenCalledTimes(1);
    });

    it('returns error for missing file', async () => {
        const tool = new AnalyzeDocumentsTool();
        const result = await tool._call({
            files: [{ filePath: 'nonexistent.pdf', url: 'mock', text: 'Missing PDF' }],
            caseInfo: { participants: [] },
        });
        expect(result.individualAnalyses[0].aiResult).toBeNull();
        expect(result.individualAnalyses[0].error).toMatch(/Could not extract text|no such file|not found|ENOENT/i);
    });

    it('returns error for unsupported file type', async () => {
        const tool = new AnalyzeDocumentsTool();
        const result = await tool._call({
            files: [{ filePath: '/tmp/test.xyz', url: 'mock', text: 'Bad type' }],
            caseInfo: { participants: [] },
        });
        expect(result.individualAnalyses[0].aiResult).toBeNull();
        expect(result.individualAnalyses[0].error).toMatch(/Could not extract text|not found|ENOENT/i);
    });

    it('emits structured per-file events with live counts', async () => {
        const fileA = path.resolve(__dirname, 'live-a.txt');
        const fileB = path.resolve(__dirname, 'live-b.txt');
        fs.writeFileSync(fileA, 'Case A text');
        fs.writeFileSync(fileB, 'Case B text');
        try {
            const events = [];
            const tool = new AnalyzeDocumentsTool();
            const result = await tool._call({
                files: [
                    { filePath: fileA, url: 'mock', text: 'A.txt' },
                    { filePath: fileB, url: 'mock', text: 'B.txt' },
                ],
                caseInfo: { participants: [] },
                progressCallback: (event) => events.push(event),
            });

            expect(result.individualAnalyses).toHaveLength(2);

            const fileEvents = events.filter((event) => event.kind === 'file');
            expect(fileEvents).toHaveLength(2);
            expect(fileEvents.every((event) => event.step === 'analyzing')).toBe(true);
            expect(fileEvents[0].metadata.status).toBe('ok');
            expect(fileEvents[0].metadata.fileName).toBe('A.txt');
            expect(fileEvents[0].metadata.total).toBe(2);
            expect(fileEvents[0].metadata.done).toBe(1);
            expect(Number.isFinite(fileEvents[0].metadata.durationMs)).toBe(true);
            expect(fileEvents[1].metadata.done).toBe(2);
            expect(fileEvents[1].message).toContain('2/2');
        } finally {
            fs.unlinkSync(fileA);
            fs.unlinkSync(fileB);
        }
    });

    it('emits a failed file event carrying the extraction error reason', async () => {
        const events = [];
        const tool = new AnalyzeDocumentsTool();
        await tool._call({
            files: [{ filePath: 'nonexistent.pdf', url: 'mock', text: 'missing.pdf' }],
            caseInfo: { participants: [] },
            progressCallback: (event) => events.push(event),
        });

        const failedEvents = events.filter((event) => event.kind === 'file');
        expect(failedEvents).toHaveLength(1);
        expect(failedEvents[0].metadata.status).toBe('failed');
        expect(failedEvents[0].metadata.error).toContain('Could not extract text from file');
    });

    it('emits heartbeats with live counts while the batch is in flight', async () => {
        jest.useFakeTimers();
        try {
            // Hold only the FIRST invoke pending; later invokes resolve
            // immediately so the serial batch finishes deterministically once
            // the gate is released.
            const gateResolvers = [];
            let gateOpen = false;
            mockGeminiInvoke.mockImplementation(() => {
                if (gateOpen) {
                    return Promise.resolve({
                        content: JSON.stringify({ caseNumber: '1', decisionDate: 'd', summary: 's', amounts: [] }),
                    });
                }
                return new Promise((resolve) => gateResolvers.push(resolve));
            });

            const fileA = path.resolve(__dirname, 'hb-a.txt');
            const fileB = path.resolve(__dirname, 'hb-b.txt');
            fs.writeFileSync(fileA, 'Heartbeat A');
            fs.writeFileSync(fileB, 'Heartbeat B');

            const events = [];
            const tool = new AnalyzeDocumentsTool();
            const promise = tool._call({
                files: [
                    { filePath: fileA, url: 'mock', text: 'hb-a.txt' },
                    { filePath: fileB, url: 'mock', text: 'hb-b.txt' },
                ],
                caseInfo: { participants: [] },
                progressCallback: (event) => events.push(event),
            });

            // Let the first worker reach its pending Gemini invoke.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            jest.advanceTimersByTime(45000);
            jest.advanceTimersByTime(45000);

            const heartbeats = events.filter((event) => event.kind === 'heartbeat');
            expect(heartbeats.length).toBeGreaterThanOrEqual(2);
            expect(heartbeats[0].metadata.total).toBe(2);
            expect(heartbeats[0].metadata.currentFile).toBeTruthy();

            // Release the gate; the remaining files resolve immediately.
            gateOpen = true;
            gateResolvers.forEach((resolve) => resolve({
                content: JSON.stringify({ caseNumber: '1', decisionDate: 'd', summary: 's', amounts: [] }),
            }));
            const result = await promise;

            expect(result.individualAnalyses).toHaveLength(2);
            expect(events.filter((event) => event.kind === 'file')).toHaveLength(2);
            fs.unlinkSync(fileA);
            fs.unlinkSync(fileB);
        } finally {
            jest.useRealTimers();
        }
    });
});
