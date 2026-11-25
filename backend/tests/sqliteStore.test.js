const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { createSqliteStore } = require('../services/sqliteStore');

function makeDataDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-sqlite-'));
}
function removeDatabaseFiles(dataDir) {
    for (const name of ['analysis.db', 'analysis.db-shm', 'analysis.db-wal']) {
        fs.rmSync(path.join(dataDir, name), { force: true });
    }
}

describe('sqliteStore', () => {
    let dataDir;
    let store;

    beforeEach(() => {
        dataDir = makeDataDir();
        store = createSqliteStore({ dataDir });
    });

    afterEach(() => {
        store?.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('applies required connection pragmas and creates the complete schema', () => {
        expect(store.db.pragma('journal_mode', { simple: true })).toBe('wal');
        expect(store.db.pragma('synchronous', { simple: true })).toBe(1);
        expect(store.db.pragma('foreign_keys', { simple: true })).toBe(1);
        expect(store.db.pragma('busy_timeout', { simple: true })).toBe(5000);
        expect(store.db.pragma('temp_store', { simple: true })).toBe(2);
        expect(store.db.pragma('cache_size', { simple: true })).toBe(-64000);

        const tables = new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all().map((row) => row.name));
        for (const table of [
            'runs', 'run_artifacts', 'run_events', 'settings', 'ocr_transcripts', 'segment_checkpoints',
            'llm_traces', 'prompt_registry', 'bench_candidates', 'run_facts', 'run_chunks',
            'run_chunks_fts', 'registry_cache', 'model_pricing_cache', 'change_snapshots', 'change_diffs'
        ]) {
            expect(tables.has(table)).toBe(true);
        }
        for (const trigger of ['run_chunks_ai', 'run_chunks_ad', 'run_chunks_au']) {
            expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger)).toBeTruthy();
        }
    });

    test('imports legacy active settings and normalizes standard to balanced', () => {
        store.close();
        removeDatabaseFiles(dataDir);
        fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
            defaultScanDepth: 'standard',
            uiPreferences: { compact: true },
            reasoningPlanner: 'off'
        }));
        store = createSqliteStore({ dataDir });

        expect(store.getSettings()).toEqual({ defaultScanDepth: 'balanced', uiPreferences: { compact: true } });
        expect(store.db.prepare('SELECT COUNT(*) AS count FROM settings').get().count).toBe(2);
    });

    test('migrates existing runs, events and artifacts without discarding results', async () => {
        store.close();
        removeDatabaseFiles(dataDir);
        fs.writeFileSync(path.join(dataDir, 'runs.json'), JSON.stringify([{
            id: 'legacy-run', oib: '66124057408', query_type: 'oib', query_value: '66124057408',
            status: 'done', created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:01.000Z',
            result_text: 'Legacy report', result_json: { comparativeAnalysis: 'Legacy report' }, token_usage: { totalTokens: 10 }
        }]));
        fs.writeFileSync(path.join(dataDir, 'events.json'), JSON.stringify({
            'legacy-run': [{ id: 'legacy-event', event_type: 'complete', message: 'done', metadata: { progress: 100 }, created_at: '2025-01-01T00:00:01.000Z' }]
        }));
        store = createSqliteStore({ dataDir });

        expect(await store.getAnalysisRun({ id: 'legacy-run' })).toMatchObject({
            status: 'done', result_text: 'Legacy report', result_json: { comparativeAnalysis: 'Legacy report' }
        });
        expect(await store.getAnalysisEvents({ analysisId: 'legacy-run' })).toMatchObject([
            { id: 'legacy-event', seq: 1, event_type: 'complete', metadata: { progress: 100 } }
        ]);
    });

    test('deleting a run cascades through its artifacts, events, facts and chunks; FTS remains valid', async () => {
        const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
        await store.appendAnalysisEvent({ analysisId: run.id, eventType: 'starting', message: 'start', metadata: {} });
        await store.completeAnalysisRun({ analysisId: run.id, resultText: 'report', resultJson: { comparativeAnalysis: 'report' } });
        store.insertRunFacts({ runId: run.id, facts: [{ id: 'fact-1', kind: 'amount', description: 'claim', grounded: true }] });
        store.insertRunChunks({ runId: run.id, chunks: [{ chunkId: 'chunk-1', docId: 'doc-1', fileName: 'Podnesak.pdf', text: 'redni broj 98', normalizedText: 'redni broj 98' }] });

        expect(store.db.prepare("SELECT rowid FROM run_chunks_fts WHERE run_chunks_fts MATCH 'podnesak'").all()).toHaveLength(0);
        expect(store.db.prepare("SELECT rowid FROM run_chunks_fts WHERE run_chunks_fts MATCH '98'").all()).toHaveLength(1);
        store.db.prepare('DELETE FROM runs WHERE id = ?').run(run.id);

        for (const table of ['run_artifacts', 'run_events', 'run_facts', 'run_chunks']) {
            expect(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'run_artifacts' ? 'run_id' : 'run_id'} = ?`).get(run.id).count).toBe(0);
        }
        expect(store.db.prepare("SELECT rowid FROM run_chunks_fts WHERE run_chunks_fts MATCH '98'").all()).toHaveLength(0);
        expect(() => store.db.prepare("INSERT INTO run_chunks_fts(run_chunks_fts) VALUES('integrity-check')").run()).not.toThrow();
    });

    test('commits 1,000 events and 500 facts in one transaction under 100 ms', async () => {
        const run = await store.createAnalysisRun({ queryType: 'case_number', queryValue: 'ST-2/2013' });
        const events = Array.from({ length: 1000 }, (_, index) => ({
            id: `event-${index}`, eventType: 'progress', message: `event-${index}`, metadata: { progress: index % 100 }
        }));
        const facts = Array.from({ length: 500 }, (_, index) => ({
            id: `fact-${index}`, kind: 'amount', description: `claim-${index}`, valueEur: index,
            grounded: true, rawJson: { index }
        }));
        const started = performance.now();
        const result = await store.appendAnalysisEventsAndFacts({ analysisId: run.id, events, facts });
        const elapsedMs = performance.now() - started;

        expect(result).toEqual({ events: expect.any(Array), factsWritten: 500 });
        expect(result.events).toHaveLength(1000);
        expect(await store.getAnalysisEvents({ analysisId: run.id })).toHaveLength(1000);
        expect(store.db.prepare('SELECT COUNT(*) AS count FROM run_facts WHERE run_id = ?').get(run.id).count).toBe(500);
        expect(elapsedMs).toBeLessThan(100);
    });

    test('persists and retrieves page OCR cache entries in SQLite', () => {
        store.putOcrPage('document-hash', 3, 'cached page text');
        expect(store.getOcrPage('document-hash', 3)).toBe('cached page text');
        expect(store.getOcrPage('document-hash', 4)).toBeNull();
    });
});
