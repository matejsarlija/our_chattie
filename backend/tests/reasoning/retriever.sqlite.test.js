const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteStore } = require('../../services/sqliteStore');
const { retrieveEvidence } = require('../../court-analysis/reasoning/retrieval/retriever');

describe('SQLite-backed ledger retrieval', () => {
  let dataDir;
  let analysisStore;
  let run;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-retrieval-'));
    analysisStore = createSqliteStore({ dataDir });
    run = await analysisStore.createAnalysisRun({ queryType: 'oib', queryValue: '66124057408' });
    analysisStore.insertRunChunks({ runId: run.id, chunks: [
      {
        chunkId: 'chunk-ledger', docId: 'doc-ledger', fileName: 'Prijava.pdf', caseNumber: 'St-2/2013',
        pageNumbers: [7], startIndex: 100, endIndex: 180,
        text: 'OIB 66124057408; redni broj 98; prijava tražbine St-2/2013-1155.',
        normalizedText: 'oib 66124057408 redni broj 98 prijava trazbine st 2 2013 1155',
      },
      {
        chunkId: 'chunk-unrelated', docId: 'doc-other', fileName: 'Zapisnik.pdf', caseNumber: 'St-2/2013',
        pageNumbers: [1], startIndex: 0, endIndex: 40,
        text: 'Zapisnik o održanom ročištu.', normalizedText: 'zapisnik o odrzanom rocistu',
      },
    ] });
  });

  afterEach(() => {
    analysisStore?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('creates deterministic ledger identifier queries and ranks persisted chunks with BM25 anchors', () => {
    const pkg = {
      clusterId: 'St-2/2013',
      query: { type: 'oib', value: '66124057408' },
      identity: { participantOibs: ['66124057408'], participantNames: ['KERUM d.o.o.'] },
      entries: [],
      documentLinks: [],
      chunks: [],
      analyses: [],
      factLedger: [{
        claimRegistryNumber: '98',
        filingReference: 'St-2/2013-1155',
        parties: { payerOib: '66124057408', payerName: 'KERUM d.o.o.' },
      }],
      reconciliation: { conflicts: [], openQuestions: [{ text: 'Provjeriti redni broj 98.' }] },
    };

    const result = retrieveEvidence(pkg, { analysisStore, runId: run.id });
    const filingQuery = result.results.find(({ query }) => query.id === 'ledger-filings');
    const partyQuery = result.results.find(({ query }) => query.id === 'ledger-parties');
    const conflictQuery = result.results.find(({ query }) => query.id === 'ledger-conflicts');

    expect(result.queries.map(({ id }) => id)).toEqual([
      'timeline', 'amounts', 'procedural-status', 'party-roles', 'property-flow',
      'ledger-parties', 'ledger-filings', 'ledger-conflicts',
    ]);
    expect(filingQuery.matches[0]).toMatchObject({
      sourceId: 'chunk-ledger',
      rank: expect.any(Number),
      metadata: { sourceType: 'chunk', pageNumbers: [7], fileName: 'Prijava.pdf' },
    });
    expect(filingQuery.matches[0].reasons).toContain('fts5-bm25');
    expect(filingQuery.matches[0].reasons).toContain('anchor:St-2/2013-1155');
    expect(partyQuery.matches[0].reasons).toContain('anchor:66124057408');
    expect(conflictQuery.query.text).toContain('Provjeriti redni broj 98.');
  });
});
