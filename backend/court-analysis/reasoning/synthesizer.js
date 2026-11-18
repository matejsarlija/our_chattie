require("dotenv").config();
const { withGeminiRetry, withGeminiTimeout } = require("../../helpers/geminiRetry");
const { trackGeminiInvoke } = require("../../helpers/geminiUsage");
const { createGeminiClient, outputCapWarning } = require("../../helpers/geminiConfig");
const { extractJsonBlock } = require("../../helpers/jsonExtract");
const agentLog = require("../../helpers/agentLog");
const { SCHEMA_VERSION, validateReport } = require("./schema");
const { validateClusterEvidencePackage } = require("./evidencePackage");
const { buildTimeline, parseDate } = require("./timelineBuilder");
const {
    isPoorDocumentCoverage,
    hasPartialDocumentCoverage,
    coverageOpenQuestion,
    applyCoverageConfidenceGuard
} = require("./coverageGuard");

const gemini = createGeminiClient("synthesis");
const MAX_REPORT_FINDINGS = 12;
const MAX_REPORT_QUESTIONS = 8;
const MAX_REPORT_NEXT_STEPS = 8;
const MAX_REPORT_NARRATIVE_CHARS = 1500;
const MAX_REPORT_FINDING_CHARS = 1200;

function spreadItems(items, limit) {
    if (items.length <= limit) return items;
    if (limit <= 1) return [items[0]];
    return Array.from({ length: limit }, (_, index) => (
        items[Math.round(index * (items.length - 1) / (limit - 1))]
    ));
}

function boundedText(value, maxChars) {
    const text = typeof value === 'string' ? value : String(value || '');
    return text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}…`;
}

const MAX_FINDING_CITATIONS = 4;
const MAX_CITATION_TEXT_CHARS = 400;

/**
 * Resolves a model-authored citation reference (`"C12"`) to the source of the
 * claim it points at. The model used to copy whole claim lines into
 * `citations`, which on dense cases produced tens of thousands of output
 * tokens and truncated the report JSON mid-object. Claim references keep the
 * output (and therefore the completion) small while preserving a real link to
 * the evidence. Legacy structured citation objects are still accepted.
 */
function resolveFindingCitations(rawCitations, claimByRef) {
    if (!Array.isArray(rawCitations)) return [];
    const resolved = [];
    const seen = new Set();

    const push = (citation) => {
        if (!citation) return;
        const key = `${citation.source || ''}|${citation.fileName || ''}|${citation.text || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        resolved.push(citation);
    };

    for (const raw of rawCitations) {
        if (resolved.length >= MAX_FINDING_CITATIONS) break;

        if (typeof raw === 'string') {
            const match = raw.trim().match(/^\[?C(\d+)\]?$/i);
            if (!match) continue;
            const claim = claimByRef.get(`C${Number(match[1])}`);
            if (!claim) continue;
            const evidence = (claim.evidence || []).find((item) => item && typeof item === 'object');
            if (!evidence) {
                push({ source: claim.id, text: boundedText(claim.text, MAX_CITATION_TEXT_CHARS) });
                continue;
            }
            const citation = {};
            if (evidence.sourceId) citation.source = evidence.sourceId;
            if (evidence.metadata?.fileName) citation.fileName = evidence.metadata.fileName;
            if (evidence.url) citation.url = evidence.url;
            citation.text = boundedText(evidence.text || claim.text, MAX_CITATION_TEXT_CHARS);
            push(citation);
            continue;
        }

        if (raw && typeof raw === 'object') {
            const citation = {};
            const source = raw.source || raw.sourceId;
            if (typeof source === 'string' && source.trim()) citation.source = source;
            if (typeof raw.fileName === 'string' && raw.fileName.trim()) citation.fileName = raw.fileName;
            if (typeof raw.url === 'string' && raw.url.trim()) citation.url = raw.url;
            if (typeof raw.text === 'string' && raw.text.trim()) {
                citation.text = boundedText(raw.text, MAX_CITATION_TEXT_CHARS);
            }
            if (citation.source || citation.fileName || citation.text) push(citation);
        }
    }

    return resolved;
}

/**
 * Synthesizes a structured report from the reasoning evidence package.
 * @param {object} evidencePackage 
 * @param {Array} evidencePackage.timeline
 * @param {Array} evidencePackage.claims
 * @param {object} evidencePackage.meta
 * @param {object} [options]
 * @param {object} [options.tracker] Cumulative usage tracker from geminiUsage.
 * @param {(snapshot: object) => void} [options.onUsage] Fired after each Gemini call.
 * @returns {Promise<object>} The structured report.
 */
