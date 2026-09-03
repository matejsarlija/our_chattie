const path = require('path');
const fs = require('fs');
const { CsvExportClient, CsvExportError } = require('../scraper/csvExportClient');
const { createDiscoveryClient, resolveDiscoverySource, AutoDiscoveryClient } = require('../scraper/discoveryClient');
const { friendlyAnalysisErrorMessage } = require('../helpers/friendlyAnalysisError');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'csv-export');

const mockPuppeteerSearch = jest.fn();
jest.mock('../scraper/courtSearchPuppeteer', () => {
    return jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        searchAndGetLatestCases: mockPuppeteerSearch,
        searchAndGetLatestCasesWithDocuments: mockPuppeteerSearch,
    }));
});

function fixtureText(name) {
    return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

describe('resolveDiscoverySource', () => {
    const originalEnv = process.env.DISCOVERY_SOURCE;

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.DISCOVERY_SOURCE;
        else process.env.DISCOVERY_SOURCE = originalEnv;
    });

    test('defaults to auto', () => {
        delete process.env.DISCOVERY_SOURCE;
        expect(resolveDiscoverySource()).toBe('auto');
    });

    test('honors an explicit option', () => {
        expect(resolveDiscoverySource({ discoverySource: 'csv' })).toBe('csv');
        expect(resolveDiscoverySource({ discoverySource: 'puppeteer' })).toBe('puppeteer');
    });

    test('honors the env var', () => {
        process.env.DISCOVERY_SOURCE = 'puppeteer';
        expect(resolveDiscoverySource()).toBe('puppeteer');
    });

    test('ignores unknown values and falls back to auto', () => {
        process.env.DISCOVERY_SOURCE = 'garbage';
        expect(resolveDiscoverySource()).toBe('auto');
    });
});

describe('createDiscoveryClient', () => {
    test('returns a CsvExportClient for csv source', () => {
        expect(createDiscoveryClient({ discoverySource: 'csv' })).toBeInstanceOf(CsvExportClient);
    });

    test('returns an AutoDiscoveryClient for auto source', () => {
        expect(createDiscoveryClient({ discoverySource: 'auto' })).toBeInstanceOf(AutoDiscoveryClient);
    });
});

describe('AutoDiscoveryClient', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('uses the CSV path when the export succeeds (no fallback)', async () => {
        const client = new AutoDiscoveryClient({ csv: { fetcher: async () => fixtureText('oib-66124057408.csv') } });
        const result = await client.searchAndGetLatestCasesWithDocuments('66124057408', null, null, false);

        expect(result.discoveryMetadata.discoveryMode).toBe('csv-export');
        expect(result.discoveryMetadata.totalResults).toBe(381);
        expect(client.usingPuppeteer).toBe(false);
        expect(mockPuppeteerSearch).not.toHaveBeenCalled();
    });

    test('falls back to Puppeteer on a CSV schema-drift failure and annotates metadata', async () => {
        mockPuppeteerSearch.mockResolvedValue({
            casesToProcess: [],
            discoveryMetadata: { discoveryMode: 'search-window', totalResults: 0 }
        });

        const client = new AutoDiscoveryClient({ csv: { fetcher: async () => '<html>error</html>' } });
        const result = await client.searchAndGetLatestCasesWithDocuments('66124057408', null, null, false);

        expect(client.usingPuppeteer).toBe(true);
        expect(client.fallbackReason).toBe('schema-drift');
        expect(mockPuppeteerSearch).toHaveBeenCalled();
        expect(result.discoveryMetadata.discoveryMode).toBe('search-window');
        expect(result.discoveryMetadata.csvFallback).toEqual({ reason: 'schema-drift', missingColumns: expect.any(Array) });
    });

    test('falls back to Puppeteer on a network failure', async () => {
        mockPuppeteerSearch.mockResolvedValue({
            casesToProcess: [],
            discoveryMetadata: { discoveryMode: 'search-window', totalResults: 0 }
        });

        const client = new AutoDiscoveryClient({ csv: { fetcher: async () => { throw new Error('getaddrinfo ENOTFOUND'); } } });
        await client.searchAndGetLatestCases('66124057408');

        expect(client.usingPuppeteer).toBe(true);
        expect(client.fallbackReason).toBe('network');
    });

    test('forwards the OIB identity hint to whichever client ends up active', async () => {
        mockPuppeteerSearch.mockResolvedValue({
            casesToProcess: [],
            discoveryMetadata: { discoveryMode: 'search-window', totalResults: 0 }
        });

        const client = new AutoDiscoveryClient({ csv: { fetcher: async () => { throw new Error('getaddrinfo ENOTFOUND'); } } });
        await client.searchAndGetLatestCasesWithDocuments('66124057408', 40, 3, true, '66124057408');

        expect(mockPuppeteerSearch).toHaveBeenCalledWith('66124057408', 40, 3, true, '66124057408');
    });

    test('does not expose cluster-expansion when CSV succeeded (no puppeteer)', async () => {
        const client = new AutoDiscoveryClient({ csv: { fetcher: async () => fixtureText('oib-66124057408.csv') } });
        const followUp = await client.searchCaseNumberFollowUp('St-2/2013', { pass: 1 });
        expect(followUp.entries).toEqual([]);
    });
});

describe('friendlyAnalysisErrorMessage for CSV export failures', () => {
    test('maps schema-drift to a Croatian availability message', () => {
        const err = new CsvExportError('schema-drift', 'CSV export parse failed', { missingColumns: ['OIB stečajnog dužnika'] });
        const message = friendlyAnalysisErrorMessage(err, { stage: 'discovering' });
        expect(message).toContain('faze pronalaženja objava');
        expect(message).toContain('Izvoz podataka e-Oglasne ploče');
    });

    test('maps network failures to a Croatian network message', () => {
        const err = new CsvExportError('network', 'CSV export fetch failed', null);
        const message = friendlyAnalysisErrorMessage(err, { stage: 'discovering' });
        expect(message).toContain('mrežne greške');
    });
});
