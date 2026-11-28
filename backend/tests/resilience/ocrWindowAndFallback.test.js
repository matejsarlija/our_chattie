'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSqliteStore } = require('../../services/sqliteStore');
const { selectOcrPages } = require('../../court-analysis/extraction/ocrRouter');

describe('Resilience: Stage T OCR 15p/60p Windows & llm_traces', () => {
    test('selectOcrPages caps 80-page scan to 40p head + 20p tail with explicit skipped range', () => {
        const allPages = Array.from({ length: 80 }, (_, i) => i + 1);
        const plan = selectOcrPages(allPages, 60);
        expect(plan.selectedPages).toHaveLength(60);
        expect(plan.selectedPages[0]).toBe(1);
        expect(plan.selectedPages[39]).toBe(40);
        expect(plan.selectedPages[40]).toBe(61);
        expect(plan.selectedPages[59]).toBe(80);
        expect(plan.skippedPageRanges).toEqual([{ from: 41, to: 60 }]);
    });

    test('ocrRouter wires traceStore, runId, docHash, and TranscribePage into OpenRouter calls', async () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../court-analysis/extraction/ocrRouter.js'),
            'utf8',
        );
        expect(src).toContain("taskType: 'TranscribePage'");
        expect(src).toContain('traceStore: sqliteStore');
        expect(src).toContain('docHash: contentHash');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-trace-'));
        const store = createSqliteStore({ dbPath: path.join(tmpDir, 'trace.db') });
        try {
            const run = await store.createAnalysisRun({
                id: 'run-ocr-trace',
                queryType: 'oib',
                queryValue: '66124057408',
                scanDepth: 'balanced',
            });
            const traceId = store.insertLlmTrace({
                runId: run.id,
                taskType: 'TranscribePage',
                docHash: 'abc123',
                promptHash: 'ocr-v1',
                requestedModel: 'or-mistral-ocr',
                actualModel: 'or-mistral-ocr',
                latencyMs: 320,
                costUsd: 0.001,
            });
            expect(traceId).toBeTruthy();
            const rows = store.db.prepare('SELECT * FROM llm_traces WHERE id = ?').all(traceId);
            expect(rows).toHaveLength(1);
            expect(rows[0].task_type).toBe('TranscribePage');
        } finally {
            store.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
