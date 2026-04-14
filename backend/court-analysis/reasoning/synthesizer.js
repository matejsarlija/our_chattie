const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { withGeminiRetry } = require("../../helpers/geminiRetry");
const { SCHEMA_VERSION, validateReport } = require("./schema");
require("dotenv").config();

const gemini = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.2 // Low temp for factual reporting
});

/**
 * Synthesizes a structured report from the reasoning evidence package.
 * @param {object} evidencePackage 
 * @param {Array} evidencePackage.timeline
 * @param {Array} evidencePackage.claims
 * @param {object} evidencePackage.meta
 * @returns {Promise<object>} The structured report.
 */
async function synthesizeReport(evidencePackage) {
    if (!evidencePackage || (!evidencePackage.timeline && !evidencePackage.claims)) {
        return createEmptyReport("Nema dovoljno dokaza za generiranje izvješća.");
    }

    const { timeline = [], claims = [], meta = {} } = evidencePackage;

    // 1. Prepare Context
    const timelineText = timeline.map(e => `- ${e.date || 'Undated'}: ${e.description}`).join('\n');
    const claimsText = claims.map(c => `- ${c.text} (Confidence: ${c.confidence})`).join('\n');
    const partiesText = (meta.parties || []).join(', ');
    const caseNumber = meta.caseNumber || 'Unknown';

    const prompt = `
    You are a legal analyst assistant for Croatian court cases.
    Generate a final report in CROATIAN based ONLY on the following evidence.

    CASE INFO:
    Number: ${caseNumber}
    Parties: ${partiesText}

    TIMELINE OF EVENTS:
    ${timelineText || "No timeline events found."}

    VERIFIED CLAIMS:
    ${claimsText || "No verified claims found."}

    INSTRUCTIONS:
    1. Write a "narrative" summarizing the case history and status in Croatian.
    2. List key "findings" based on the claims.
    3. Identify "openQuestions" if any information is missing or ambiguous.
    4. Suggest "nextSteps" for the parties involved.

    OUTPUT FORMAT:
    Return strictly JSON with the following structure:
    {
        "narrative": "string (Croatian)",
        "findings": [
            { "text": "finding text", "confidence": "high|medium|low", "citations": [] }
        ],
        "openQuestions": ["string"],
        "nextSteps": ["string"]
    }
    `;

    try {
        const response = await withGeminiRetry(() => gemini.invoke(prompt));
        const cleanJson = response.content.replace(/```json\n?|```/g, "").trim();
        
        let parsed;
        try {
            parsed = JSON.parse(cleanJson);
        } catch (e) {
            console.error("Failed to parse synthesizer JSON:", cleanJson);
            throw new Error("Synthesizer returned invalid JSON.");
        }

        const findings = (parsed.findings || []).map((finding, index) => ({
            id: finding.id || `finding-${index + 1}`,
            text: finding.text || finding.claim || "Untitled Finding",
            confidence: finding.confidence || "medium",
            citations: Array.isArray(finding.citations) ? finding.citations : []
        }));

        const finalReport = {
            schemaVersion: SCHEMA_VERSION,
            narrative: parsed.narrative,
            openQuestions: parsed.openQuestions || [],
            nextSteps: parsed.nextSteps || [],
            conflicts: [],
            claims,
            findings: findings.length > 0 ? findings : claims.map((claim, index) => ({
                id: `finding-${index + 1}`,
                text: claim.text,
                confidence: claim.confidence || 'medium',
                citations: claim.evidence || []
            })),
            meta: {
                ...meta,
                generatedAt: new Date().toISOString()
            }
        };

        const validation = validateReport(finalReport);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        return finalReport;

    } catch (error) {
        console.error("Synthesizer failed:", error);
        throw error;
    }
}

function createEmptyReport(message) {
    return {
        schemaVersion: SCHEMA_VERSION,
        narrative: message,
        claims: [],
        findings: [],
        openQuestions: [],
        nextSteps: [],
        conflicts: [],
        meta: {
            generatedAt: new Date().toISOString()
        }
    };
}

function resolveSelectedProcessedCase(processedCases, options = {}) {
    if (!Array.isArray(processedCases) || processedCases.length === 0) {
        return null;
    }

    if (options.selectedClusterId) {
        const matched = processedCases.find((processedCase) => {
            const clusterId = processedCase?.groupMetadata?.clusterId || processedCase?.caseResult?.caseNumber;
            return clusterId === options.selectedClusterId;
        });

        if (matched) {
            return matched;
        }
    }

    return processedCases[0];
}

/**
 * Helper to convert raw pipeline output into an evidence package for synthesis.
 * @param {Array<object>} processedCases 
 * @param {object} [options]
 * @returns {object} evidencePackage
 */
function createEvidenceFromProcessedCases(processedCases, options = {}) {
    if (!Array.isArray(processedCases)) return { timeline: [], claims: [], meta: {} };

    const timeline = [];
    const claims = [];
    const parties = new Set();
    let primaryCaseNumber = null;
    const selectedProcessedCase = resolveSelectedProcessedCase(processedCases, options);

    if (!selectedProcessedCase) {
        return { timeline: [], claims: [], meta: {} };
    }

    const caseInfo = selectedProcessedCase.caseResult || {};
    if (caseInfo.caseNumber) primaryCaseNumber = caseInfo.caseNumber;
    
    if (Array.isArray(caseInfo.participants)) {
        caseInfo.participants.forEach(p => parties.add(p.name));
    }

    const analyses = selectedProcessedCase.analysis?.individualAnalyses || [];
    analyses.forEach(analysis => {
        if (analysis.aiResult) {
            const res = analysis.aiResult;
            
            if (res.decisionDate) {
                timeline.push({
                    date: res.decisionDate,
                    description: `Document Analysis: ${res.summary ? res.summary.slice(0, 100) + '...' : 'No summary'}`,
                    evidence: [{ sourceId: analysis.filePath || 'unknown', text: res.summary || '' }]
                });
            }

            if (res.summary) {
                claims.push({
                    id: `claim-${claims.length + 1}`,
                    text: res.summary,
                    confidence: 'medium',
                    evidence: [{ sourceId: analysis.filePath || 'unknown', text: res.summary }]
                });
            }
        }
    });

    return {
        timeline,
        claims,
        meta: {
            clusterId: selectedProcessedCase.groupMetadata?.clusterId || primaryCaseNumber,
            caseNumber: primaryCaseNumber,
            parties: Array.from(parties),
            identityConsistency: selectedProcessedCase.groupMetadata?.identityConsistency,
            identityNotes: selectedProcessedCase.groupMetadata?.identityNotes || []
        }
    };
}

module.exports = { synthesizeReport, createEvidenceFromProcessedCases };
