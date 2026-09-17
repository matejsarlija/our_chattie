// backend/court-analysis/agents/visualizer-agent.js
require("dotenv").config();
const { Tool } = require("@langchain/core/tools");
const { withGeminiRetry, withGeminiTimeout } = require("../../helpers/geminiRetry");
const { trackGeminiInvoke } = require("../../helpers/geminiUsage");
const { createGeminiClient } = require("../../helpers/geminiConfig");
const agentLog = require("../../helpers/agentLog");

const gemini = createGeminiClient("visualizer");

/**
 * VisualizerTool: Transforms legal analysis text into a strictly valid Mermaid flowchart.
 */
class VisualizerTool extends Tool {
    constructor() {
        super();
        this.name = "visualize_court_analysis";
        this.description = "Generates a Mermaid flowchart representing money flow and case chronology from legal analysis text.";
    }

    async _call(analysisText, options = {}) {
        agentLog.log("[VisualizerTool] Generating diagram for analysis text...");

        // Guard: an empty/error placeholder carries no analyzable substance and
        // must not be sent to the model (it would only emit an empty stub).
        const usableText = String(analysisText || "").trim();
        const USELESS_RE = /gre[šs]ka pri generiranju|nema dostupnih podataka za generiranje analize|analiza dokumenata nije uspje[šs]no izvr[šs]ena|nema dovoljno dokaza/i;
        if (!usableText || USELESS_RE.test(usableText)) {
            agentLog.warn("[VisualizerTool] Skipping diagram generation: input text is empty or a failure placeholder.");
            return "Error generating diagram.";
        }

        // Track 3c: structured money-flow entries (when present) give the
        // "Tijek novca" subgraph deterministic, real financial content instead
        // of relying on the model to spot amounts inside free-text prose.
        const moneyFlow = Array.isArray(options.moneyFlow?.entries)
            ? options.moneyFlow.entries
            : [];
        const moneyFlowBlock = moneyFlow.length > 0
            ? `\n\nSTRUCTURED MONEY-FLOW DATA (use only as financial source material for the "Tijek novca" subgraph):\n${moneyFlow.map((entry, index) =>
                `- ${entry.amount} ${entry.currency || '?'}${entry.description ? ` — ${entry.description}` : ''}${entry.date ? ` (${entry.date})` : ''}${entry.from ? ` from ${entry.from}` : ''}${entry.to ? ` to ${entry.to}` : ''}${entry.fileName ? ` [source: ${entry.fileName}]` : ''}`
            ).join('\n')}`
            : '';

        // Property flow: parallel structured surface feeding the "Tijek imovine"
        // subgraph. Tražbina entries linked via supersedes render as a
        // directional chain (original holder → assignee), not disconnected nodes.
        const propertyFlow = Array.isArray(options.propertyFlow?.entries)
            ? options.propertyFlow.entries
            : [];
        const propertyFlowBlock = propertyFlow.length > 0
            ? `\n\nSTRUCTURED PROPERTY-FLOW DATA (use only as asset source material for the "Tijek imovine" subgraph; render "tražbina" supersedes links as a directional chain original-holder → assignee):\n${propertyFlow.map((entry) =>
                `- ${entry.value ?? '?'} ${entry.currency || '?'} [${entry.assetType || 'drugo'}]${entry.eventType ? ` {${entry.eventType}}` : ''} — ${entry.description || 'bez opisa'}${entry.transferor || entry.transferee ? ` (${entry.transferor || '?'} → ${entry.transferee || '?'})` : ''}${entry.date ? ` (${entry.date})` : ''}${entry.supersedes ? ` [supersedes: ${entry.supersedes}]` : ''}${entry.fileName ? ` [source: ${entry.fileName}]` : ''}`
            ).join('\n')}`
            : '';

        const subgraphInstructions = propertyFlow.length > 0
            ? `2. Organize the diagram into exactly three subgraphs:
           - subgraph "Tijek novca" (Visualizing all financial movements, payments, and reservations).
           - subgraph "Tijek imovine" (Visualizing all property/asset transfers from the STRUCTURED PROPERTY-FLOW DATA, including tražbina cession chains).
           - subgraph "Kronologija i napredak" (Visualizing the sequence of court events and future steps).`
            : `2. Organize the diagram into exactly two subgraphs:
           - subgraph "Tijek novca" (Visualizing all financial movements, payments, and reservations).
           - subgraph "Kronologija i napredak" (Visualizing the sequence of court events and future steps).`;

        const prompt = `
        You are a specialized Data Visualization Agent. Your ONLY job is to transform the provided legal analysis text into a strictly valid Mermaid flowchart.
        
        INPUT TEXT:
        ${usableText}${moneyFlowBlock}${propertyFlowBlock}

        INSTRUCTIONS:
        1. Produce ONLY a Mermaid code block using 'flowchart TD'.
        ${subgraphInstructions}
        3. Use square brackets [ ] for all nodes.
        4. STRICT SYNTAX RULES:
           - ALWAYS wrap ALL node labels and edge text in double quotes. 
             CORRECT: A["Source"] -- "100 EUR" --> B["Target"]
             INCORRECT: A[Source] -- 100 EUR --> B
           - NEVER use colons (:) for labels on arrows.
           - NEVER include comments or extra text outside the code block.
        5. If no financial data is present, omit the "Tijek novca" subgraph but still produce the timeline.
        6. If no property data is present, omit the "Tijek imovine" subgraph entirely — never emit an empty or placeholder property subgraph.

        OUTPUT FORMAT:
        \`\`\`mermaid
        flowchart TD
        ...
        \`\`\`
        `;

        try {
            const response = await withGeminiRetry(() => withGeminiTimeout((signal) => trackGeminiInvoke(gemini, prompt, { signal, tracker: options.tracker, onUsage: options.onUsage })));
            agentLog.log("[VisualizerTool] Raw Mermaid Output:\n", response.content);
            return response.content;
        } catch (err) {
            agentLog.error("[VisualizerTool] Failed to generate diagram:", err.message);
            return "Error generating diagram.";
        }
    }
}

module.exports = { VisualizerTool };
