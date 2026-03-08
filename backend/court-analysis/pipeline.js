// pipeline.js

const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
const { DownloadDocumentsTool } = require('./agents/download-agent');
// We will modify AnalyzeDocumentsTool, so we need to import it
const { AnalyzeDocumentsTool, generateComparativeAnalysis } = require('./agents/analysis-agent');
const { VisualizerTool } = require('./agents/visualizer-agent');
const { enrichParticipants } = require('../court-registry/enricher');
const {
    DEFAULT_CASE_LIMIT,
    MIN_CASE_LIMIT,
    MAX_CASE_LIMIT,
} = require('../helpers/courtAnalysisRequest');
const { groupEntriesByCase } = require('./utils/grouping');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function clampCaseLimit(rawLimit) {
    const numeric = Number.parseInt(String(rawLimit), 10);
    if (Number.isNaN(numeric)) return DEFAULT_CASE_LIMIT;
    if (numeric < MIN_CASE_LIMIT) return MIN_CASE_LIMIT;
    if (numeric > MAX_CASE_LIMIT) return MAX_CASE_LIMIT;
    return numeric;
}

const RAW_SCRAPE_MULTIPLIER = 3;

function computeRawScrapeLimit(caseLimit) {
    const normalizedLimit = clampCaseLimit(caseLimit);
    const maxRawLimit = MAX_CASE_LIMIT * RAW_SCRAPE_MULTIPLIER;
    return Math.min(normalizedLimit * RAW_SCRAPE_MULTIPLIER, maxRawLimit);
}

function parseCaseDateToTimestamp(rawDate) {
    if (!rawDate || typeof rawDate !== 'string') return null;
    const value = rawDate.trim();
    if (!value || value.toUpperCase() === 'N/A') return null;

    const croatianDateMatch = value.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\.?$/);
    if (croatianDateMatch) {
        const day = Number.parseInt(croatianDateMatch[1], 10);
        const month = Number.parseInt(croatianDateMatch[2], 10);
        const yearRaw = Number.parseInt(croatianDateMatch[3], 10);
        const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
        const ts = Date.UTC(year, month - 1, day);
        const parsed = new Date(ts);

        if (
            parsed.getUTCFullYear() === year &&
            parsed.getUTCMonth() === month - 1 &&
            parsed.getUTCDate() === day
        ) {
            return ts;
        }
        return null;
    }

    const fallbackTs = Date.parse(value);
    return Number.isNaN(fallbackTs) ? null : fallbackTs;
}

function selectClustersForProcessing(allClusters, rawCaseLimit) {
    if (!Array.isArray(allClusters) || allClusters.length === 0) {
        return [];
    }

    if (typeof rawCaseLimit !== 'number' || Number.isNaN(rawCaseLimit)) {
        return allClusters;
    }

    const caseLimit = clampCaseLimit(rawCaseLimit);
    if (caseLimit >= allClusters.length) {
        return allClusters;
    }

    const scored = allClusters.map((cluster, originalIndex) => {
        const entries = Array.isArray(cluster.entries) ? cluster.entries : [];
        const recencyTimestamp = entries.reduce((maxTs, entry) => {
            const dateCandidate = entry?.caseInfo?.date || entry?.caseInfo?.datePublished;
            const ts = parseCaseDateToTimestamp(dateCandidate);
            if (ts === null) return maxTs;
            if (maxTs === null) return ts;
            return ts > maxTs ? ts : maxTs;
        }, null);

        const documentCount = entries.reduce((sum, entry) => {
            const links = Array.isArray(entry?.documentLinks) ? entry.documentLinks.length : 0;
            return sum + links;
        }, 0);

        return {
            cluster,
            originalIndex,
            recencyTimestamp,
            documentCount,
            entryCount: entries.length,
        };
    });

    scored.sort((a, b) => {
        if (a.recencyTimestamp !== null && b.recencyTimestamp !== null && a.recencyTimestamp !== b.recencyTimestamp) {
            return b.recencyTimestamp - a.recencyTimestamp;
        }
        if (a.recencyTimestamp !== null && b.recencyTimestamp === null) return -1;
        if (a.recencyTimestamp === null && b.recencyTimestamp !== null) return 1;

        if (a.documentCount !== b.documentCount) {
            return b.documentCount - a.documentCount;
        }

        if (a.entryCount !== b.entryCount) {
            return b.entryCount - a.entryCount;
        }

        return a.originalIndex - b.originalIndex;
    });

    return scored.slice(0, caseLimit).map(item => item.cluster);
}

