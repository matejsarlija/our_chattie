const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
// We want to test the integration, so we won't mock normalizeCaseNumber, 
// we'll rely on its real behavior to transform the data.
// But we need to mock Puppeteer parts.

jest.mock('puppeteer', () => ({
    launch: jest.fn(),
    connect: jest.fn()
}));

jest.mock('puppeteer-core', () => ({
    launch: jest.fn(),
    connect: jest.fn()
}));

describe('CourtSearchPuppeteer Normalization Integration', () => {
    let scraper;
    let mockPage;

    beforeEach(() => {
        scraper = new CourtSearchPuppeteer();
        mockPage = {
            waitForSelector: jest.fn().mockResolvedValue(true),
            evaluate: jest.fn(),
            url: jest.fn().mockReturnValue('https://e-oglasna.pravosudje.hr/objave'),
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

    test('parseSearchResults normalizes case numbers', async () => {
        // Mock evaluate to return raw scraped items (before normalization)
        mockPage.evaluate.mockResolvedValue([
            { 
                caseNumber: 'St-357/2013', 
                title: 'Item 1', 
                detailLink: 'http://link1', 
                participants: [] 
            },
            { 
                caseNumber: ' st - 123 / 2024 ', 
                title: 'Item 2', 
                detailLink: 'http://link2',
                participants: []
            },
            { 
                caseNumber: 'N/A', 
                title: 'Item 3', 
                detailLink: 'http://link3',
                participants: []
            }
        ]);

        const results = await scraper.parseSearchResults();

        expect(results).toHaveLength(3);
        
        // Item 1: Standard normalization
        expect(results[0].caseNumber).toBe('ST-357/2013');
        
        // Item 2: Spaced normalization
        expect(results[1].caseNumber).toBe('ST-123/2024');
        
        // Item 3: N/A stays N/A because normalizeCaseNumber returns null for it, and code does `|| item.caseNumber`
        // Wait, let's verify my logic:
        // const normalized = normalizeCaseNumber('N/A'); // returns null
        // if (normalized) { item.caseNumber = normalized; }
        // So item.caseNumber remains 'N/A'.
        expect(results[2].caseNumber).toBe('N/A');
    });
});
