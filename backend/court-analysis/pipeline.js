const { StateGraph } = require('@langchain/langgraph');
const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
const { DownloadDocumentsTool } = require('./agents/download-agent');
const { AnalyzeDocumentsTool } = require('./agents/analysis-agent');
const fs = require('fs');

/**
 * Pipeline for court analysis: Scrape → Download → Analyze
 * @param {string} searchTerm
 * @param {function} progressCallback
 * @returns {Promise<{caseResult: object, files: array, analysis: object}>}
 */
async function runCourtAnalysis(searchTerm, progressCallback) {
    let files = [];
    try {
        // 1. Scrape (not a LangChain tool, just a function)
        progressCallback && progressCallback({ step: 'scraping', progress: 20, message: 'Searching court records...' });
        const automator = new CourtSearchPuppeteer();
        await automator.init();
        const caseResult = await automator.searchFirstWithDocuments(searchTerm);
        await automator.close();
        if (!caseResult) throw new Error('No results with documents found for this search term.');

        // 2. Download (LangChain Tool)
        const downloadTool = new DownloadDocumentsTool();
        progressCallback && progressCallback({ step: 'downloading', progress: 50, message: 'Downloading documents...' });
        files = await downloadTool._call({ documentLinks: caseResult.documentLinks, progressCallback });

        // 3. Analyze (LangChain Tool)
        const analyzeTool = new AnalyzeDocumentsTool();
        progressCallback && progressCallback({ step: 'analyzing', progress: 80, message: 'Analyzing case files...' });
        const analysis = await analyzeTool._call({ files, progressCallback });

        progressCallback && progressCallback({ step: 'complete', progress: 100, message: 'Analysis complete!' });
        await cleanupFiles(files);
        return { caseResult, files, analysis };
    } catch (error) {
        progressCallback && progressCallback({ step: 'error', progress: 100, message: error.message });
        await cleanupFiles(files);
        throw error;
    }
}

async function cleanupFiles(files) {
    for (const file of files) {
        if (file.filePath && fs.existsSync(file.filePath)) {
            try {
                fs.unlinkSync(file.filePath);
            } catch (err) {
                // Log but don't throw
                console.error('Failed to delete temp file:', file.filePath, err.message);
            }
        }
    }
}

module.exports = { runCourtAnalysis };
