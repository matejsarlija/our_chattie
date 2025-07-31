// pipeline.js

const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
const { DownloadDocumentsTool } = require('./agents/download-agent');
// We will modify AnalyzeDocumentsTool, so we need to import it
const { AnalyzeDocumentsTool, generateComparativeAnalysis } = require('./agents/analysis-agent');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * New Pipeline for comparative court analysis: (Scrape → [Download → Unzip → Analyze] x N) → Compare
 * @param {string} searchTerm
 * @param {number} numberOfCases - How many recent cases to analyze.
 * @param {function} progressCallback
 */
async function runCourtAnalysis(searchTerm, numberOfCases = 2, progressCallback) {
    const automator = new CourtSearchPuppeteer();
    const allProcessedCases = []; // To store the results of each processed case
    let allFilesToCleanup = []; // To store all file paths for final cleanup

    try {
        // 1. Scrape for the N latest cases
        progressCallback?.({ step: 'scraping', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const casesToProcess = await automator.searchAndGetLatestCasesWithDocuments(searchTerm, numberOfCases);
        await automator.close(); // Close scraper early

        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        const totalCases = casesToProcess.length;
        progressCallback?.({ step: 'processing_setup', progress: 20, message: `Pronađeno ${totalCases} objava za analizu.` });

        const downloadTool = new DownloadDocumentsTool();
        const analyzeTool = new AnalyzeDocumentsTool();

        // 2. Loop through each case, download its files, and analyze them
        for (let i = 0; i < totalCases; i++) {
            const caseEntry = casesToProcess[i];
            const { caseInfo, documentLinks } = caseEntry;
            let downloadedFiles = [];
            let extractedFilePaths = [];

            progressCallback?.({ step: 'processing_case', progress: 25 + (i / totalCases) * 50, message: `Obrađujem objavu ${i + 1} od ${totalCases}: ${caseInfo.title}` });

            // 2a. Download
            progressCallback?.({ step: 'downloading', message: `Preuzimam arhivu za objavu ${i + 1}...` });
            downloadedFiles = await downloadTool._call({ documentLinks, progressCallback: null }); // Don't use sub-progress for now

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
            
            allFilesToCleanup.push(...extractedFilePaths); // Add this case's files to the main cleanup list

            if (filesForAnalysis.length === 0) {
                 console.warn(`No files to analyze for case ${caseInfo.title}. Skipping analysis.`);
                 // Still add the case info, but with no analysis
                 allProcessedCases.push({ caseResult: caseInfo, analysis: { individualAnalyses: [], finalSummary: "Nema dokumenata za analizu." } });
                 continue; // Move to the next case
            }

            // 2c. Analyze THIS case's documents
            progressCallback?.({ step: 'analyzing', message: `Analiziram ${filesForAnalysis.length} datoteka za objavu ${i + 1}...` });
            const analysis = await analyzeTool._call({ files: filesForAnalysis, progressCallback: null }); // Again, no sub-progress

            // Store the fully processed case data
            allProcessedCases.push({
                caseResult: caseInfo,
                // We keep the original downloaded zip for the user to download if they want
                files: downloadedFiles, 
                analysis: analysis
            });
        }

        // 3. Final Comparative Analysis (The new, smart summary step)
        progressCallback?.({ step: 'comparing', progress: 85, message: 'Generiram usporednu analizu i zaključak...' });
        const comparativeAnalysis = await generateComparativeAnalysis(allProcessedCases);

        progressCallback?.({ step: 'complete', progress: 100, message: 'Analiza je završena!' });

        return {
            processedCases: allProcessedCases,
            comparativeAnalysis: comparativeAnalysis
        };

    } catch (error) {
        progressCallback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        await automator.close();
        await cleanupFiles(allFilesToCleanup);
    }
}

/**
 * Modified version of runCourtAnalysis that uses an existing automator instance
 * This prevents creating multiple Puppeteer instances in the cron job
 */
async function runCourtAnalysisWithExistingAutomator(searchTerm, numberOfCases = 2, existingAutomator, progressCallback) {
    const allProcessedCases = [];
    let allFilesToCleanup = [];

    try {
        // 1. Use the existing automator to scrape (no init/close needed)
        progressCallback?.({ step: 'scraping', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        const casesToProcess = await existingAutomator.searchAndGetLatestCasesWithDocuments(searchTerm, numberOfCases);

        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        const totalCases = casesToProcess.length;
        progressCallback?.({ step: 'processing_setup', progress: 20, message: `Pronađeno ${totalCases} objava za analizu.` });

        const downloadTool = new DownloadDocumentsTool();
        const analyzeTool = new AnalyzeDocumentsTool();

        // 2. Loop through each case, download its files, and analyze them
        for (let i = 0; i < totalCases; i++) {
            const caseEntry = casesToProcess[i];
            const { caseInfo, documentLinks } = caseEntry;
            let downloadedFiles = [];
            let extractedFilePaths = [];

            progressCallback?.({ step: 'processing_case', progress: 25 + (i / totalCases) * 50, message: `Obrađujem objavu ${i + 1} od ${totalCases}: ${caseInfo.title}` });

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
            const analysis = await analyzeTool._call({ files: filesForAnalysis, progressCallback: null });

            // Store the fully processed case data
            allProcessedCases.push({
                caseResult: caseInfo,
                files: downloadedFiles, 
                analysis: analysis
            });
        }

        // 3. Final Comparative Analysis
        progressCallback?.({ step: 'comparing', progress: 85, message: 'Generiram usporednu analizu i zaključak...' });
        const comparativeAnalysis = await generateComparativeAnalysis(allProcessedCases);

        progressCallback?.({ step: 'complete', progress: 100, message: 'Analiza je završena!' });

        return {
            processedCases: allProcessedCases,
            comparativeAnalysis: comparativeAnalysis
        };

    } catch (error) {
        progressCallback?.({ step: 'error', progress: 100, message: error.message });
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
async function processScrapedCases(casesToProcess, progressCallback) {
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
            const analysis = await analyzeTool._call({ files: filesForAnalysis, progressCallback: null });

            allProcessedCases.push({
                caseResult: caseInfo,
                files: downloadedFiles,
                analysis: analysis
            });
        }

        // 3. Final Comparative Analysis
        progressCallback?.({ step: 'comparing', progress: 85, message: 'Generiram usporednu anailzu i zaključak...' });
        const comparativeAnalysis = await generateComparativeAnalysis(allProcessedCases);

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