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

function resolveAnalysisArgs(caseLimitOrOptions, maybeProgressCallback) {
    if (typeof caseLimitOrOptions === 'function') {
        return {
            caseLimit: DEFAULT_CASE_LIMIT,
            progressCallback: caseLimitOrOptions,
        };
    }

    if (typeof caseLimitOrOptions === 'number' || typeof caseLimitOrOptions === 'string') {
        return {
            caseLimit: clampCaseLimit(caseLimitOrOptions),
            progressCallback: maybeProgressCallback,
        };
    }

    if (caseLimitOrOptions && typeof caseLimitOrOptions === 'object') {
        return {
            caseLimit: clampCaseLimit(caseLimitOrOptions.caseLimit),
            progressCallback: maybeProgressCallback,
        };
    }

    return {
        caseLimit: DEFAULT_CASE_LIMIT,
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
        callback?.({ step: 'scraping', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const casesToProcess = await automator.searchAndGetLatestCasesWithDocuments(searchTerm, resolved.caseLimit);
        
        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        // Process the scraped cases using the separate function
        const result = await processScrapedCases(casesToProcess, callback);
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
        callback?.({ step: 'scraping', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        const casesToProcess = await existingAutomator.searchAndGetLatestCasesWithDocuments(searchTerm, resolved.caseLimit);

        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        const totalCases = casesToProcess.length;
        callback?.({ step: 'processing_setup', progress: 20, message: `Pronađeno ${totalCases} objava za analizu.` });

        const downloadTool = new DownloadDocumentsTool();
        const analyzeTool = new AnalyzeDocumentsTool();

        // 2. Loop through each case, download its files, and analyze them
        for (let i = 0; i < totalCases; i++) {
            const caseEntry = casesToProcess[i];
            const { caseInfo, documentLinks } = caseEntry;
            let downloadedFiles = [];
            let extractedFilePaths = [];

            callback?.({ step: 'processing_case', progress: 25 + (i / totalCases) * 50, message: `Obrađujem objavu ${i + 1} od ${totalCases}: ${caseInfo.title}` });

            // --- ENRICHMENT STEP ---
            if (caseInfo.participants && caseInfo.participants.length > 0) {
                callback?.({ step: 'enriching', message: `Dohvaćam podatke iz Sudskog registra za sudionike...` });
                try {
                    caseInfo.participants = await enrichParticipants(caseInfo.participants);
                } catch (err) {
                    console.error('Enrichment failed gracefully:', err.message);
                }
            }
            // -----------------------

            // 2a. Download
            callback?.({ step: 'downloading', message: `Preuzimam arhivu za objavu ${i + 1}...` });
            downloadedFiles = await downloadTool._call({ documentLinks, progressCallback: null });

            // 2b. Unzip
            callback?.({ step: 'unzipping', message: `Raspakiram datoteke za objavu ${i + 1}...` });
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
            callback?.({ step: 'analyzing', message: `Analiziram ${filesForAnalysis.length} datoteka za objavu ${i + 1}...` });

            const analysis = await analyzeTool._call({ files: filesForAnalysis, caseInfo: caseInfo, progressCallback: null });

            // Store the fully processed case data
            allProcessedCases.push({
                caseResult: caseInfo,
                files: downloadedFiles, 
                analysis: analysis
            });
        }

        // 3. Final Comparative Analysis
        callback?.({ step: 'comparing', progress: 85, message: 'Generiram usporednu analizu i zaključak...' });
        const comparativeAnalysis = await generateComparativeAnalysis(allProcessedCases);

        callback?.({ step: 'complete', progress: 100, message: 'Analiza je završena!' });

        return {
            processedCases: allProcessedCases,
            comparativeAnalysis: comparativeAnalysis
        };

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
    const allProcessedCases = [];
    let allFilesToCleanup = [];

    try {
        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        const totalCases = casesToProcess.length;
        progressCallback?.({ step: 'processing_setup', progress: 20, message: `Pronađeno ${totalCases} objava za analizu.` });

        const downloadTool = new DownloadDocumentsTool();
        const analyzeTool = new AnalyzeDocumentsTool();

        // Loop through each case, download its files, and analyze them
        for (let i = 0; i < totalCases; i++) {
            // Note: The property name here should match the scraper's output.
            // Using 'caseInfo' to align with the current scraper code.
            const { caseInfo, documentLinks } = casesToProcess[i];
            let downloadedFiles = [];
            let extractedFilePaths = [];

            progressCallback?.({ step: 'processing_case', progress: 25 + (i / totalCases) * 50, message: `Obrađujem objavu ${i + 1} od ${totalCases}: ${caseInfo.title}` });

            // --- ENRICHMENT STEP ---
            if (caseInfo.participants && caseInfo.participants.length > 0) {
                progressCallback?.({ step: 'enriching', message: `Dohvaćam podatke iz Sudskog registra za sudionike...` });
                try {
                    caseInfo.participants = await enrichParticipants(caseInfo.participants);
                } catch (err) {
                    console.error('Enrichment failed gracefully:', err.message);
                }
            }
            // -----------------------

            // 2a. Download
            progressCallback?.({ step: 'downloading', message: `Preuzimam arhivu za objavu ${i + 1}...` });
            downloadedFiles = await downloadTool._call({ documentLinks, progressCallback: null });

            // 2b. Unzip
            progressCallback?.({ step: 'unzipping', message: `Raspakiram datoteke za objavu ${i + 1}...` });
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
            progressCallback?.({ step: 'analyzing', message: `Analiziram ${filesForAnalysis.length} datoteka za objavu ${i + 1}...` });
            const analysis = await analyzeTool._call({ files: filesForAnalysis, caseInfo: caseInfo, progressCallback: null });

            allProcessedCases.push({
                caseResult: caseInfo,
                files: downloadedFiles,
                analysis: analysis
            });
        }

        // 3. Final Comparative Analysis
        progressCallback?.({ step: 'comparing', progress: 85, message: 'Generiram usporednu anailzu i zaključak...' });
        let comparativeAnalysis = await generateComparativeAnalysis(allProcessedCases);

        // --- VISUALIZATION STEP ---
        if (options.enableVisualizer && comparativeAnalysis) {
            progressCallback?.({ step: 'visualizing', progress: 95, message: 'Generiram vizualizaciju tijeka predmeta...' });
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
        // Assuming `cleanupFiles` is defined elsewhere in pipeline.js.
        await cleanupFiles(allFilesToCleanup);
    }
}

// Keep the cleanup function as is
async function cleanupFiles(filePaths) { /* ... same as before ... */ }

module.exports = { runCourtAnalysis, runCourtAnalysisWithExistingAutomator, processScrapedCases };
