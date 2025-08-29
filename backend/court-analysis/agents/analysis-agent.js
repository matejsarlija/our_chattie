// analysis-agent.js

require('dotenv').config();
const { Tool } = require('@langchain/core/tools');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage } = require("@langchain/core/messages");
const fs = require('fs');
const os = require('os');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const API_KEY = process.env.GOOGLE_API_KEY;
const gemini = new ChatGoogleGenerativeAI({ model: 'gemini-2.0-flash', apiKey: API_KEY });

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// 2. Explicitly set the path to the worker script for Node.js
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.js');

const { createCanvas } = require('canvas');

async function extractTextFromFile(filePath) {
    try {
        if (filePath.endsWith('.pdf')) {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);
            return data?.text || '';
        }
        if (filePath.endsWith('.docx')) {
            const result = await mammoth.extractRawText({ path: filePath });
            return result.value;
        }
        if (filePath.endsWith('.txt')) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch (error) {
        console.error(`Failed to extract text from ${filePath}:`, error.message);
        return '';
    }
    return '';
}

// --- NEW OCR FALLBACK FUNCTION ---
/**
 * Extracts text from an image-based PDF using Gemini directly.
 * @param {string} filePath The path to the PDF file.
 * @returns {Promise<string>} The combined text from all pages.
 */
/**
 * Extracts text from an image-based PDF using pdf.js and Gemini Vision.
 * This method has NO external system dependencies like Ghostscript.
 * @param {string} filePath The path to the PDF file.
 * @returns {Promise<string>} The combined text from all pages.
 */
async function extractTextViaOCR(filePath) {
    console.log(`[OCR] Attempting OCR for ${path.basename(filePath)} with pdf.js`);
    let combinedText = '';

    try {
        const data = new Uint8Array(fs.readFileSync(filePath));
        const pdf = await pdfjsLib.getDocument(data).promise;
        const numPages = pdf.numPages;

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale = higher resolution image
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext('2d');

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const imageBuffer = canvas.toBuffer('image/png');
            const imageAsBase64 = imageBuffer.toString('base64');

            const message = new HumanMessage({
                content: [
                    { type: "text", text: "Extract all text from this document image. Provide only the raw text." },
                    { type: "image_url", image_url: `data:image/png;base64,${imageAsBase64}` },
                ],
            });

            const response = await gemini.invoke([message]);
            combinedText += response.content + '\n\n';
        }
    } catch (err) {
        console.error(`[OCR] Failed during OCR process for ${filePath}:`, err);
        return ''; // Return empty string on failure
    }

    console.log(`[OCR] Successfully extracted ~${combinedText.length} characters.`);
    return combinedText;
}


class AnalyzeDocumentsTool extends Tool {
    constructor() {
        super();
        this.name = 'analyze_documents_for_one_case';
        this.description = 'Analyzes a set of documents related to a single court case entry and returns structured info for each.';
    }

    async _call(input) {
        const { files, progressCallback } = input;

        const analysisPromises = files.map(async (file) => {
            try {
                let text = await extractTextFromFile(file.filePath);

                // If initial extraction fails, try OCR for PDFs
                if ((!text || text.trim().length === 0) && file.filePath.toLowerCase().endsWith('.pdf')) {
                    console.log(`[Analyzer] Standard text extraction failed for ${path.basename(file.filePath)}. Falling back to OCR.`);
                    text = await extractTextViaOCR(file.filePath);
                }

                // Final check: if still no text, return error, file failed analysis
                if (!text || text.trim().length === 0) {
                    // tu si možemo dodati hrvatski tekst za bolje error messagese za korisnike
                    throw new Error('Could not extract text from file. It may be empty, corrupted, or an image-based document.');
                }

                //console.log(`Analyzing text from file: ${file.filePath}, the text length is: ${text.length}`);
                // alt prompt: a medium-sized paragraph, two at most, ...
                const prompt = `From the court document text below, extract key information as a JSON object with the following keys: "caseNumber", "parties" (an array of strings), "decisionDate", and "summary" (a medium-sized paragraph, nicely formatted, to be in Croatian please, as that is what our customers speak).
                Do include any important figures (currency amounts) you find in the summary. Text:\n\n${text.slice(0, 25000)}`;

                const response = await gemini.invoke(prompt);

                // --- THIS IS THE FIX ---
                // 1. Get the raw content from the AI.
                const rawContent = response.content;

                // 2. Clean the string by removing the Markdown wrapper.
                const cleanedContent = rawContent.replace(/```json\n|```/g, '').trim();

                // Added an extra check to see if the response looks like JSON before parsing
                if (!cleanedContent.startsWith('{') || !cleanedContent.endsWith('}')) {
                    throw new Error(`AI returned non-JSON response: "${cleanedContent.slice(0, 100)}..."`);
                }

                // 3. Parse the CLEANED string.
                const aiResult = JSON.parse(cleanedContent);
                // --- END OF FIX ---

                // added by a human
                console.log(`Analyzed file ${file.filePath}, AI result:`, aiResult);

                progressCallback && progressCallback({ step: 'analyzing', message: `Analyzed: ${file.text}` });
                return { ...file, aiResult };

            } catch (err) {
                console.error(`Error analyzing file ${file.filePath}:`, err.message);
                progressCallback && progressCallback({ step: 'analyzing', message: `Failed to analyze: ${file.text}` });
                return { ...file, aiResult: null, error: err.message };
            }
        });

        const settledResults = await Promise.allSettled(analysisPromises);

        const individualAnalyses = settledResults.map(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return { error: 'An unexpected error occurred during analysis.', ...result.reason };
            }
        }
        );

        return {
            individualAnalyses: individualAnalyses,
        };
    }
}