async function synthesizeReport(evidencePackage, options = {}) {
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
    const claimByRef = new Map(claims.map((claim, index) => [`C${index + 1}`, claim]));
    const claimsText = claims.map((claim, index) => formatClaimLine(claim, index)).join('\n');
    const partiesText = (meta.parties || []).join(', ');
    const caseNumber = meta.caseNumber || 'Unknown';
    const poorDocumentCoverage = isPoorDocumentCoverage(meta.coverage);
    const partialDocumentCoverage = hasPartialDocumentCoverage(meta.coverage);
    const coverageInstruction = poorDocumentCoverage || partialDocumentCoverage
        ? `\n    DOCUMENT COVERAGE WARNING: ${meta.coverage.analyzed || 0} of ${meta.coverage.total || 0} documents were analyzed successfully${partialDocumentCoverage ? `; ${meta.coverage.partial} were only partially extracted or analyzed` : ''}. Titles and links are structural metadata only. Do not infer facts from missing pages or failed chunks; qualify findings that depend on incomplete documents and identify those gaps as open questions. Low confidence is not a substitute for missing evidence.\n`
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

    1. Write one concise Croatian narrative (at most 1,500 characters).
    2. List at most 12 key findings based on the claims. Each claim line starts with a stable reference [C1], [C2], ... Cite only the references that support the finding, at most 4 per finding. Never copy claim or citation text into the citations list.
    3. Identify at most 8 concise open questions if information is missing or ambiguous.
    4. Suggest at most 8 concise next steps grounded in the evidence; do not invent procedural actions.
    Keep each finding, question, and next step short. Do not repeat the same fact across findings.
    OUTPUT FORMAT:
    Return strictly JSON with the following structure:
    {
        "narrative": "string (Croatian)",
        "findings": [
            { "text": "finding text", "confidence": "high|medium|low", "citations": ["C1", "C2"] }
        ],
        "openQuestions": ["string"],
        "nextSteps": ["string"]
    }
    Use only claim references from the list above in "citations"; do not invent references.
    `;

    try {
        const response = await withGeminiRetry(() => withGeminiTimeout((signal) => trackGeminiInvoke(gemini, prompt, { signal, tracker: options.tracker, onUsage: options.onUsage })));
        const parsed = extractJsonBlock(response.content);

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            agentLog.warn(outputCapWarning("synthesis"));
            agentLog.error("Failed to parse synthesizer JSON:", response.content);
            throw new Error("Synthesizer returned invalid JSON.");
        }

        const rawFindings = Array.isArray(parsed.findings)
            ? parsed.findings.filter((finding) => finding && typeof finding === 'object')
            : [];
        const selectedFindings = spreadItems(rawFindings, MAX_REPORT_FINDINGS);
        const findingsOmitted = rawFindings.length - selectedFindings.length;
        const findings = applyCoverageConfidenceGuard(selectedFindings.map((finding, index) => ({
            id: finding.id || `finding-${index + 1}`,
            text: boundedText(finding.text || finding.claim || 'Untitled Finding', MAX_REPORT_FINDING_CHARS),
            confidence: finding.confidence || 'medium',
            citations: resolveFindingCitations(finding.citations, claimByRef)
        })), normalizedEvidence);

        const rawQuestions = Array.isArray(parsed.openQuestions)
            ? parsed.openQuestions.filter((question) => typeof question === 'string')
            : [];
        const openQuestions = spreadItems(rawQuestions, MAX_REPORT_QUESTIONS)
            .map((question) => boundedText(question, 400));
        const questionsOmitted = rawQuestions.length - openQuestions.length;
        const rawNextSteps = Array.isArray(parsed.nextSteps)
            ? parsed.nextSteps.filter((step) => typeof step === 'string')
            : [];
        const nextSteps = spreadItems(rawNextSteps, MAX_REPORT_NEXT_STEPS)
            .map((step) => boundedText(step, 400));
        const nextStepsOmitted = rawNextSteps.length - nextSteps.length;
        if ((poorDocumentCoverage || partialDocumentCoverage) && !openQuestions.includes(coverageOpenQuestion(meta.coverage))) {
            openQuestions.push(coverageOpenQuestion(meta.coverage));
        }

        // Deterministic reconciliation conflicts (money-flow arithmetic)
        // seed the report here; verification appends model-found conflicts on
        // top. pkg.reconciliation flows through meta — see evidencePackage.
        const seededConflicts = [...(meta.reconciliation?.conflicts || [])];
        const seededOpenQuestions = [...(meta.reconciliation?.openQuestions || [])];

        const fallbackClaims = findings.length > 0 ? [] : spreadItems(claims, MAX_REPORT_FINDINGS);
        const finalFindings = findings.length > 0 ? findings : applyCoverageConfidenceGuard(
            fallbackClaims.map((claim, index) => ({
                id: `finding-${index + 1}`,
                text: boundedText(claim.text, MAX_REPORT_FINDING_CHARS),
                confidence: claim.confidence || 'medium',
                citations: (Array.isArray(claim.evidence) ? claim.evidence : [])
                    .slice(0, MAX_FINDING_CITATIONS)
                    .map((evidence) => ({
                        ...(evidence?.sourceId ? { source: evidence.sourceId } : {}),
                        ...(evidence?.metadata?.fileName ? { fileName: evidence.metadata.fileName } : {}),
                        text: boundedText(evidence?.text || claim.text, MAX_CITATION_TEXT_CHARS),
                    }))
            })),
            normalizedEvidence,
        );
        const finalReport = {
            schemaVersion: SCHEMA_VERSION,
            narrative: boundedText(parsed.narrative, MAX_REPORT_NARRATIVE_CHARS),
            openQuestions: [...seededOpenQuestions, ...openQuestions],
            nextSteps,
            conflicts: seededConflicts,
            claims,
            findings: finalFindings,
            timeline: buildReportTimeline(timeline),
            meta: {
                ...meta,
                synthesisOutputBounds: {
                    modelFindingsOmitted: findingsOmitted,
                    fallbackClaimsOmitted: findings.length > 0 ? 0 : Math.max(0, claims.length - fallbackClaims.length),
                    openQuestionsOmitted: questionsOmitted,
                    nextStepsOmitted,
                },
                generatedAt: new Date().toISOString()
            }
        };

        const validation = validateReport(finalReport);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        return finalReport;

    } catch (error) {
        agentLog.error("Synthesizer failed:", error);
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
        proceduralFlow: pkg.proceduralFlow || null,
        reconciliation: pkg.reconciliation || null,
        propertyReconciliation: pkg.propertyReconciliation || null,
        analysesCount: Array.isArray(pkg.analyses) ? pkg.analyses.length : 0,
        moneyFlow: pkg.moneyFlow || {
            count: 0,
            entries: [],
            currencyTotals: {},
            hasMoneyFlow: false
        },
        propertyFlow: pkg.propertyFlow || {
            count: 0,
            entries: [],
            hasPropertyFlow: false
        },
        documentLinks: (pkg.documentLinks || []).map((link) => ({
            id: link.id,
            url: link.url,
            text: link.text,
            sourceProvenance: link.sourceProvenance || null
        }))
    };
}

/**
 * Extracts a best-effort date for chronological claim ordering. Checks each
 * evidence entry's metadata for a `date` or `decisionDate` field (the two
 * field names used across claim families) and returns the first one found.
 * @param {object} claim
 * @returns {string|null}
 */
function extractClaimDate(claim) {
    for (const evidence of claim?.evidence || []) {
        const metadata = evidence?.metadata;
        if (metadata?.date) return metadata.date;
        if (metadata?.decisionDate) return metadata.decisionDate;
    }
    return null;
}

/**
 * Renders one claim for the synthesis prompt. The date prefix matters: the
 * claims arrive chronologically sorted, but without a visible date the model
 * cannot reason about order — it would only see an unexplained sequence.
 * @param {object} claim
 * @param {number} [index] Zero-based claim position; when present the line is
 * prefixed with the stable reference the synthesis prompt cites (`[C1]`).
 * @returns {string}
 */
function formatClaimLine(claim, index) {
    const date = extractClaimDate(claim);
    const ref = Number.isInteger(index) ? `[C${index + 1}] ` : '';
    return `- ${ref}[${date || 'Undated'}] ${claim?.text || ''} (Confidence: ${claim?.confidence || 'medium'})`;
}

/**
 * Sorts claims oldest-first by their best-effort date, undated claims last,
 * stable otherwise. Mirrors `buildTimeline`'s ordering rules but works over
 * claim shapes (evidence-array metadata) instead of timeline events.
 * @param {Array<object>} claims
 * @returns {Array<object>}
 */
function sortClaimsChronologically(claims) {
    if (!Array.isArray(claims)) return [];

    const decorated = claims.map((claim) => ({ claim, ts: parseDate(extractClaimDate(claim)) }));

    decorated.sort((a, b) => {
        if (a.ts !== null && b.ts !== null) return a.ts - b.ts;
        if (a.ts === null && b.ts !== null) return 1;
        if (a.ts !== null && b.ts === null) return -1;
        return 0;
    });

    return decorated.map(({ claim }) => claim);
}

function createReasoningEvidenceFromPackage(pkg) {
    const validation = validateClusterEvidencePackage(pkg);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // Discovery/download order is deliberately recency-biased (newest CSV
    // rows first, plus an oldest-tail sample) so a bounded scan-depth budget
    // favors current case state. That ordering must not leak into the
    // narrative: the model reads this list top-to-bottom as "TIMELINE OF
    // EVENTS", so it needs true chronological (oldest-first) order.
    const timeline = buildTimeline((pkg.entries || []).map((entry, index) => ({
        date: entry.date || null,
        description: `${entry.title || 'Objava'} (${entry.caseNumber || pkg.clusterId})`,
        evidence: [{
            sourceId: entry.detailLink || `${pkg.clusterId}:entry-${index + 1}`,
            text: entry.title || entry.detailLink || 'Objava bez naslova',
            provenance: entry.acquisition || null
        }]
    })));

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
            text: `Financijski iznos ${displayAmount} ${entry.currency || ''} ${entry.description ? `(${entry.description})` : ''}${entry.date ? ` — ${entry.date}` : ''}${entry.fileName ? ` iz dokumenta "${entry.fileName}"` : ''}${entry.grounded === false ? ' [nepotvrđeno u izvornom tekstu]' : ''}.`,
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
                    to: entry.to || null,
                    grounded: entry.grounded === true
                }
            }]
        };
    });

    // Structured property-flow entries become first-class claims the same way,
    // with tražbina lifecycle chains rendered as directional value-change text.
    const propertyFlowClaims = (pkg.propertyFlow?.entries || []).map((entry, index) => {
        const displayValue = Number.isFinite(entry.value)
            ? entry.value.toLocaleString('en-US')
            : (entry.value ?? '');
        return {
            id: `property-flow-${index + 1}`,
            text: `Imovina (${entry.assetType || 'drugo'}) ${displayValue} ${entry.currency || ''} ${entry.description ? `(${entry.description})` : ''}${entry.transferor || entry.transferee ? ` — ${entry.transferor || '?'} → ${entry.transferee || '?'}` : ''}${entry.eventType ? ` [${entry.eventType}]` : ''}${entry.date ? ` — ${entry.date}` : ''}${entry.fileName ? ` iz dokumenta "${entry.fileName}"` : ''}${entry.grounded === false ? ' [nepotvrđeno u izvornom tekstu]' : ''}.`,
            confidence: 'medium',
            evidence: [{
                sourceId: entry.sourceId || `${pkg.clusterId}:property-flow-${index + 1}`,
                text: `${entry.value ?? ''} ${entry.currency || ''} ${entry.description || ''}`.trim(),
                metadata: {
                    sourceType: 'analysis-property',
                    fileName: entry.fileName || null,
                    caseNumber: entry.caseNumber || null,
                    date: entry.date || null,
                    assetType: entry.assetType || null,
                    eventType: entry.eventType || null,
                    grounded: entry.grounded === true
                }
            }]
        };
    });

    // Tražbina value-change timelines surface as findings-grade claims so the
    // discount signal (filed at face value, later sold at a discount) is never
    // lost between reconciliation and synthesis.
    const propertyValueChangeClaims = ((pkg.propertyReconciliation?.valueChanges || [])).map((change, index) => ({
        id: `property-value-change-${index + 1}`,
        text: change.finding || `Vrijednosna promjena tražbine "${change.description}".`,
        confidence: 'medium',
        evidence: (change.stages || []).map((stage) => ({
            sourceId: stage.sourceId || `${pkg.clusterId}:property-value-change-${index + 1}`,
            text: `${stage.value ?? ''} ${change.currency || ''} ${change.description || ''}`.trim(),
            metadata: {
                sourceType: 'analysis-property',
                fileName: stage.fileName || null,
                eventType: stage.eventType || null,
                date: stage.date || null,
                grounded: true
            }
        }))
    }));

    return {
        timeline,
        // Same rationale as the timeline: the package's own entries/analyses
        // arrive discovery-ordered (newest-first). Presenting the model's
        // evidentiary claims oldest-first mirrors real chronological
        // reasoning and keeps partial-data runs (bounded scan depth, missing
        // documents) building an understanding forward in time instead of
        // backward from whatever happened to be scraped first.
        claims: sortClaimsChronologically([
            ...claims,
            ...analysisClaims,
            ...moneyFlowClaims,
            ...propertyFlowClaims,
            ...propertyValueChangeClaims
        ]),
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
                    evidence: [{
                        sourceId: analysis.filePath || 'unknown',
                        text: res.summary,
                        metadata: { date: res.decisionDate || null }
                    }]
                });
            }
        }
    });

    return {
        timeline: buildTimeline(timeline),
        claims: sortClaimsChronologically(claims),
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
    normalizeReasoningEvidence,
    extractClaimDate,
    formatClaimLine,
    resolveFindingCitations
};
