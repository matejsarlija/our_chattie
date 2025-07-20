// analysis-agent.js

require('dotenv').config();
const { Tool } = require('@langchain/core/tools');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const API_KEY = process.env.GOOGLE_API_KEY;
const gemini = new ChatGoogleGenerativeAI({ model: 'gemini-2.0-flash', apiKey: API_KEY });

async function extractTextFromFile(filePath) {
    try {
        if (filePath.endsWith('.pdf')) {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParse(dataBuffer);
            return data.text;
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

class AnalyzeDocumentsTool extends Tool {
    constructor() {
        super();
        this.name = 'analyze_documents';
        this.description = 'Analyze court documents in parallel using Gemini and extract structured info.';
    }

    async _call(input) {
        const { files, progressCallback } = input;
        
        const analysisPromises = files.map(async (file) => {
            try {
                const text = await extractTextFromFile(file.filePath);
                if (!text) {
                    throw new Error('Could not extract text from file.');
                }

                //console.log(`Analyzing text from file: ${file.filePath}, the text length is: ${text.length}`);
                // alt prompt: a medium-sized paragraph, two at most, ...
                const prompt = `From the court document text below, extract key information as a JSON object with the following keys: "caseNumber", "parties" (an array of strings), "decisionDate", and "summary" (a medium-sized paragraph, nicely formatted, to be in Croatian please, as that is what our customers speak). Text:\n\n${text.slice(0, 25000)}`;
                
                const response = await gemini.invoke(prompt);
                
                // --- THIS IS THE FIX ---
                // 1. Get the raw content from the AI.
                const rawContent = response.content;

                // 2. Clean the string by removing the Markdown wrapper.
                const cleanedContent = rawContent.replace(/```json\n|```/g, '').trim();

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

        return settledResults.map(result => {
            if (result.status === 'fulfilled') {

                console.log(`Successfully analyzed files - results - `, result.value);
                return result.value;
            } else {
                return { error: 'An unexpected error occurred during analysis.', ...result.reason };
            }
        });
    }
}

module.exports = { AnalyzeDocumentsTool };