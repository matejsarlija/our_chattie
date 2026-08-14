// backend/court-analysis/agents/visualizer-agent.js
require("dotenv").config();
const { Tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { withGeminiRetry, withGeminiTimeout } = require("../../helpers/geminiRetry");
const { GEMINI_MODEL, GEMINI_API_KEY } = require("../../helpers/geminiConfig");

const gemini = new ChatGoogleGenerativeAI({
    model: GEMINI_MODEL, // Consistent with analysis agent
    apiKey: GEMINI_API_KEY,
    temperature: 0.1, // Low temperature for strict syntax adherence
});

/**
 * VisualizerTool: Transforms legal analysis text into a strictly valid Mermaid flowchart.
 */
class VisualizerTool extends Tool {
    constructor() {
        super();
        this.name = "visualize_court_analysis";
        this.description = "Generates a Mermaid flowchart representing money flow and case chronology from legal analysis text.";
    }

    async _call(analysisText) {
        console.log("[VisualizerTool] Generating diagram for analysis text...");
        const prompt = `
        You are a specialized Data Visualization Agent. Your ONLY job is to transform the provided legal analysis text into a strictly valid Mermaid flowchart.
        
        INPUT TEXT:
        ${analysisText}

        INSTRUCTIONS:
        1. Produce ONLY a Mermaid code block using 'flowchart TD'.
        2. Organize the diagram into exactly two subgraphs:
           - subgraph "Tijek novca" (Visualizing all financial movements, payments, and reservations).
           - subgraph "Kronologija i napredak" (Visualizing the sequence of court events and future steps).
        3. Use square brackets [ ] for all nodes.
        4. STRICT SYNTAX RULES:
           - ALWAYS wrap ALL node labels and edge text in double quotes. 
             CORRECT: A["Source"] -- "100 EUR" --> B["Target"]
             INCORRECT: A[Source] -- 100 EUR --> B
           - NEVER use colons (:) for labels on arrows.
           - NEVER include comments or extra text outside the code block.
        5. If no financial data is present, omit the "Tijek novca" subgraph but still produce the timeline.

        OUTPUT FORMAT:
        \`\`\`mermaid
        flowchart TD
        ...
        \`\`\`
        `;

        try {
            const response = await withGeminiRetry(() => withGeminiTimeout((signal) => gemini.invoke(prompt, { signal })));
            console.log("[VisualizerTool] Raw Mermaid Output:\n", response.content);
            return response.content;
        } catch (err) {
            console.error("[VisualizerTool] Failed to generate diagram:", err.message);
            return "Error generating diagram.";
        }
    }
}

module.exports = { VisualizerTool };
