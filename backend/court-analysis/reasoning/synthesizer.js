require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { withGeminiRetry, withGeminiTimeout } = require("../../helpers/geminiRetry");
const { GEMINI_MODEL, GEMINI_API_KEY } = require("../../helpers/geminiConfig");
const { SCHEMA_VERSION, validateReport } = require("./schema");
const { validateClusterEvidencePackage } = require("./evidencePackage");
const {
    isPoorDocumentCoverage,
    coverageOpenQuestion,
    applyCoverageConfidenceGuard
} = require("./coverageGuard");

const gemini = new ChatGoogleGenerativeAI({
    model: GEMINI_MODEL,
    apiKey: GEMINI_API_KEY,
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
    if (!evidencePackage) {
        return createEmptyReport("Nema dovoljno dokaza za generiranje izvješća.");
    }

    const normalizedEvidence = normalizeReasoningEvidence(evidencePackage);
    if (!normalizedEvidence || (!normalizedEvidence.timeline && !normalizedEvidence.claims)) {
        return createEmptyReport("Nema dovoljno dokaza za generiranje izvješća.");
    }

    const { timeline = [], claims = [], meta = {} } = normalizedEvidence;

    // 1. Prepare Context
    const timelineText = timeline.map(e => `- ${e.date || 'Undated'}: ${e.description}`).join('\n');
    const claimsText = claims.map(c => `- ${c.text} (Confidence: ${c.confidence})`).join('\n');
    const partiesText = (meta.parties || []).join(', ');
    const caseNumber = meta.caseNumber || 'Unknown';
    const poorDocumentCoverage = isPoorDocumentCoverage(meta.coverage);
    const coverageInstruction = poorDocumentCoverage
        ? `\n    DOCUMENT COVERAGE WARNING: Only ${meta.coverage.analyzed || 0} of ${meta.coverage.total || 0} documents were analyzed successfully. Titles and links are structural metadata only. Do not make substantive findings from them; express those as open questions or use low confidence unless a finding cites analyzed document content.\n`
        : '';

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
    ${coverageInstruction}

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
        const response = await withGeminiRetry(() => withGeminiTimeout((signal) => gemini.invoke(prompt, { signal })));
        const cleanJson = response.content.replace(/```json\n?|```/g, "").trim();
        
        let parsed;
        try {
            parsed = JSON.parse(cleanJson);
        } catch (e) {
            console.error("Failed to parse synthesizer JSON:", cleanJson);
            throw new Error("Synthesizer returned invalid JSON.");
        }

        const findings = applyCoverageConfidenceGuard((parsed.findings || []).map((finding, index) => ({
            id: finding.id || `finding-${index + 1}`,
            text: finding.text || finding.claim || "Untitled Finding",
            confidence: finding.confidence || "medium",
            citations: Array.isArray(finding.citations) ? finding.citations : []
        })), normalizedEvidence);

        const openQuestions = [...(parsed.openQuestions || [])];
        if (poorDocumentCoverage && !openQuestions.includes(coverageOpenQuestion(meta.coverage))) {
            openQuestions.push(coverageOpenQuestion(meta.coverage));
        }

        const finalReport = {
            schemaVersion: SCHEMA_VERSION,
            narrative: parsed.narrative,
            openQuestions,
            nextSteps: parsed.nextSteps || [],
            conflicts: [],
            claims,
            findings: findings.length > 0 ? findings : applyCoverageConfidenceGuard(claims.map((claim, index) => ({
                id: `finding-${index + 1}`,
                text: claim.text,
                confidence: claim.confidence || 'medium',
                citations: claim.evidence || []
            })), normalizedEvidence),
            timeline: buildReportTimeline(timeline),
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

function normalizeReasoningEvidence(evidencePackage) {
    if (evidencePackage?.packageType === 'ClusterEvidencePackage') {
        return createReasoningEvidenceFromPackage(evidencePackage);
    }

    return evidencePackage;
}

function buildReportTimeline(timeline) {
    if (!Array.isArray(timeline)) return [];

    return timeline.map((event) => {
        const citations = (event.evidence || []).map((evidence) => {
            const citation = {};
            if (evidence.sourceId) citation.source = evidence.sourceId;
            if (evidence.text) citation.text = evidence.text;
            if (evidence.url) citation.url = evidence.url;
            if (evidence.provenance) citation.provenance = evidence.provenance;
            return citation;
        });

        return {
            date: event.date ?? null,
            description: event.description || 'Objava',
            citations
        };
    });
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
        timeline: [],
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

function collectPackageParties(pkg) {
    const parties = new Set(pkg.identity?.participantNames || []);

    for (const entry of pkg.entries || []) {
        for (const participant of entry.participants || []) {
            if (participant?.name) {
                parties.add(participant.name);
            }
        }
    }

    return Array.from(parties);
}

function buildPackageMeta(pkg) {
    return {
        packageType: pkg.packageType,
        packageSchemaVersion: pkg.schemaVersion,
        clusterId: pkg.clusterId,
        caseNumber: pkg.primaryCaseNumber || pkg.clusterId,
        parties: collectPackageParties(pkg),
        query: pkg.query || null,
        identityConsistency: pkg.identity?.consistency,
        identityNotes: pkg.identity?.notes || [],
        participantOibs: pkg.identity?.participantOibs || [],
        discovery: {
            reasoningClusterId: pkg.discovery?.reasoningClusterId || null,
            recommendedPrimaryClusterId: pkg.discovery?.recommendedPrimaryClusterId || null,
            secondaryClusterIds: pkg.discovery?.secondaryClusterIds || [],
            discoveryMode: pkg.discovery?.discoveryMode || null,
            totalResults: pkg.discovery?.totalResults ?? null,
            totalPages: pkg.discovery?.totalPages ?? null,
            pagesScanned: pkg.discovery?.pagesScanned ?? null,
            rawEntryCount: pkg.discovery?.rawEntryCount ?? null,
            capturedDistinctCaseCount: pkg.discovery?.capturedDistinctCaseCount ?? null
        },
        selection: pkg.selection || null,
        expansion: pkg.expansion || null,
        acquisition: pkg.acquisition || null,
        coverage: pkg.coverage || null,
        analysesCount: Array.isArray(pkg.analyses) ? pkg.analyses.length : 0,
        moneyFlow: pkg.moneyFlow || {
            count: 0,
            entries: [],
            currencyTotals: {},
            hasMoneyFlow: false
        },
        documentLinks: (pkg.documentLinks || []).map((link) => ({
            id: link.id,
            url: link.url,
            text: link.text,
            sourceProvenance: link.sourceProvenance || null
        }))
    };
}

function createReasoningEvidenceFromPackage(pkg) {
    const validation = validateClusterEvidencePackage(pkg);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    const timeline = (pkg.entries || []).map((entry, index) => ({
        date: entry.date || null,
        description: `${entry.title || 'Objava'} (${entry.caseNumber || pkg.clusterId})`,
        evidence: [{
            sourceId: entry.detailLink || `${pkg.clusterId}:entry-${index + 1}`,
            text: entry.title || entry.detailLink || 'Objava bez naslova',
            provenance: entry.acquisition || null
        }]
    }));

    const claims = (pkg.documentLinks || []).map((link, index) => ({
        id: `document-${index + 1}`,
        text: `Dokument "${link.text || link.url || `#${index + 1}`}" pripada odabranom predmetu ${pkg.primaryCaseNumber || pkg.clusterId}.`,
        confidence: 'medium',
        evidence: [{
            sourceId: link.id || link.url || `${pkg.clusterId}:document-${index + 1}`,
            text: link.text || link.url || 'Dokument bez naziva',
            metadata: { sourceType: 'document-link' },
            provenance: link.sourceProvenance || link.acquisition || null
        }]
    }));

    // Successful per-document analyses carry the real legal substance. Surface
    // them as first-class claims so the synthesizer grounds its findings in
    // actual document content, not only structural metadata.
    const analysisClaims = (pkg.analyses || []).map((analysis, index) => ({
        id: `analysis-${index + 1}`,
        text: `Analiza dokumenta "${analysis.fileName || 'nepoznat'}": ${analysis.summary || 'Nema sažetka.'}`,
        confidence: 'medium',
        evidence: [{
            sourceId: analysis.id || analysis.filePath || `${pkg.clusterId}:analysis-${index + 1}`,
            text: analysis.summary || '',
            metadata: {
                sourceType: 'analysis',
                fileName: analysis.fileName || null,
                decisionDate: analysis.decisionDate || null,
                caseNumber: analysis.caseNumber || null
            }
        }]
    }));

    // Structured money-flow entries become first-class, source-cited claims so
    // the report's findings/amounts are grounded in deterministic extraction
    // (Track 3c) rather than prose alone.
    const moneyFlowClaims = (pkg.moneyFlow?.entries || []).map((entry, index) => {
        const displayAmount = Number.isFinite(entry.amount)
            ? entry.amount.toLocaleString('en-US')
            : String(entry.amount ?? '');
        return {
            id: `money-flow-${index + 1}`,
            text: `Financijski iznos ${displayAmount} ${entry.currency || ''} ${entry.description ? `(${entry.description})` : ''}${entry.date ? ` — ${entry.date}` : ''}${entry.fileName ? ` iz dokumenta "${entry.fileName}"` : ''}.`,
            confidence: 'medium',
            evidence: [{
                sourceId: entry.sourceId || `${pkg.clusterId}:money-flow-${index + 1}`,
                text: `${entry.amount} ${entry.currency || ''} ${entry.description || ''}`.trim(),
                metadata: {
                    sourceType: 'analysis-amount',
                    fileName: entry.fileName || null,
                    caseNumber: entry.caseNumber || null,
                    date: entry.date || null,
                    from: entry.from || null,
                    to: entry.to || null
                }
            }]
        };
    });

    return {
        timeline,
        claims: [
            ...claims,
            ...analysisClaims,
            ...moneyFlowClaims
        ],
        meta: buildPackageMeta(pkg)
    };
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

module.exports = {
    synthesizeReport,
    createEvidenceFromProcessedCases,
    createReasoningEvidenceFromPackage,
    normalizeReasoningEvidence
};
