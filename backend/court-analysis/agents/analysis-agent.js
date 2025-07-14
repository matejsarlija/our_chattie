require('dotenv').config();
const { Tool } = require('@langchain/core/tools');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const API_KEY = process.env.GOOGLE_API_KEY;

// Gemini LLM setup (requires GOOGLE_API_KEY in env)
const gemini = new ChatGoogleGenerativeAI({ model: 'gemini-2.5-flash', apiKey: API_KEY  });

async function extractTextFromFile(filePath) {
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
    return '';
}

// LangChain Tool for analyzing documents with Gemini
class AnalyzeDocumentsTool extends Tool {
    constructor() {
        super();
        this.name = 'analyze_documents';
        this.description = 'Analyze court documents using Gemini and extract structured info.';
    }
    /**
     * @param {{files: Array<{filePath: string, url: string, text: string}>, progressCallback?: function}} input
     * @returns {Promise<Array<{filePath: string, url: string, text: string, aiResult: object}>>}
     */
    async _call(input) {
        const { files, progressCallback } = input;
        const results = [];
        let completed = 0;
        for (const file of files) {
            try {
                const text = await extractTextFromFile(file.filePath);
                const prompt = `Extract the following from the court document text:\n- Case number\n- Parties\n- Date\n- Summary\n\nText:\n${text.slice(0, 4000)}`;
                const response = await gemini.invoke(prompt);
                results.push({ ...file, aiResult: response });
                completed++;
                progressCallback && progressCallback({ step: 'analyzing', progress: 80 + Math.round((completed / files.length) * 20), message: `Analyzed: ${file.text}` });
            } catch (err) {
                results.push({ ...file, aiResult: null, error: err.message });
            }
        }
        return results;
    }
}

module.exports = { AnalyzeDocumentsTool };
