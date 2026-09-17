/**
 * L-03 — golden extraction regression tests against real case documents.
 *
 * Fixtures: backend/tests/fixtures/real-documents/66124057408/entries/
 * 10-ST-22013/ — ground truth verified by reading the PDFs:
 * - Prilog St-2_2013-1196-1: OIBs 79478632402 (tužitelj CRO-GO) /
 *   66124057408 (tuženik Kerum u stečaju), "tražbina drugog višeg isplatnog
 *   reda u iznosu od 177.218,01 kn (pod rednim brojem 106)".
 * - Troškovnik.pdf: dual "248,86 € (1.875 ,oo kn)", netting arithmetic
 *   "63,38 € (248,86 - 185,48 €) kao obvezu stečajne mase", OIBs
 *   79478632402 / 77498607505 / 66124057408.
 *
 * No live model calls: part 1 asserts the source patterns exist in the
 * extracted fixture text (guards fixture drift); part 2 runs hand-built raw
 * items mirroring that content through the deterministic pipeline
 * (collect → consolidate → reconcile) and asserts the end-to-end shape.
 */
jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({ invoke: jest.fn() })),
}));

jest.mock('../../helpers/geminiRetry', () => ({
    withGeminiRetry: (fn) => fn(),
    withGeminiTimeout: (fn) => fn(),
}));

