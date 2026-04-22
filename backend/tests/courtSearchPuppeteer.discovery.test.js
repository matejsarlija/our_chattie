const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');

jest.mock('puppeteer', () => ({
    launch: jest.fn(),
    connect: jest.fn()
}));

jest.mock('puppeteer-core', () => ({
    launch: jest.fn(),
    connect: jest.fn()
}));

describe('CourtSearchPuppeteer discovery metadata', () => {
    let scraper;
    let mockPage;

    beforeEach(() => {
        scraper = new CourtSearchPuppeteer();
        mockPage = {
            waitForSelector: jest.fn().mockResolvedValue(true),
            evaluate: jest.fn(),
            url: jest.fn().mockReturnValue('https://e-oglasna.pravosudje.hr/objave?text=KERUM&page=1'),
            title: jest.fn(),
            screenshot: jest.fn(),
            on: jest.fn(),
            setUserAgent: jest.fn(),
            setExtraHTTPHeaders: jest.fn(),
            setViewport: jest.fn(),
            setDefaultTimeout: jest.fn(),
            setDefaultNavigationTimeout: jest.fn(),
            setRequestInterception: jest.fn(),
        };
        scraper.page = mockPage;
    });

    test('parseSearchResultsPage returns search-window metadata before document filtering', async () => {
        mockPage.evaluate.mockResolvedValue({
            items: [
                {
                    caseNumber: 'St-357/2013',
                    title: 'Item 1',
                    detailLink: 'http://link1',
                    documentDownloadLink: 'http://doc1',
                    documentLinkText: 'Dokument objave',
                    participants: [{ name: 'KERUM d.o.o.', oib: '11111111111' }]
                },
                {
                    caseNumber: 'St-400/2019',
                    title: 'Item 2',
                    detailLink: 'http://link2',
                    documentDownloadLink: null,
                    documentLinkText: null,
                    participants: [{ name: 'KERUM d.o.o.', oib: 'N/A' }]
                }
            ],
            searchMetadata: {
                totalResults: 42,
                totalPages: 5,
                currentPage: 2,
                hasNextPage: true
            }
        });

        const parsed = await scraper.parseSearchResultsPage();

        expect(parsed.results).toHaveLength(2);
        expect(parsed.results[0].caseNumber).toBe('ST-357/2013');
        expect(parsed.results[1].caseNumber).toBe('ST-400/2019');
        expect(parsed.searchMetadata).toEqual({
            discoveryMode: 'search-window',
            acquisitionModes: ['search-window'],
            searchWindows: [
                {
                    mode: 'search-window',
                    currentPage: 2,
                    pagesScanned: 1,
                    hasNextPage: true,
                    rawParsedEntryCount: 2
                }
            ],
            totalResults: 42,
            totalPages: 5,
            pagesScanned: 1,
            currentPage: 2,
            hasNextPage: true,
            rawParsedEntryCount: 2
        });
    });

    test('parseSearchResultsPage preserves Croatian thousands separators in totalResults', async () => {
        mockPage.evaluate.mockResolvedValue({
            items: [
                {
                    caseNumber: 'St-357/2013',
                    title: 'Item 1',
                    detailLink: 'http://link1',
                    documentDownloadLink: 'http://doc1',
                    documentLinkText: 'Dokument objave',
                    participants: []
                }
            ],
            searchMetadata: {
                totalResults: 1234,
                totalPages: 124,
                currentPage: 37,
                hasNextPage: true
            }
        });

        const parsed = await scraper.parseSearchResultsPage();

        expect(parsed.searchMetadata.totalResults).toBe(1234);
        expect(parsed.searchMetadata.totalPages).toBe(124);
        expect(parsed.searchMetadata.currentPage).toBe(37);
    });
});
