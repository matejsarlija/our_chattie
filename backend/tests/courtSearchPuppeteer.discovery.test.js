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

    test('aggregateSearchWindows merges per-page metadata with correct pagesScanned', () => {
        const aggregated = scraper.aggregateSearchWindows([
            { currentPage: 1, hasNextPage: true, totalResults: 42, totalPages: 5, rawParsedEntryCount: 10 },
            { currentPage: 2, hasNextPage: true, totalResults: 42, totalPages: 5, rawParsedEntryCount: 10 },
            { currentPage: 3, hasNextPage: false, totalResults: 42, totalPages: 5, rawParsedEntryCount: 10 },
        ], 30);

        expect(aggregated.pagesScanned).toBe(3);
        expect(aggregated.currentPage).toBe(3);
        expect(aggregated.hasNextPage).toBe(false);
        expect(aggregated.totalResults).toBe(42);
        expect(aggregated.totalPages).toBe(5);
        expect(aggregated.rawParsedEntryCount).toBe(30);
        expect(aggregated.searchWindows).toHaveLength(3);
        expect(aggregated.searchWindows[0]).toEqual(expect.objectContaining({ mode: 'search-window', currentPage: 1 }));
        expect(aggregated.searchWindows[2]).toEqual(expect.objectContaining({ mode: 'search-window', currentPage: 3, hasNextPage: false }));
    });

    test('performSearchAcrossPages stops at the maxPages limit even when hasNextPage remains true', async () => {
        scraper.performSearch = jest.fn().mockResolvedValue(undefined);
        scraper.parseSearchResultsPage = jest.fn()
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-1/2020' }],
                searchMetadata: { currentPage: 1, hasNextPage: true, totalResults: 50, totalPages: 10 }
            })
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-2/2020' }],
                searchMetadata: { currentPage: 2, hasNextPage: true, totalResults: 50, totalPages: 10 }
            })
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-3/2020' }],
                searchMetadata: { currentPage: 3, hasNextPage: true, totalResults: 50, totalPages: 10 }
            });
        scraper.navigateToSearchResultsPage = jest.fn().mockResolvedValue(undefined);

        const { results, searchMetadata } = await scraper.performSearchAcrossPages('KERUM', 3);

        expect(results).toHaveLength(3);
        expect(scraper.navigateToSearchResultsPage).toHaveBeenCalledTimes(2);
        expect(searchMetadata.pagesScanned).toBe(3);
        expect(searchMetadata.searchWindows).toHaveLength(3);
    });

    test('performSearchAcrossPages tags each page with its own currentPage via parseSearchResultsPage', async () => {
        scraper.performSearch = jest.fn().mockResolvedValue(undefined);
        scraper.parseSearchResultsPage = jest.fn()
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-1/2020' }],
                searchMetadata: { currentPage: 1, hasNextPage: true, totalResults: 50, totalPages: 10 }
            })
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-2/2020' }],
                searchMetadata: { currentPage: 2, hasNextPage: false, totalResults: 50, totalPages: 10 }
            });
        scraper.navigateToSearchResultsPage = jest.fn().mockResolvedValue(undefined);

        const { searchMetadata } = await scraper.performSearchAcrossPages('KERUM', 5);

        expect(searchMetadata.pagesScanned).toBe(2);
        expect(searchMetadata.currentPage).toBe(2);
        expect(searchMetadata.hasNextPage).toBe(false);
    });

    test('searchAndGetLatestCasesWithDocuments captures the full window when limit is null (3b full history)', async () => {
        scraper.performSearchAcrossPages = jest.fn().mockResolvedValue({
            results: [
                { caseNumber: 'St-1/2013', documentDownloadLink: 'http://d1' },
                { caseNumber: 'St-2/2013', documentDownloadLink: 'http://d2' },
                { caseNumber: 'St-3/2013', documentDownloadLink: 'http://d3' },
                { caseNumber: 'St-4/2013', documentDownloadLink: null },
                { caseNumber: 'St-5/2013', documentDownloadLink: 'http://d5' },
            ],
            searchMetadata: { pagesScanned: 1, currentPage: 1, hasNextPage: false, totalResults: 5, totalPages: 1 }
        });
        scraper.mapSearchResultsToPipelineEntries = jest.fn().mockReturnValue([]);

        await scraper.searchAndGetLatestCasesWithDocuments('ST-1/2013', null);

        const captured = scraper.mapSearchResultsToPipelineEntries.mock.calls[0][0];
        expect(captured).toHaveLength(4);
        expect(captured.map(c => c.caseNumber)).toEqual(['St-1/2013', 'St-2/2013', 'St-3/2013', 'St-5/2013']);
    });

    test('searchAndGetLatestCasesWithDocuments still truncates to a numeric limit', async () => {
        scraper.performSearchAcrossPages = jest.fn().mockResolvedValue({
            results: [
                { caseNumber: 'St-1/2013', documentDownloadLink: 'http://d1' },
                { caseNumber: 'St-2/2013', documentDownloadLink: 'http://d2' },
                { caseNumber: 'St-3/2013', documentDownloadLink: 'http://d3' },
            ],
            searchMetadata: { pagesScanned: 1, currentPage: 1, hasNextPage: false, totalResults: 3, totalPages: 1 }
        });
        scraper.mapSearchResultsToPipelineEntries = jest.fn().mockReturnValue([]);

        await scraper.searchAndGetLatestCasesWithDocuments('ST-1/2013', 2);

        const captured = scraper.mapSearchResultsToPipelineEntries.mock.calls[0][0];
        expect(captured).toHaveLength(2);
        expect(captured.map(c => c.caseNumber)).toEqual(['St-1/2013', 'St-2/2013']);
    });

    test('searchCaseNumberFollowUp returns only entries matching the normalized case lineage', async () => {
        scraper.performSearchAcrossPages = jest.fn().mockResolvedValue({
            results: [
                { caseNumber: 'St-700/2024', detailLink: 'http://l1', documentDownloadLink: 'http://d1' },
                { caseNumber: 'ST-700/2024', detailLink: 'http://l2', documentDownloadLink: 'http://d2' },
                { caseNumber: 'St-800/2024', detailLink: 'http://l3', documentDownloadLink: 'http://d3' },
            ],
            searchMetadata: { pagesScanned: 1, currentPage: 1, hasNextPage: false }
        });

        const result = await scraper.searchCaseNumberFollowUp('st-700/2024', { pass: 1, strategy: 'case-number-follow-up-search' });

        expect(result.entries).toHaveLength(2);
        expect(result.entries.every(e => e.acquisition.mode === 'cluster-expansion')).toBe(true);
        expect(result.entries.every(e => e.acquisition.sourceCaseNumber === 'ST-700/2024')).toBe(true);
        expect(result.entries.every(e => e.acquisition.pass === 1)).toBe(true);
        expect(result.entries[0].documentLinks).toEqual([
            { url: 'http://d1', text: 'Dokumenti za ST-700/2024' }
        ]);
    });

    test('followDetailLinks harvests document links from detail pages', async () => {
        scraper.parseDetailPage = jest.fn()
            .mockResolvedValueOnce({
                detailLink: 'http://detail1',
                title: 'Detalj 1',
                documentLinks: [{ url: 'http://d1', text: 'Zapisnik' }]
            })
            .mockResolvedValueOnce({ detailLink: 'http://detail2', title: 'Detalj 2', documentLinks: [] });

        const result = await scraper.followDetailLinks(['http://detail1', 'http://detail2'], {
            pass: 1,
            strategy: 'detail-link-follow-up',
            sourceCaseNumber: 'ST-700/2024'
        });

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].acquisition).toEqual(expect.objectContaining({
            mode: 'cluster-expansion',
            strategy: 'detail-link-follow-up',
            pass: 1,
            sourceCaseNumber: 'ST-700/2024'
        }));
        expect(result.entries[0].documentLinks).toEqual([{ url: 'http://d1', text: 'Zapisnik' }]);
        expect(result.entries[0].caseInfo.caseNumber).toBe('ST-700/2024');
    });

    test('performSearchAcrossPages tail-samples the oldest entries when the last page is partial', async () => {
        scraper.performSearch = jest.fn().mockResolvedValue(undefined);
        scraper.parseSearchResultsPage = jest.fn()
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-50/2026' }],
                searchMetadata: { currentPage: 1, hasNextPage: true, totalResults: 381, totalPages: 39 }
            })
            // Page 39 (oldest) is partial: a single entry, as on the real KERUM window.
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-1/2013' }],
                searchMetadata: { currentPage: 39, hasNextPage: false, totalResults: 381, totalPages: 39 }
            })
            // Page 38 holds the standard 10 entries again.
            .mockResolvedValueOnce({
                results: Array.from({ length: 10 }, (_, i) => ({ caseNumber: `St-${2 + i}/2013` })),
                searchMetadata: { currentPage: 38, hasNextPage: true, totalResults: 381, totalPages: 39 }
            });
        scraper.navigateToSearchResultsPage = jest.fn().mockResolvedValue(undefined);

        const { results, searchMetadata } = await scraper.performSearchAcrossPages('KERUM', 1, { tailSample: true });

        expect(results).toHaveLength(11);
        expect(searchMetadata.tailSampling).toEqual(expect.objectContaining({
            enabled: true,
            entriesCollected: 11,
            entriesKept: 10,
            pages: 2
        }));
        expect(searchMetadata.acquisitionModes).toEqual(expect.arrayContaining(['search-window-tail']));

        const tailResults = results.filter((r) => r.acquisition?.mode === 'search-window-tail');
        expect(tailResults).toHaveLength(10);
        expect(tailResults.map((r) => r.caseNumber)).toContain('St-1/2013');
        expect(scraper.navigateToSearchResultsPage).toHaveBeenCalledTimes(2);
    });

    test('performSearchAcrossPages scans every page when maxPages is Infinity (full depth)', async () => {
        scraper.performSearch = jest.fn().mockResolvedValue(undefined);
        scraper.parseSearchResultsPage = jest.fn()
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-1/2020' }],
                searchMetadata: { currentPage: 1, hasNextPage: true, totalResults: 50, totalPages: 5 }
            })
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-2/2020' }],
                searchMetadata: { currentPage: 2, hasNextPage: true, totalResults: 50, totalPages: 5 }
            })
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-3/2020' }],
                searchMetadata: { currentPage: 3, hasNextPage: true, totalResults: 50, totalPages: 5 }
            })
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-4/2020' }],
                searchMetadata: { currentPage: 4, hasNextPage: true, totalResults: 50, totalPages: 5 }
            })
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-5/2020' }],
                searchMetadata: { currentPage: 5, hasNextPage: false, totalResults: 50, totalPages: 5 }
            });
        scraper.navigateToSearchResultsPage = jest.fn().mockResolvedValue(undefined);

        const { results, searchMetadata } = await scraper.performSearchAcrossPages('KERUM', Infinity, { tailSample: false });

        expect(results).toHaveLength(5);
        expect(searchMetadata.pagesScanned).toBe(5);
        expect(searchMetadata.tailSampling).toEqual({ enabled: false });
        expect(scraper.navigateToSearchResultsPage).toHaveBeenCalledTimes(4);
    });

    test('performSearchAcrossPages skips the tail when the window already covers the whole case', async () => {
        scraper.performSearch = jest.fn().mockResolvedValue(undefined);
        scraper.parseSearchResultsPage = jest.fn()
            .mockResolvedValueOnce({
                results: [{ caseNumber: 'St-1/2020' }],
                searchMetadata: { currentPage: 1, hasNextPage: false, totalResults: 10, totalPages: 1 }
            });
        scraper.navigateToSearchResultsPage = jest.fn().mockResolvedValue(undefined);

        const { results, searchMetadata } = await scraper.performSearchAcrossPages('KERUM', 5, { tailSample: true });

        expect(results).toHaveLength(1);
        expect(scraper.navigateToSearchResultsPage).not.toHaveBeenCalled();
        expect(searchMetadata.tailSampling).toEqual(expect.objectContaining({
            enabled: true,
            reason: 'window-fully-scanned'
        }));
    });

    test('searchAndGetLatestCasesWithDocuments threads tailSample to the page walk', async () => {
        scraper.performSearchAcrossPages = jest.fn().mockResolvedValue({
            results: [{ caseNumber: 'St-1/2013', documentDownloadLink: 'http://d1' }],
            searchMetadata: { pagesScanned: 1, currentPage: 1, hasNextPage: false, totalResults: 1, totalPages: 1 }
        });
        scraper.mapSearchResultsToPipelineEntries = jest.fn().mockReturnValue([]);

        await scraper.searchAndGetLatestCasesWithDocuments('ST-1/2013', null, null, true);

        expect(scraper.performSearchAcrossPages).toHaveBeenCalledWith('ST-1/2013', null, { tailSample: true });
    });
});
