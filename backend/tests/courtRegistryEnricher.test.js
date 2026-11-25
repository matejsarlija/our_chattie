const fs = require('fs');
const os = require('os');
const path = require('path');

const mockSearchByOib = jest.fn();
const mockSearchCompany = jest.fn();
const mockGetCompanyDetails = jest.fn();
jest.mock('../court-registry/apiClient', () => ({
    searchByOib: (...args) => mockSearchByOib(...args),
    searchCompany: (...args) => mockSearchCompany(...args),
    getCompanyDetails: (...args) => mockGetCompanyDetails(...args),
}));

const { createSqliteStore } = require('../services/sqliteStore');
const { enrichParticipants, LOOKUP_CONCURRENCY, REGISTRY_CACHE_TTL_MS } = require('../court-registry/enricher');

describe('court registry enrichment cache', () => {
    let dataDir;
    let store;
    let previousClientId;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-cache-test-'));
        store = createSqliteStore({ dataDir });
        previousClientId = process.env.COURT_REGISTRY_CLIENT_ID;
        process.env.COURT_REGISTRY_CLIENT_ID = 'unit-test-client';
        mockSearchByOib.mockReset();
        mockSearchCompany.mockReset();
        mockGetCompanyDetails.mockReset();
    });

    afterEach(() => {
        store?.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
        if (previousClientId === undefined) delete process.env.COURT_REGISTRY_CLIENT_ID;
        else process.env.COURT_REGISTRY_CLIENT_ID = previousClientId;
    });

    test('caches 40 OIB lookups for 24 hours and limits concurrent HTTP lookups to three', async () => {
        let active = 0;
        let maxActive = 0;
        mockSearchByOib.mockImplementation(async (oib) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            active -= 1;
            return { oib, mbs: `MBS-${oib}`, tvtka: `Company ${oib}`, gfi: [{ godina_izvjestaja: 2024 }] };
        });
        mockSearchCompany.mockResolvedValue([]);
        mockGetCompanyDetails.mockResolvedValue(null);

        const participants = Array.from({ length: 40 }, (_, index) => ({
            name: `Company ${index} d.o.o.`,
            oib: String(10000000000 + index),
            role: 'Dužnik',
        }));
        const first = await enrichParticipants(participants, { store });
        const callsAfterFirst = mockSearchByOib.mock.calls.length;

        expect(callsAfterFirst).toBe(40);
        expect(first).toHaveLength(40);
        expect(maxActive).toBeLessThanOrEqual(LOOKUP_CONCURRENCY);
        expect(LOOKUP_CONCURRENCY).toBe(3);
        expect(REGISTRY_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
        const expiresAt = store.db.prepare('SELECT expires_at FROM registry_cache LIMIT 1').pluck().get();
        expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);

        const second = await enrichParticipants(participants, { store });
        expect(mockSearchByOib).toHaveBeenCalledTimes(callsAfterFirst);
        expect(mockSearchCompany).not.toHaveBeenCalled();
        expect(mockGetCompanyDetails).not.toHaveBeenCalled();
        expect(second.map((participant) => participant.enrichmentStatus)).toEqual(Array(40).fill('enriched'));
    });
});