// --- NEW FUNCTION FOR THE FINAL STEP ---

/**
 * Generates a high-level comparative analysis or a detailed summary.
 * @param {Array<object>} allProcessedCases - The array of fully processed cases from the pipeline.
 * @returns {Promise<string>} The final comparative analysis text.
 */
async function generateComparativeAnalysis(allProcessedCases) {
    if (!allProcessedCases || allProcessedCases.length === 0) {
        return "Nema dostupnih podataka za generiranje analize.";
    }

    // --- SCENARIO 1: Only ONE case entry was processed ---
    if (allProcessedCases.length === 1) {
        const singleCase = allProcessedCases[0];
        const successfulSummaries = singleCase.analysis.individualAnalyses
            .filter(f => f.aiResult && f.aiResult.summary)
            .map(f => f.aiResult.summary)
            .join('\n\n---\n\n');

        if (!successfulSummaries) {
            return "Analiza dokumenata nije uspješno izvršena za jedinu pronađenu objavu.";
        }

        // Old prompt was:
        const prompt = `Synthesize the following summaries into a coherent overview (in Croatian):\n\n${successfulSummaries}. Try to extrapolate what might happen next in the case going forward, and what the next steps are for the parties involved.`;

        // The prompt is slightly different: it asks for a deep dive and next steps, not a comparison.
        //const prompt = `This is the only recent court entry found. Synthesize the following document summaries into a single, coherent, and detailed overview IN CROATIAN. Explain the significance of this entry in the context of the case. Based on the information, what are the likely next steps for the parties involved?\n\nSUMMARIES:\n${successfulSummaries}`;

        try {
            const response = await gemini.invoke(prompt);
            return response.content;
        } catch (err) {
            console.error("Failed to generate summary for single case:", err);
            return "Greška pri generiranju završnog sažetka.";
        }
    }

    // --- SCENARIO 2: MULTIPLE case entries were processed ---
    // This is where the real comparison happens.
    let comparativeContext = "";
    allProcessedCases.forEach((processedCase, index) => {
        const caseInfo = processedCase.caseResult;
        const summaries = processedCase.analysis.individualAnalyses
            .filter(f => f.aiResult && f.aiResult.summary)
            .map(f => f.aiResult.summary)
            .join('\n');

        comparativeContext += `--- Case Entry ${index + 1} ---\n`;
        comparativeContext += `Title: ${caseInfo.title}\n`;
        comparativeContext += `Date: ${caseInfo.date}\n`;
        comparativeContext += `Summary of Documents:\n${summaries}\n\n`;
    });

    // const prompt = `You are a legal analyst assistant. Below are summaries from documents of ${allProcessedCases.length} different court entries for the same case. Please provide a comparative analysis IN CROATIAN.
    // Your analysis should:
    // 1.  Start by focusing on the most recent entry, explaining its significance.
    // 2.  Compare it to the previous entry/entries, highlighting what has changed or progressed.
    // 3.  Synthesize the information into a single, overarching narrative of what has happened.
    // 4.  Based on the entire history, predict the most likely next steps or future developments in the case.

    // Here is the data:
    // ${comparativeContext}`;

    const prompt = `Synthesize the following ${allProcessedCases.length} summaries into a coherent overview, in Croatian. Try to predict the most likely developments in the case, as well as the next steps are for the parties involved.
    Here is the data:\n${comparativeContext}`;

    //console.log("Comparative context contains the following data:", comparativeContext);

    try {
        const response = await gemini.invoke(prompt);
        return response.content;
    } catch (err) {
        console.error("Failed to generate comparative analysis:", err);
        return "Greška pri generiranju usporedne analize.";
    }
}


module.exports = { AnalyzeDocumentsTool, generateComparativeAnalysis };