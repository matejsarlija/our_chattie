'use strict';

const { AutoDiscoveryClient, CsvExportError } = require('../../scraper/discoveryClient');
const { stratifyClusterEntries } = require('../../court-analysis/utils/stratify');
const { SCAN_DEPTH_POLICIES } = require('../../court-analysis/utils/scanDepth');

describe('Resilience: Discovery Fallback & ScanDepth Policy', () => {
    test('truncated/schema-drift CSV falls back cleanly to Puppeteer adapter and feeds stratifyClusterEntries', async () => {
        const client = new AutoDiscoveryClient();
        client.csvClient = {
            searchAndGetLatestCasesWithDocuments: jest.fn(async () => {
                throw new CsvExportError('schema-drift', 'CSV truncated mid-line');
            }),
        };
        client.puppeteerClient = {
            init: jest.fn(async () => {}),
            close: jest.fn(async () => {}),
            searchAndGetLatestCasesWithDocuments: jest.fn(async () => [
                {
                    caseInfo: { caseNumber: 'ST-2/2013', date: '2025-02-10', title: 'Diobeni popis.pdf' },
                    documentLinks: [{ url: 'https://e-oglasna.pravosudje.hr/doc/1' }],
                },
                {
                    caseInfo: { caseNumber: 'ST-2/2013', date: '2024-01-15', title: 'Podnesak.pdf' },
                    documentLinks: [{ url: 'https://e-oglasna.pravosudje.hr/doc/2' }],
                },
            ]),
        };

        const results = await client.searchAndGetLatestCasesWithDocuments('66124057408', { queryType: 'oib' });
        expect(client.usingPuppeteer).toBe(true);
        expect(client.fallbackReason).toBe('schema-drift');
        expect(results).toHaveLength(2);

        const policy = SCAN_DEPTH_POLICIES.balanced;
        expect(policy.maxEntries).toBe(100);
        const stratified = stratifyClusterEntries(results, { budget: policy.maxEntries });
        expect(stratified.entries).toHaveLength(2);
    });

    test('full mode preserves full primary cluster without artificial cap', () => {
        const entries = Array.from({ length: 140 }, (_, i) => ({
            caseInfo: { caseNumber: 'ST-2/2013', date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`, title: `Objava ${i}` },
            documentLinks: [{ url: `https://example.test/doc/${i}` }],
        }));
        const policy = SCAN_DEPTH_POLICIES.full;
        expect(policy.allocation).toBe('all');
        const stratified = stratifyClusterEntries(entries, { budget: entries.length });
        expect(stratified.entries).toHaveLength(140);
    });
});