jest.mock('../../helpers/geminiUsage', () => ({
    trackGeminiInvoke: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const { collectMoneyFlows } = require('../../court-analysis/reasoning/moneyFlow');
const { collectPropertyFlows, reconcilePropertyFlows } = require('../../court-analysis/reasoning/propertyFlow');
const { hrkToEur } = require('../../court-analysis/reasoning/currencyConversion');
const { buildCitationGraph } = require('../../court-analysis/reasoning/citationGraph');

const ENTRY_DIR = path.resolve(
    __dirname,
    '../fixtures/real-documents/66124057408/entries/10-ST-22013'
);
const EXTRACTED_DIR = path.resolve(
    __dirname,
    '../fixtures/real-documents/66124057408/extracted'
);
const PRILOG = path.join(ENTRY_DIR, 'Prilog St-2_2013-1196-1 - CroGo-Kerum_I°-2.pdf');
const TROSKOVNIK = path.join(ENTRY_DIR, 'Troškovnik.pdf');

describe('L-03 Kerum golden fixtures: source patterns', () => {
    test('Prilog states both OIBs, redni broj 106 and the isplatni red', () => {
        // Frozen production extraction (see extracted/README.md) — the unit
        // lane asserts on frozen text because real pdfjs cannot run in Jest.
        expect(fs.existsSync(PRILOG)).toBe(true);
        const text = fs.readFileSync(path.join(EXTRACTED_DIR, 'prilog-1196-1.txt'), 'utf8');
        expect(text).toContain('79478632402');
        expect(text).toContain('66124057408');
        expect(text).toMatch(/pod rednim brojem 106/);
        expect(text).toMatch(/drugog vi[šs]eg isplatnog reda/);
        expect(text).toMatch(/177\.218,01/);
    });

    test('Troškovnik states the dual-currency amount and the netting arithmetic', () => {
        expect(fs.existsSync(TROSKOVNIK)).toBe(true);
        const text = fs.readFileSync(path.join(EXTRACTED_DIR, 'troskovnik.txt'), 'utf8');
        expect(text).toMatch(/248,86/);
        expect(text).toMatch(/1\.875/);
        expect(text).toMatch(/63,38/);
        // Explicit netting operation (spaced-out by PDF extraction).
        expect(text).toMatch(/pri\s*jeboj/);
        expect(text).toMatch(/ste[čc]ajne mase/);
        // Second dual figure in the same filing.
        expect(text).toMatch(/185,48/);
        expect(text).toMatch(/1\.397,50/);
        expect(text).toContain('66124057408');
    });
});

describe('L-03 Kerum golden fixtures: deterministic pipeline shape', () => {
    // Raw items as the J-era prompt SHOULD produce for the two documents.
    const prilogAnalysis = {
        id: 'a-prilog',
        fileName: 'Prilog St-2_2013-1196-1 - CroGo-Kerum_I°-2.pdf',
        caseNumber: 'St-2/2013',
        amounts: [{
            description: 'Tražbina tužitelja kao vjerovnika drugog višeg isplatnog reda',
            amount: '177.218,01',
            currency: 'HRK',
            direction: 'potraživanje',
            payerName: 'Kerum d.o.o. u stečaju',
            payerOib: '66124057408',
            recipientName: 'CRO-GO d.o.o.',
            recipientOib: '79478632402',
            isplatniRed: 'drugi viši isplatni red',
            claimRegistryNumber: '106',
            filingReference: 'St-2/2013-1196-1',
            quote: 'tražbina drugog višeg isplatnog reda u iznosu od 177.218,01 kn (pod rednim brojem 106)',
        }],
        propertyFlow: [{
            description: 'Tražbina CRO-GO d.o.o. prema dužniku Kerum d.o.o.',
            assetType: 'tražbina',
            eventType: 'prijava',
            value: '177.218,01',
            currency: 'HRK',
            date: '2022-05-11',
            isplatniRed: 'drugi viši isplatni red',
            claimRegistryNumber: '106',
            filingReference: 'St-2/2013-1196-1',
            quote: 'tražbina drugog višeg isplatnog reda u iznosu od 177.218,01 kn (pod rednim brojem 106)',
        }],
        citedFilingReferences: ['St-2/2013-634'],
    };
    const troskovnikAnalysis = {
        id: 'a-troskovnik',
        fileName: 'Troškovnik.pdf',
        caseNumber: 'St-2/2013',
        amounts: [
            {
                description: 'Parnični trošak CRO-GO d.o.o.',
                amount: '248,86',
                currency: 'EUR',
                direction: 'potraživanje',
                quote: 'parnični trošak u iznosu od 248,86 € (1.875 ,oo kn)',
            },
            {
                description: 'Trošak žalbenog postupka kao obveza stečajne mase',
                amount: '63,38',
                currency: 'EUR',
                direction: 'obveza',
                quote: 'potražuje iznos od 63,38 € (248,86 - 185,48 €) kao obvezu stečajne mase',
            },
        ],
        propertyFlow: [{
            description: 'Tražbina CRO-GO d.o.o. prema dužniku Kerum d.o.o.',
            assetType: 'tražbina',
            eventType: 'namirenje',
            value: 248.86,
            currency: 'EUR',
            date: '2026-05-26',
            claimRegistryNumber: '106',
            filingReference: 'St-2/2013-1214',
            quote: 'parnični trošak u iznosu od 248,86 € (1.875 ,oo kn)',
        }],
        citedFilingReferences: ['St-2/2013-1196-1'],
    };

    test('Prilog amount consolidates HRK→EUR and keeps every J identifier', () => {
        const flow = collectMoneyFlows([prilogAnalysis]);
        expect(flow.entries[0]).toEqual(expect.objectContaining({
            amount: 177218.01,
            currency: 'HRK',
            amountEur: hrkToEur(177218.01),
            amountEurSource: 'converted',
            direction: 'potraživanje',
            payerOib: '66124057408',
            recipientOib: '79478632402',
            isplatniRed: 'drugi viši isplatni red',
            claimRegistryNumber: '106',
            filingReference: 'St-2/2013-1196-1',
            from: 'Kerum d.o.o. u stečaju',
            to: 'CRO-GO d.o.o.',
        }));
    });

    test('Troškovnik dual prefers the stated EUR figure (space-variant spelling)', () => {
        const flow = collectMoneyFlows([troskovnikAnalysis]);
        expect(flow.entries[0].amountEur).toBe(248.86);
        expect(flow.entries[0].amountEurSource).toBe('stated');
        expect(flow.entries[1]).toEqual(expect.objectContaining({
            amountEur: 63.38,
            direction: 'obveza',
        }));
    });

    test('shared registry 106 reconciles to one timeline across both documents', () => {
        const flow = collectPropertyFlows([prilogAnalysis, troskovnikAnalysis]);
        const result = reconcilePropertyFlows(flow, { analyses: [prilogAnalysis, troskovnikAnalysis] });
        expect(result.conflicts).toHaveLength(0);
        expect(result.valueChanges).toHaveLength(1);
        expect(result.valueChanges[0].linkage).toBe('claimRegistryNumber');
    });

    test('citation graph resolves the Troškovnik → Prilog reference', () => {
        const graph = buildCitationGraph([prilogAnalysis, troskovnikAnalysis]);
        expect(graph.edges).toEqual(expect.arrayContaining([
            { from: 'a-troskovnik', to: 'a-prilog', via: 'St-2/2013-1196-1', resolved: true },
        ]));
    });
});
