// analysis-agent.js

require("dotenv").config();
const { Tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const fs = require("fs");
const os = require("os");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { splitTextIntoChunks } = require("../reasoning/chunker");

const API_KEY = process.env.GOOGLE_API_KEY;
const gemini = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: API_KEY,
});

const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { withGeminiRetry, withGeminiTimeout } = require("../../helpers/geminiRetry");

// 2. Explicitly set the path to the worker script for Node.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
    require.resolve("pdfjs-dist/build/pdf.worker.js");

const { createCanvas } = require("canvas");

const DIRECT_TEXT_LIMIT = 25000;
const CHUNKING_TRIGGER_TEXT_LENGTH = 25000;
const ANALYSIS_CHUNK_SIZE = 3500;
const ANALYSIS_CHUNK_OVERLAP = 350;
const ANALYSIS_RETRIEVAL_LIMIT = 6;

function buildRetrievalTerms(caseInfo = {}, file = {}) {
    const terms = new Set();
    if (caseInfo.caseNumber) terms.add(String(caseInfo.caseNumber).toLowerCase());
    if (file.text) terms.add(String(file.text).toLowerCase());
    if (file.url) terms.add(String(file.url).toLowerCase());

    (caseInfo.participants || []).forEach((participant) => {
        if (participant?.name) terms.add(String(participant.name).toLowerCase());
        if (participant?.oib) terms.add(String(participant.oib).toLowerCase());
    });

    return Array.from(terms).filter(Boolean);
}

function rankChunksForAnalysis(chunks = [], retrievalTerms = []) {
    return chunks
        .map((chunk, index) => {
            const lowerText = String(chunk.text || "").toLowerCase();
            const lexicalHits = retrievalTerms.reduce((hits, term) => {
                if (!term) return hits;
                return lowerText.includes(term) ? hits + 1 : hits;
            }, 0);

            return {
                chunk,
                score: lexicalHits,
                index,
            };
        })
        .sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            return a.index - b.index;
        });
}

function buildAnalysisInputText(text, caseInfo, file) {
    if (!text || text.length <= CHUNKING_TRIGGER_TEXT_LENGTH) {
        return {
            analysisText: String(text || "").slice(0, DIRECT_TEXT_LIMIT),
            usedChunking: false,
            chunkCount: 0,
            retrievedChunkCount: 0,
        };
    }

    const docId = path.basename(file?.filePath || file?.text || "analysis-doc");
    const chunks = splitTextIntoChunks(text, {
        chunkSize: ANALYSIS_CHUNK_SIZE,
        chunkOverlap: ANALYSIS_CHUNK_OVERLAP,
        docId,
    });

    if (!chunks || chunks.length === 0) {
        return {
            analysisText: text.slice(0, DIRECT_TEXT_LIMIT),
            usedChunking: false,
            chunkCount: 0,
            retrievedChunkCount: 0,
        };
    }

    const retrievalTerms = buildRetrievalTerms(caseInfo, file);
    const ranked = rankChunksForAnalysis(chunks, retrievalTerms);
    const selected = ranked
        .slice(0, ANALYSIS_RETRIEVAL_LIMIT)
        .map(({ chunk }) => chunk);

    const analysisText = selected
        .map(
            (chunk, index) =>
                `[Chunk ${index + 1} | ${chunk.id || "no-id"}]\n${chunk.text}`,
        )
        .join("\n\n")
        .slice(0, DIRECT_TEXT_LIMIT);

    return {
        analysisText,
        usedChunking: true,
        chunkCount: chunks.length,
        retrievedChunkCount: selected.length,
    };
}

