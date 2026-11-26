'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteStore } = require('../services/sqliteStore');
const { createCreditExhaustedLatch } = require('../llm/creditLatch');
const {
    analyzeClusterDocuments,
    checkTotalVsPartsClosure,
} = require('../court-analysis/extraction/documentAnalyzer');

describe('documentAnalyzer Stage T0.5, checkpoints, bisection, closure & bench_candidates', () => {
    let tmpDir;
    let sqliteStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-analyzer-'));
        sqliteStore = createSqliteStore({ dataDir: path.join(tmpDir, 'db') });
    });

    afterEach(() => {
        sqliteStore?.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('checkTotalVsPartsClosure flags >5% divergence between total and line_item sums', () => {
        const gaps = checkTotalVsPartsClosure({
            amounts: [
                { description: 'Stavka 1', amount: 100, currency: 'EUR', amountRole: 'line_item' },
                { description: 'Stavka 2', amount: 200, currency: 'EUR', amountRole: 'line_item' },
                { description: 'UKUPNO', amount: 1000, currency: 'EUR', amountRole: 'total' },
            ],
        });
        expect(gaps).toHaveLength(1);
        expect(gaps[0].code).toBe('total-parts-mismatch');
    });

    test('uses Stage T0.5 adminFastPath at $0 and skips LLM invocation', async () => {
        const adminTxt = path.join(tmpDir, 'poziv.txt');
        fs.writeFileSync(
            adminTxt,
            'Poslovni broj: St-2/2013-901\nSplit, 14.03.2026.\nSud poziva stranke na ročište dana 01.04.2026. bez troškovnika.',
            'utf8',
        );
        const invokeTask = jest.fn();
        const result = await analyzeClusterDocuments({
            files: [{
                filePath: adminTxt,
                text: 'Poziv na ročište.txt',
                role: 'admin',
                sourceEntryIndex: 3,
                detailLink: 'https://e-oglasna.pravosudje.hr/objave/abc-123',
            }],
            caseInfo: { participants: [] },
            sqliteStore,
            taskRouter: { invokeTask },
        });

        expect(invokeTask).not.toHaveBeenCalled();
        expect(result.individualAnalyses[0].adminFastPath).toBe(true);
        expect(result.individualAnalyses[0].aiResult.caseNumber).toBe('St-2/2013-901');
        expect(result.sourceDocuments[0]).toMatchObject({
            adminFastPath: true,
            sourceEntryIndex: 3,
            entryDisplayId: 'abc-123',
        });
        expect(result.sourceDocuments[0].docId).toMatch(/^[a-f0-9]{64}$/);
    });

    test('injects Segment-1 parties into Segments 2..N, persists segment_checkpoints for $0 warm rerun, and harvests bench_candidates on closure mismatch', async () => {
        const bigTxt = path.join(tmpDir, 'diobeni.txt');
        const seg1Text = 'TRGOVAČKI SUD U SPLITU\nStranka: VJEROVNIK PRVI d.o.o., OIB: 12345678901\n';
        const seg2Padding = Array.from({ length: 160 }, (_, i) => `Redak ${i + 1}: Stavka diobe ${i + 1} EUR.`).join('\n');
        fs.writeFileSync(bigTxt, seg1Text + seg2Padding, 'utf8');

        const invokeTask = jest.fn(async (_taskType, messages) => {
            const promptText = String(messages);
            if (promptText.includes('(Segment 1/')) {
                return {
                    content: JSON.stringify({
                        caseNumber: 'St-2/2013',
                        decisionDate: '2026-04-01',
                        summary: 'Segment 1 sažetak.',
                        documentParties: [{
                            name: 'VJEROVNIK PRVI d.o.o.',
                            oib: '12345678901',
                            role: 'vjerovnik',
                            quote: 'VJEROVNIK PRVI d.o.o., OIB: 12345678901',
                        }],
                        amounts: [
                            { description: 'Stavka A', amount: 100, currency: 'EUR', amountRole: 'line_item', quote: 'Redak 1: Stavka diobe 1 EUR.' },
                            { description: 'Stavka B', amount: 200, currency: 'EUR', amountRole: 'line_item', quote: 'Redak 2: Stavka diobe 2 EUR.' },
                        ],
                    }),
                    usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
                    response_metadata: { finish_reason: 'stop', usageDetails: { cost_usd: 0.001 } },
                };
            }
            // Verify Segment-1 party roster was injected into Segment 2+ knownParties
            expect(promptText).toContain('VJEROVNIK PRVI d.o.o. (OIB: 12345678901');
            return {
                content: JSON.stringify({
                    summary: 'Segment 2 sažetak.',
                    amounts: [
                        { description: 'UKUPNO', amount: 900, currency: 'EUR', amountRole: 'total', quote: 'Redak 100: Stavka diobe 100 EUR.' },
                    ],
                }),
                usage_metadata: { input_tokens: 90, output_tokens: 40, total_tokens: 130 },
                response_metadata: { finish_reason: 'stop', usageDetails: { cost_usd: 0.001 } },
            };
        });

        const first = await analyzeClusterDocuments({
            files: [{ filePath: bigTxt, text: 'diobeni.txt', sourceEntryIndex: 0 }],
            caseInfo: { participants: [] },
            sqliteStore,
            taskRouter: { invokeTask },
        });
        const firstCalls = invokeTask.mock.calls.length;
        expect(firstCalls).toBeGreaterThanOrEqual(2);
        expect(first.individualAnalyses[0].aiResult._extractionGaps).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: 'total-parts-mismatch' })]),
        );

        const candidates = sqliteStore.listBenchCandidates();
        expect(candidates).toHaveLength(1);
        expect(candidates[0].triggerReasons).toContain('total-parts-mismatch');

        // Warm rerun hits SQLite segment_checkpoints at $0 (zero new invokeTask calls)
        const second = await analyzeClusterDocuments({
            files: [{ filePath: bigTxt, text: 'diobeni.txt', sourceEntryIndex: 0 }],
            caseInfo: { participants: [] },
            sqliteStore,
            taskRouter: { invokeTask },
        });
        expect(invokeTask).toHaveBeenCalledTimes(firstCalls);
        expect(second.individualAnalyses[0].fromCache).toBe(true);
    });

    test('handles HTTP 402 CreditExhaustedLatch gracefully while still serving cached AdminFastPath docs', async () => {
        const cachedDoc = path.join(tmpDir, 'admin.txt');
        const paidDoc = path.join(tmpDir, 'paid.txt');
        fs.writeFileSync(cachedDoc, 'Poslovni broj: St-2/2013-50\nObavijest o ročištu.');
        fs.writeFileSync(paidDoc, 'Stečajna upraviteljica traži naplatu 5.000,00 EUR za troškove postupka.');

        const run = await sqliteStore.createAnalysisRun({ queryType: 'oib', queryValue: '12345678901', scanDepth: 'balanced' });
        const creditLatch = createCreditExhaustedLatch({ runId: run.id, sqliteStore });
        const invokeTask = jest.fn(async () => {
            const err = Object.assign(new Error('Insufficient credits'), { status: 402 });
            creditLatch.guard(err);
            throw err;
        });

        const result = await analyzeClusterDocuments({
            files: [
                { filePath: paidDoc, text: 'paid.txt', role: 'ruling', sourceEntryIndex: 0 },
                { filePath: cachedDoc, text: 'admin.txt', role: 'admin', sourceEntryIndex: 1 },
            ],
            caseInfo: { participants: [] },
            runId: run.id,
            sqliteStore,
            creditLatch,
            taskRouter: { invokeTask },
        });

        expect(result.partialReason).toBe('provider-credits-exhausted');
        expect(result.coverage.analyzed).toBe(1);
        expect(result.coverage.failed).toBe(1);
        expect(result.coverage.failedFiles[0]).toMatchObject({
            fileName: 'paid.txt',
            reasonCode: 'provider-credits-exhausted',
        });
        const persistedRun = await sqliteStore.getAnalysisRun({ id: run.id });
        expect(persistedRun.partial_reason).toBe('provider-credits-exhausted');
        const promptRow = sqliteStore.db.prepare('SELECT prompt_name, schema_version FROM prompt_registry WHERE prompt_name = ?').get('extraction_v5');
        expect(promptRow).toEqual({ prompt_name: 'extraction_v5', schema_version: 5 });
    });
});