function resolveAnalysisArgs(caseLimitOrOptions, maybeProgressCallback) {
    if (typeof caseLimitOrOptions === 'function') {
        return {
            caseLimit: DEFAULT_CASE_LIMIT,
            scrapeLimit: computeRawScrapeLimit(DEFAULT_CASE_LIMIT),
            enableVisualizer: true,
            progressCallback: caseLimitOrOptions,
        };
    }

    if (typeof caseLimitOrOptions === 'number' || typeof caseLimitOrOptions === 'string') {
        const caseLimit = clampCaseLimit(caseLimitOrOptions);
        return {
            caseLimit,
            scrapeLimit: computeRawScrapeLimit(caseLimit),
            enableVisualizer: true,
            progressCallback: maybeProgressCallback,
        };
    }

    if (caseLimitOrOptions && typeof caseLimitOrOptions === 'object') {
        const caseLimit = clampCaseLimit(caseLimitOrOptions.caseLimit);
        return {
            caseLimit,
            scrapeLimit: computeRawScrapeLimit(caseLimit),
            enableVisualizer: caseLimitOrOptions.enableVisualizer !== false,
            progressCallback: maybeProgressCallback,
        };
    }

    return {
        caseLimit: DEFAULT_CASE_LIMIT,
        scrapeLimit: computeRawScrapeLimit(DEFAULT_CASE_LIMIT),
        enableVisualizer: true,
        progressCallback: maybeProgressCallback,
    };
}

/**
 * New Pipeline for comparative court analysis: (Scrape → [Download → Unzip → Analyze] x N) → Compare
 * @param {string} searchTerm
 * @param {number|object|function} caseLimitOrOptions - Case limit or options object.
 * @param {function} progressCallback
 */
async function runCourtAnalysis(searchTerm, caseLimitOrOptions, progressCallback) {
    const resolved = resolveAnalysisArgs(caseLimitOrOptions, progressCallback);
    const callback = resolved.progressCallback;
    const automator = new CourtSearchPuppeteer();
    const allProcessedCases = [];
    let allFilesToCleanup = [];

    try {
        // 1. Scrape for the N latest cases
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const casesToProcess = await automator.searchAndGetLatestCasesWithDocuments(searchTerm, resolved.scrapeLimit);
        
        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        // Process the scraped cases using the separate function
        const result = await processScrapedCases(casesToProcess, callback, {
            caseLimit: resolved.caseLimit,
            enableVisualizer: resolved.enableVisualizer,
        });
        return result;

    } catch (error) {
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        // Always close automator here - simpler logic
        await automator.close();
        await cleanupFiles(allFilesToCleanup);
    }
}

/**
 * Modified version of runCourtAnalysis that uses an existing automator instance
 * This prevents creating multiple Puppeteer instances in the cron job
 */
async function runCourtAnalysisWithExistingAutomator(searchTerm, caseLimitOrOptions, existingAutomator, progressCallback) {
    const resolved = resolveAnalysisArgs(caseLimitOrOptions, progressCallback);
    const callback = resolved.progressCallback;
    const allProcessedCases = [];
    let allFilesToCleanup = [];

    try {
        // 1. Use the existing automator to scrape (no init/close needed)
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        const casesToProcess = await existingAutomator.searchAndGetLatestCasesWithDocuments(searchTerm, resolved.scrapeLimit);

        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        // Process using the shared logic
        const result = await processScrapedCases(casesToProcess, callback, {
            caseLimit: resolved.caseLimit,
            enableVisualizer: resolved.enableVisualizer,
        });
        return result;

    } catch (error) {
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        // Don't close the automator - the cron job will handle that
        await cleanupFiles(allFilesToCleanup);
    }
}

/**
 * The CORE processing function. It takes pre-scraped cases and performs
 * the download, unzip, analysis, and comparison steps.
 * @param {Array<object>} casesToProcess - The array of case objects from the scraper.
 * @param {function} progressCallback - The callback for sending progress updates.
 * @returns {Promise<object>} The final result with processed cases and comparative analysis.
 */
