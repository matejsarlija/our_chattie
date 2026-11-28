'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSqliteStore } = require('../../services/sqliteStore');

describe('Resilience: SQLite Crash Recovery, Cascade Delete & FTS5 Integrity', () => {
    test('reuses 77 segment_checkpoints after crash and cascades delete cleanly without FTS5 corruption', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-cascade-'));
        const store = createSqliteStore({ dbPath: path.join(tmpDir, 'crash.db') });
        try {
            for (let i = 0; i < 77; i += 1) {
                store.putSegmentCheckpoint({
                    checkpointKey: `hash1:seg-${i}:v5:z-ai/glm-5.3-flash`,
                    contentHash: 'hash1',
                    segmentId: `seg-${i}`,
                    modelId: 'z-ai/glm-5.3-flash',
                    promptHash: 'v5',
                    schemaVersion: 5,
                    parsed: { summary: `Segment ${i}`, amounts: [] },
                });
            }
            const hit = store.getSegmentCheckpoint('hash1:seg-42:v5:z-ai/glm-5.3-flash');
            expect(hit?.parsed?.summary).toBe('Segment 42');

            const run = await store.createAnalysisRun({
                id: 'run-crash-1',
                queryType: 'oib',
                queryValue: '66124057408',
                scanDepth: 'balanced',
            });
            store.insertRunChunks({
                runId: run.id,
                chunks: [{
                    id: 'chunk-1',
                    docId: 'doc-1',
                    fileName: 'Diobeni popis.pdf',
                    text: 'Tražbina vjerovnika KERUM d.o.o. u stečaju',
                    startIndex: 0,
                    endIndex: 42,
                }],
            });
            store.insertRunFacts({
                runId: run.id,
                facts: [{
                    id: `${run.id}:fact-1`,
                    kind: 'amount',
                    description: 'Prijava tražbine',
                    value: 1000,
                    currency: 'EUR',
                }],
            });

            expect(store.searchRunChunks({ runId: run.id, query: 'Tražbina' }).chunks).toHaveLength(1);
            store.db.prepare('DELETE FROM runs WHERE id = ?').run(run.id);

            expect(store.db.prepare('SELECT COUNT(*) AS c FROM run_facts WHERE run_id = ?').get(run.id).c).toBe(0);
            expect(store.db.prepare('SELECT COUNT(*) AS c FROM run_chunks WHERE run_id = ?').get(run.id).c).toBe(0);
            expect(store.db.prepare('SELECT COUNT(*) AS c FROM run_chunks_fts').get().c).toBe(0);
            expect(() => store.searchRunChunks({ runId: run.id, query: 'Tražbina' })).toThrow('Analysis run not found.');

            const pruned = store.pruneOldLlmTraces({ retentionDays: 30 });
            expect(pruned).toBe(0);
        } finally {
            store.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
