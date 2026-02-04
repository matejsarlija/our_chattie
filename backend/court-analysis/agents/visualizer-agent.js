// backend/court-analysis/agents/visualizer-agent.js
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const gemini = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash", // Using 2.0-flash for speed and reliability in formatting
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.1, // Low temperature for strict syntax adherence
});

/**
 * VisualizerAgent: Transforms legal analysis text into a strictly valid Mermaid flowchart.
 */
class VisualizerAgent {
    async generateDiagram(analysisText) {
        console.log("[VisualizerAgent] Generating diagram for analysis text...");
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
            const response = await gemini.invoke(prompt);
            console.log("[VisualizerAgent] Raw Mermaid Output:\n", response.content);
            return response.content;
        } catch (err) {
            console.error("[VisualizerAgent] Failed to generate diagram:", err.message);
            return null;
        }
    }
}

module.exports = new VisualizerAgent();