async function processScrapedCases(casesToProcess, progressCallback, options = { enableVisualizer: true }) {
    const resolvedOptions = {
        enableVisualizer: true,
        ...options,
    };
    const allProcessedCases = [];
    let allFilesToCleanup = [];

    try {
        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        // --- GROUPING STEP (A-05) ---
        progressCallback?.({ step: 'grouping', progress: 15, message: 'Grupiram pronađene objave po predmetima...' });
        
        // Prepare entries for grouping by lifting caseNumber to top level
        const entriesForGrouping = casesToProcess.map(c => ({
            ...c,
            caseNumber: c.caseInfo ? c.caseInfo.caseNumber : 'N/A'
        }));
        
        const allClusters = groupEntriesByCase(entriesForGrouping);
        
        // --- SELECTION STEP (A-06) ---
        // Selection policy:
        // 1) newer clusters first (by parsed entry dates when available)
        // 2) better-covered clusters next (more document links, then more entries)
        // 3) preserve original discovery order as final tie-break
        const clusters = selectClustersForProcessing(allClusters, resolvedOptions.caseLimit);

        const totalCases = clusters.length;

        progressCallback?.({ step: 'grouping', progress: 20, message: `Pronađeno ${totalCases} jedinstvenih predmeta (odabrano od ${allClusters.length} grupa iz ${casesToProcess.length} objava) za analizu.` });

        const downloadTool = new DownloadDocumentsTool();
        const analyzeTool = new AnalyzeDocumentsTool();

        // Loop through each case CLUSTER
        for (let i = 0; i < totalCases; i++) {
            const cluster = clusters[i];
            
            // Use the first entry as the primary metadata source (most recent usually)
            const primaryEntry = cluster.entries[0];
            const { caseInfo } = primaryEntry;
            
            // Merge document links from all entries in the cluster
            const documentLinks = cluster.entries.flatMap(e => e.documentLinks || []);

            let downloadedFiles = [];
            let extractedFilePaths = [];

            progressCallback?.({ step: 'downloading', progress: 25 + (i / totalCases) * 50, message: `Obrađujem predmet ${i + 1} od ${totalCases}: ${caseInfo.caseNumber} (${cluster.entries.length} objava)` });

            // --- ENRICHMENT STEP ---
            if (caseInfo.participants && caseInfo.participants.length > 0) {
                progressCallback?.({ step: 'discovering', message: `Dohvaćam podatke iz Sudskog registra za sudionike...` });
                try {
                    caseInfo.participants = await enrichParticipants(caseInfo.participants);
                } catch (err) {
                    console.error('Enrichment failed gracefully:', err.message);
                }
            }
            // -----------------------

            // 2a. Download
            progressCallback?.({ step: 'downloading', message: `Preuzimam arhivu za predmet ${i + 1} (${documentLinks.length} linkova)...` });
            downloadedFiles = await downloadTool._call({ documentLinks, progressCallback: null });

            // 2b. Unzip
            progressCallback?.({ step: 'extracting', message: `Raspakiram datoteke za predmet ${i + 1}...` });
            const filesForAnalysis = [];
            for (const file of downloadedFiles) {
                extractedFilePaths.push(file.filePath);
                if (path.extname(file.filePath).toLowerCase() === '.zip') {
                    const zip = new AdmZip(file.filePath);
                    const zipEntries = zip.getEntries();
                    const extractionDir = path.dirname(file.filePath);
                    zipEntries.forEach((zipEntry) => {
                        if (!zipEntry.isDirectory) {
                            const extractedFilePath = path.join(extractionDir, zipEntry.entryName);
                            zip.extractEntryTo(zipEntry.entryName, extractionDir, false, true);
                            filesForAnalysis.push({ filePath: extractedFilePath, text: zipEntry.entryName, url: file.url });
                            extractedFilePaths.push(extractedFilePath);
                        }
                    });
                } else {
                    filesForAnalysis.push(file);
                }
            }
            
            allFilesToCleanup.push(...extractedFilePaths);

            if (filesForAnalysis.length === 0) {
                 console.warn(`No files to analyze for case ${caseInfo.title}. Skipping analysis.`);
                 allProcessedCases.push({ caseResult: caseInfo, analysis: { individualAnalyses: [], finalSummary: "Nema dokumenata za analizu." } });
                 continue;
            }

            // 2c. Analyze THIS case's documents
            progressCallback?.({ step: 'reasoning', message: `Analiziram ${filesForAnalysis.length} datoteka za predmet ${i + 1}...` });
            const analysis = await analyzeTool._call({ files: filesForAnalysis, caseInfo: caseInfo, progressCallback: null });

            // Store the fully processed case data
            allProcessedCases.push({
                caseResult: caseInfo,
                files: downloadedFiles, 
                analysis: analysis,
                // Add metadata about the grouping for debugging/UI
                groupMetadata: {
                    entryCount: cluster.entries.length,
                    isAnonymous: cluster.isAnonymous
                }
            });
        }

        // 3. Final Comparative Analysis
        progressCallback?.({ step: 'reasoning', progress: 85, message: 'Generiram usporednu analizu i zaključak...' });
        let comparativeAnalysis = await generateComparativeAnalysis(allProcessedCases);

        // --- VISUALIZATION STEP ---
        if (resolvedOptions.enableVisualizer && comparativeAnalysis) {
            progressCallback?.({ step: 'reasoning', progress: 95, message: 'Generiram vizualizaciju tijeka predmeta...' });
            try {
                const visualizerTool = new VisualizerTool();
                const diagramCode = await visualizerTool._call(comparativeAnalysis);
                if (diagramCode && diagramCode !== "Error generating diagram.") {
                    comparativeAnalysis += `\n\n${diagramCode}`;
                }
            } catch (err) {
                console.error('Visualization failed gracefully:', err.message);
            }
        }
        // -------------------------

        progressCallback?.({ step: 'complete', progress: 100, message: 'Analiza je završena!' });

        return {
            processedCases: allProcessedCases,
            comparativeAnalysis: comparativeAnalysis
        };

    } catch (error) {
        // Re-throw the error for the calling function (orchestrator) to handle.
        throw error;
    } finally {
        // The cleanup function needs to be available in the scope of this file.
        await cleanupFiles(allFilesToCleanup);
    }
}

async function cleanupFiles(filePaths) {
    if (!filePaths || filePaths.length === 0) return;
    for (const filePath of filePaths) {
        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
        } catch (err) {
            console.warn(`Failed to delete temporary file ${filePath}: ${err.message}`);
        }
    }
}

module.exports = { runCourtAnalysis, runCourtAnalysisWithExistingAutomator, processScrapedCases };
