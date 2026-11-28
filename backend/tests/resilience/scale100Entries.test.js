'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSqliteStore } = require('../../services/sqliteStore');

describe('Resilience: 100-Entry SQLite & FTS5 Scale Benchmarks', () => {
    test('batch-inserts 100 docs / 500 facts and executes FTS5 query under 25 ms', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-100-'));
        const store = createSqliteStore({ dbPath: path.join(tmpDir, 'scale.db') });
        try {
            const run = await store.createAnalysisRun({
                id: 'run-scale-100',
                queryType: 'oib',
                queryValue: '66124057408',
                scanDepth: 'balanced',
            });

            const insertStart = performance.now();
            const chunks = Array.from({ length: 100 }, (_, i) => ({
                id: `chunk-${i}`,
                docId: `doc-${i}`,
                fileName: `Objava-${i}.pdf`,
                text: `Stečajni postupak St-2/2013 objava ${i} vjerovnik tražbina ${i * 100} EUR`,
                startIndex: 0,
                endIndex: 72,
            }));
            const facts = Array.from({ length: 500 }, (_, i) => ({
                id: `${run.id}:fact-${i}`,
                kind: 'amount',
                description: `Stavka ${i}`,
                value: 100 + i,
                currency: 'EUR',
            }));
            store.insertRunChunks({ runId: run.id, chunks });
            store.insertRunFacts({ runId: run.id, facts });
            const insertElapsedMs = performance.now() - insertStart;
            expect(insertElapsedMs).toBeLessThan(500);

            const queryStart = performance.now();
            const matches = store.searchRunChunks({ runId: run.id, query: 'vjerovnik' });
            const queryElapsedMs = performance.now() - queryStart;
            expect(matches.chunks.length).toBeGreaterThan(0);
            expect(queryElapsedMs).toBeLessThan(25);
        } finally {
            store.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