async function extractTextFromFile(filePath) {
    try {
        if (filePath.endsWith(".pdf")) {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);
            return data?.text || "";
        }
        if (filePath.endsWith(".docx")) {
            const result = await mammoth.extractRawText({ path: filePath });
            return result.value;
        }
        if (filePath.endsWith(".txt")) {
            return fs.readFileSync(filePath, "utf8");
        }
    } catch (error) {
        console.error(
            `Failed to extract text from ${filePath}:`,
            error.message,
        );
        return "";
    }
    return "";
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
async function extractTextViaOCR(filePath, progressCallback) {
    console.log(
        `[OCR] Attempting OCR for ${path.basename(filePath)} with pdf.js`,
    );
    let combinedText = "";

    try {
        const data = new Uint8Array(fs.readFileSync(filePath));
        const pdf = await pdfjsLib.getDocument(data).promise;
        const numPages = pdf.numPages;

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale = higher resolution image
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext("2d");

            await page.render({ canvasContext: context, viewport: viewport })
                .promise;

            const imageBuffer = canvas.toBuffer("image/png");
            const imageAsBase64 = imageBuffer.toString("base64");

            const message = new HumanMessage({
                content: [
                    {
                        type: "text",
                        text: "Extract all text from this document image. Provide only the raw text.",
                    },
                    {
                        type: "image_url",
                        image_url: `data:image/png;base64,${imageAsBase64}`,
                    },
                ],
            });

            const response = await withGeminiRetry(
                () => withGeminiTimeout((signal) => gemini.invoke([message], { signal })),
                {
                    onRetry: ({ attempt, delayMs }) => {
                        progressCallback &&
                            progressCallback({
                                step: "ocr_retry",
                                message: `OCR retry ${attempt}. Waiting ${Math.round(delayMs / 1000)}s...`,
                            });
                    },
                },
            );
            combinedText += response.content + "\n\n";
        }
    } catch (err) {
        console.error(`[OCR] Failed during OCR process for ${filePath}:`, err);
        return ""; // Return empty string on failure
    }

    console.log(
        `[OCR] Successfully extracted ~${combinedText.length} characters.`,
    );
    return combinedText;
}

class AnalyzeDocumentsTool extends Tool {
    constructor() {
        super();
        this.name = "analyze_documents_for_one_case";
        this.description =
            "Analyzes a set of documents related to a single court case entry and returns structured info for each.";
    }

