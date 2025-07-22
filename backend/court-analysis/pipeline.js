// pipeline.js

const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
const { DownloadDocumentsTool } = require('./agents/download-agent');
const { AnalyzeDocumentsTool } = require('./agents/analysis-agent');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip'); // <-- Import the ZIP library

/**
 * Pipeline for court analysis: Scrape → Download → Unzip → Analyze
 * @param {string} searchTerm
 * @param {function} progressCallback
 */
async function runCourtAnalysis(searchTerm, progressCallback) {
    let downloadedFiles = [];
    let extractedFilePaths = []; // <-- Keep track of all files, including extracted ones

    const automator = new CourtSearchPuppeteer();

    try {
        // 1. Scrape
        progressCallback && progressCallback({ step: 'scraping', progress: 10, message: 'Searching court records...' });
        await automator.init();
        const caseData = await automator.searchAndGetFirstCaseWithDocuments(searchTerm);
        await automator.close();

        if (!caseData || !caseData.documentLinks || caseData.documentLinks.length === 0) {
            throw new Error('Nije pronađen predmet s dostupnim dokumentima za traženi pojam.');
        }

        const { caseInfo, documentLinks } = caseData;

        // 2. Download
        const downloadTool = new DownloadDocumentsTool();
        progressCallback && progressCallback({ step: 'downloading', progress: 40, message: `Found ${documentLinks.length} archive. Downloading...` });
        downloadedFiles = await downloadTool._call({ documentLinks, progressCallback });

        if (downloadedFiles.length === 0) {
            throw new Error('Found document links, but failed to download any files.');
        }

        // 3. Unzip and Prepare for Analysis
        progressCallback && progressCallback({ step: 'unzipping', progress: 60, message: 'Extracting files from archive...' });
        const filesForAnalysis = [];
        for (const file of downloadedFiles) {
            // Add the zip file itself to the cleanup list
            extractedFilePaths.push(file.filePath);

            if (file.filePath.endsWith('.zip')) {
                console.log(`Extracting from ZIP file: ${file.filePath}`);
                const zip = new AdmZip(file.filePath);
                const zipEntries = zip.getEntries();
                const extractionDir = path.dirname(file.filePath); // Extract to the same 'uploads' folder

                zipEntries.forEach((zipEntry) => {
                    // Make sure it's not a directory
                    if (!zipEntry.isDirectory) {
                        const extractedFilePath = path.join(extractionDir, zipEntry.entryName);
                        zip.extractEntryTo(zipEntry.entryName, extractionDir, false, true);

                        // Add the extracted file to the list for analysis and cleanup
                        filesForAnalysis.push({ filePath: extractedFilePath, text: zipEntry.entryName, url: file.url });
                        extractedFilePaths.push(extractedFilePath);
                        console.log(`Extracted: ${zipEntry.entryName}`);
                    }
                });
            } else {
                // If it wasn't a zip, just add it directly for analysis
                filesForAnalysis.push(file);
            }
        }

        if (filesForAnalysis.length === 0) {
            throw new Error('Downloaded archive was empty or could not be read.');
        }

        // 4. Analyze
        const analyzeTool = new AnalyzeDocumentsTool();
        progressCallback && progressCallback({ step: 'analyzing', progress: 80, message: `Analyzing ${filesForAnalysis.length} file(s)...` });

        // Pass the UNZIPPED files to the analysis tool
        const analysis = await analyzeTool._call({ files: filesForAnalysis, progressCallback });

        progressCallback && progressCallback({ step: 'complete', progress: 100, message: 'Analysis complete!' });

        //console.log('File information:', downloadedFiles);
        //console.log('Analysis Information:', analysis);

        // Return the original downloadedFiles, not the extracted ones
        return { caseResult: caseInfo, files: downloadedFiles, analysis };

    } catch (error) {
        progressCallback && progressCallback({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        await automator.close();
        // Use the new list that contains the zip AND its contents
        await cleanupFiles(extractedFilePaths);
    }
}

// Pass file paths directly to cleanup
async function cleanupFiles(filePaths) {
    if (!filePaths || filePaths.length === 0) return;
    for (const filePath of filePaths) {
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log('Cleaned up temp file:', filePath);
            } catch (err) {
                console.error('Failed to delete temp file:', filePath, err.message);
            }
        }
    }
}

module.exports = { runCourtAnalysis };