    async _call(input) {
        const { files, caseInfo, progressCallback } = input;

        const analysisPromises = files.map(async (file) => {
            try {
                let text = await extractTextFromFile(file.filePath);

                // If initial extraction fails, try OCR for PDFs
                if (
                    (!text || text.trim().length === 0) &&
                    file.filePath.toLowerCase().endsWith(".pdf")
                ) {
                    console.log(
                        `[Analyzer] Standard text extraction failed for ${path.basename(file.filePath)}. Falling back to OCR.`,
                    );
                    text = await extractTextViaOCR(file.filePath, progressCallback);
                }

                // Final check: if still no text, return error, file failed analysis
                if (!text || text.trim().length === 0) {
                    // tu si možemo dodati hrvatski tekst za bolje error messagese za korisnike
                    throw new Error(
                        "Could not extract text from file. It may be empty, corrupted, or an image-based document.",
                    );
                }

                //console.log('Case info for analysis:', caseInfo);

                const knownParties = caseInfo.participants
                    ? caseInfo.participants.map(p => {
                        let info = `- ${p.name} (${p.role})`;
                        if (p.companyData) {
                            const cd = p.companyData;
                            info += `\n  - Official Name: ${cd.officialName}`;
                            info += `\n  - Status: ${cd.status === 1 ? 'Active' : cd.status === 5 ? 'Deleted' : cd.status}`;
                            if (cd.lastFinancialReportYear) info += `\n  - Last GFI Year: ${cd.lastFinancialReportYear}`;
                            if (cd.founders) info += `\n  - Founders: ${cd.founders}`;
                            if (cd.directors) info += `\n  - Directors: ${cd.directors}`;
                        }
                        return info;
                    }).join('\n')
                    : "Participant information was not available from the source page.";

                const analysisInput = buildAnalysisInputText(text, caseInfo, file);
                if (analysisInput.usedChunking) {
                    progressCallback &&
                        progressCallback({
                            step: "chunking",
                            message: `Chunked ${file.text} into ${analysisInput.chunkCount} chunks.`,
                        });
                    progressCallback &&
                        progressCallback({
                            step: "retrieving",
                            message: `Retrieved ${analysisInput.retrievedChunkCount} relevant chunks for ${file.text}.`,
                        });
                }

                //console.log(`Analyzing text from file: ${file.filePath}, the text length is: ${text.length}`);
                // alt prompt: a medium-sized paragraph, two at most, ...
                const prompt = `The main participants in this case are:\n${knownParties}\n
                The participants include enriched registry data. Use this to determine if a company is active, in bankruptcy, or has failed to file financial reports (GFI) recently.

                From the court document text below, extract key information as a JSON object with the following keys: "caseNumber", "decisionDate", and "summary" (a medium-sized paragraph, nicely formatted, to be in Croatian please, as that is what our customers speak).
                Do include any important figures (currency amounts) you find in the summary. Provide ONLY the json object and nothing else. Text:\n\n${analysisInput.analysisText}`;

                const response = await withGeminiRetry(
                    () => withGeminiTimeout((signal) => gemini.invoke(prompt, { signal })),
                    {
                        onRetry: ({ attempt, delayMs }) => {
                            progressCallback &&
                                progressCallback({
                                    step: "analyze_retry",
                                    message: `Retry ${attempt} for ${file.text}. Waiting ${Math.round(delayMs / 1000)}s...`,
                                });
                        },
                    },
                );

                // --- THIS IS THE FIX ---
                // 1. Get the raw content from the AI.
                const rawContent = response.content;

                // 2. Clean the string by removing the Markdown wrapper.
                const cleanedContent = rawContent
                    .replace(/```json\n|```/g, "")
                    .trim();

                // Added an extra check to see if the response looks like JSON before parsing
                if (
                    !cleanedContent.startsWith("{") ||
                    !cleanedContent.endsWith("}")
                ) {
                    throw new Error(
                        `AI returned non-JSON response: "${cleanedContent.slice(0, 100)}..."`,
                    );
                }

                // 3. Parse the CLEANED string.
                const aiResultPartial = JSON.parse(cleanedContent);

                const aiResult = {
                    ...aiResultPartial,
                    // Inject the reliably scraped parties into the final result object.
                    parties: caseInfo.participants || [],
                };
                // END of fix

                // added by a human
                console.log(
                    `Analyzed file ${file.filePath}, AI result:`,
                    aiResult,
                );

                progressCallback &&
                    progressCallback({
                        step: "analyzing",
                        message: `Analyzed: ${file.text}`,
                    });
                return { ...file, aiResult };
            } catch (err) {
                console.error(
                    `Error analyzing file ${file.filePath}:`,
                    err.message,
                );
                progressCallback &&
                    progressCallback({
                        step: "analyzing",
                        message: `Failed to analyze: ${file.text}`,
                    });
                return { ...file, aiResult: null, error: err.message };
            }
        });

        const settledResults = await Promise.allSettled(analysisPromises);

        const individualAnalyses = settledResults.map((result) => {
            if (result.status === "fulfilled") {
                return result.value;
            } else {
                return {
                    error: "An unexpected error occurred during analysis.",
                    ...result.reason,
                };
            }
        });

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
            .filter((f) => f.aiResult && f.aiResult.summary)
            .map((f) => f.aiResult.summary)
            .join("\n\n---\n\n");

        if (!successfulSummaries) {
            return "Analiza dokumenata nije uspješno izvršena za jedinu pronađenu objavu.";
        }

        // Old prompt was:
        const prompt = `Synthesize the following summaries into a coherent overview (in Croatian):\n\n${successfulSummaries}. 
        Try to extrapolate what might happen next in the case going forward, and what the next steps are for the parties involved.`;

        // The prompt is slightly different: it asks for a deep dive and next steps, not a comparison.
        //const prompt = `This is the only recent court entry found. Synthesize the following document summaries into a single, coherent, and detailed overview IN CROATIAN. Explain the significance of this entry in the context of the case. Based on the information, what are the likely next steps for the parties involved?\n\nSUMMARIES:\n${successfulSummaries}`;

        try {
            const response = await withGeminiRetry(() => withGeminiTimeout((signal) => gemini.invoke(prompt, { signal })));
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
            .filter((f) => f.aiResult && f.aiResult.summary)
            .map((f) => f.aiResult.summary)
            .join("\n");

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

    const prompt = `Synthesize the following ${allProcessedCases.length} summaries into a coherent overview, in Croatian. Try to predict the most likely developments in the case, as well as what the next steps are for the parties involved.
    Here is the data:\n${comparativeContext}.`;

    //console.log("Comparative context contains the following data:", comparativeContext);

    try {
        const response = await withGeminiRetry(() => withGeminiTimeout((signal) => gemini.invoke(prompt, { signal })));
        return response.content;
    } catch (err) {
        console.error("Failed to generate comparative analysis:", err);
        return "Greška pri generiranju usporedne analize.";
    }
}

module.exports = { AnalyzeDocumentsTool, generateComparativeAnalysis };
