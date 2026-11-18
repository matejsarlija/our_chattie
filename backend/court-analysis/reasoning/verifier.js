require("dotenv").config();
const { withGeminiRetry, withGeminiTimeout } = require("../../helpers/geminiRetry");
const { trackGeminiInvoke } = require("../../helpers/geminiUsage");
const { createGeminiClient, outputCapWarning } = require("../../helpers/geminiConfig");
const { extractJsonArray, modelContentToText } = require("../../helpers/jsonExtract");
const agentLog = require("../../helpers/agentLog");
const { isPoorDocumentCoverage, hasPartialDocumentCoverage, coverageOpenQuestion, applyCoverageConfidenceGuard } = require('./coverageGuard');

const gemini = createGeminiClient("verify");

function normalizeFindingsForVerification(report) {
    if (Array.isArray(report?.findings) && report.findings.length > 0) {
        return report.findings;
    }

    if (!Array.isArray(report?.claims)) {
        return [];
    }

    return report.claims.map((claim, index) => ({
        id: claim.id || `finding-${index + 1}`,
        text: claim.text,
        confidence: claim.confidence || 'medium',
        citations: claim.evidence || []
    }));
}

// Mechanical metadata statements (e.g. "Dokument X pripada odabranom predmetu
// Y") are deterministic grouping facts produced by discovery itself. Sending
// them through the verification model burns tokens to confirm what code
// already guarantees — they bypass the model but stay in the report verbatim.
// Claims without an explicit sourceType are legacy/substantive content and
// stay verifiable; money-flow entries ('analysis-amount') are short, factual,
// and verified as before.
const NON_VERIFIABLE_SOURCE_TYPES = new Set(['document-link']);

function isVerifiableFinding(finding) {
    const sources = [...(finding.evidence || []), ...(finding.citations || [])];
    const sourceTypes = sources
        .map((source) => source?.metadata?.sourceType)
        .filter(Boolean);
    if (sourceTypes.length === 0) return true;
    return !sourceTypes.every((type) => NON_VERIFIABLE_SOURCE_TYPES.has(type));
}

// Small output batches keep JSON responses under the verify role cap even
// when the model gives explanatory reasons. Failed batches stay explicitly
// partial; they never turn unverified findings into supported/unsupported.
const VERIFIER_FINDINGS_PER_CALL = 8;
const VERIFIER_REASON_MAX_CHARS = 160;

// Evidence budget for the verify prompt (refinement 4). Ground-truth chunk passages grow this
// assembly per finding; without a ceiling, dense clusters pay real input
// tokens for marginal verification signal. Timeline lines go in first (they
// are compact and anchor dates); the cap then selects the claim/citation
// lines most relevant to the findings in THIS batch.
const VERIFIER_EVIDENCE_CHAR_BUDGET = 24000;
const VERIFIER_TOKEN_MIN_LENGTH = 3;

function tokenizeForMatch(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .match(/[a-z0-9]+/g) || [];
}

function matchTokens(text) {
    const tokens = new Set();
    for (const token of tokenizeForMatch(text)) {
        if (token.length >= VERIFIER_TOKEN_MIN_LENGTH) tokens.add(token);
    }
    return tokens;
}

/**
 * Builds a reusable evidence pool once per report: compact timeline lines,
 * one line per verifiable claim, and the claim's unique citation snippets.
 * Dense cases (hundreds of claims) cannot fit in one prompt, so selection is
 * per batch rather than a positional prefix — otherwise findings about recent
 * filings would be checked against the oldest evidence only.
 */
function buildEvidencePool(evidencePackage) {
    const timelineLines = (evidencePackage.timeline || [])
        .map((event) => `[Date: ${event.date}] ${event.description}`);
    const verifiableClaims = (evidencePackage.claims || [])
        .filter((claim) => isVerifiableFinding({ evidence: claim.evidence }));
    const claimsByText = new Map();
    const citationLinesByText = new Map();
    for (const claim of verifiableClaims) {
        const claimText = String(claim.text || '').trim();
        if (!claimText) continue;
        if (!claimsByText.has(claimText)) {
            claimsByText.set(claimText, {
                line: `[Source Claim] ${claimText}`,
                text: claimText,
                tokens: matchTokens(claimText),
                citations: [],
            });
            citationLinesByText.set(claimText, new Set());
        }
        const pooledClaim = claimsByText.get(claimText);
        const citationLines = citationLinesByText.get(claimText);
        for (const snippet of claim.evidence || []) {
            const snippetText = String(snippet?.text || '').trim();
            if (!snippetText || snippetText === claimText) continue;
            const line = `[Citation ${snippet.sourceId || ''}] ${snippetText}`;
            if (citationLines.has(line)) continue;
            citationLines.add(line);
            pooledClaim.citations.push({ line, text: snippetText });
        }
    }
    const claims = [...claimsByText.values()];

    const documentFrequency = new Map();
    for (const claim of claims) {
        for (const token of claim.tokens) {
            documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
        }
    }

    return { timelineLines, claims, documentFrequency };
}

function selectEvidenceForBatch(pool, findings, budget = VERIFIER_EVIDENCE_CHAR_BUDGET) {
    const lines = [];
    let truncated = false;
    let used = 0;

    const push = (line) => {
        if (used + line.length + 1 > budget) {
            truncated = true;
            return false;
        }
        lines.push(line);
        used += line.length + 1;
        return true;
    };

    for (const line of pool.timelineLines) {
        if (!push(line)) break;
    }

    // A finding's own citations are the most direct evidence available; put
    // them ahead of the relevance-ranked claim pool.
    const seen = new Set();
    const seenCitations = new Set();
    const pushCitation = (citation) => {
        if (seenCitations.has(citation.line)) return;
        if (push(citation.line)) {
            seenCitations.add(citation.line);
            seen.add(citation.text);
        }
    };
    for (const finding of findings) {
        for (const citation of finding?.citations || []) {
            if (!citation || typeof citation !== 'object') continue;
            const text = String(citation.text || '').trim();
            if (!text) continue;
            pushCitation({
                line: `[Citation ${citation.source || citation.sourceId || ''}] ${text}`,
                text,
            });
        }
    }

    const findingTokens = new Set();
    for (const finding of findings) {
        for (const token of matchTokens(finding?.text)) findingTokens.add(token);
    }

    const ranked = pool.claims
        .map((claim, index) => {
            let score = 0;
            for (const token of claim.tokens) {
                if (!findingTokens.has(token)) continue;
                const documentFrequency = pool.documentFrequency.get(token) || 1;
                score += 1 / Math.log(1 + documentFrequency);
            }
            return { claim, index, score };
        })
        .sort((a, b) => (b.score - a.score) || (a.index - b.index));

    for (const { claim } of ranked) {
        // A previously included quote may echo this claim, but it does not
        // stand in for the claim's other attached evidence.
        if (!seen.has(claim.text) && push(claim.line)) seen.add(claim.text);
        for (const citation of claim.citations) pushCitation(citation);
    }
    return { lines, truncated };
}

/**
 * Bounded log preview of a model response. Shows both ends: a truncated
 * completion is only recognizable by its cut-off tail, while the head shows
 * whether the model wrapped valid JSON in prose.
 */
function responsePreview(content, maxChars = 160) {
    const text = modelContentToText(content).replace(/\s+/g, ' ').trim();
    if (!text) return '(empty)';
    if (text.length <= maxChars * 2) return text;
    return `${text.slice(0, maxChars)} … ${text.slice(-maxChars)}`;
}

async function verifyReport(report, evidencePackage, options = {}) {
    // Mechanical findings are skipped by the model but must survive verbatim
    // in the output at their original positions — skipping is not deleting.
    const allFindings = normalizeFindingsForVerification(report);
    const verifiableEntries = [];
    allFindings.forEach((finding, index) => {
        if (isVerifiableFinding(finding)) verifiableEntries.push({ finding, index });
    });
    const findingsToVerify = verifiableEntries.map((entry) => entry.finding);

    if (!report || findingsToVerify.length === 0) {
        return report;
    }

    const openQuestions = [...(report.openQuestions || [])];
    const conflicts = [...(report.conflicts || [])];
    const evidencePool = buildEvidencePool(evidencePackage);
    const verificationByPosition = new Map();
    const failedPositions = new Set();

    for (let start = 0; start < verifiableEntries.length; start += VERIFIER_FINDINGS_PER_CALL) {
        const batch = verifiableEntries.slice(start, start + VERIFIER_FINDINGS_PER_CALL);
        const batchNumber = Math.floor(start / VERIFIER_FINDINGS_PER_CALL) + 1;
        const claimsList = batch.map(({ finding }, index) => `${index + 1}. ${finding.text}`).join('\n');
        const { lines: evidenceLineList, truncated } = selectEvidenceForBatch(
            evidencePool,
            batch.map(({ finding }) => finding),
        );
        if (truncated) {
            evidenceLineList.push('[Dokazni materijal je skraćen zbog ograničenja veličine — provjeri samo protiv navedenih dokaza.]');
        }
        const evidenceText = evidenceLineList.join('\n');
        const prompt = `
    You are a strict legal verification engine.
    Verify each finding against the supplied evidence. For each, return exactly one result.

    EVIDENCE:
    ${evidenceText}

    FINDINGS TO VERIFY:
    ${claimsList}

    INSTRUCTIONS:
    Use status "supported", "contradicted", or "unsupported".
    Give a concise reason of at most ${VERIFIER_REASON_MAX_CHARS} characters.
    Do not add legal conclusions beyond what the evidence states.

    OUTPUT FORMAT:
    Return strictly JSON array:
    [
        { "index": 1, "status": "supported|contradicted|unsupported", "reason": "short explanation", "confidence": "high|medium|low" }
    ]
    `;

        try {
            const response = await withGeminiRetry(() => withGeminiTimeout(
                (signal) => trackGeminiInvoke(gemini, prompt, { signal, tracker: options.tracker, onUsage: options.onUsage })
            ));
            const parsed = extractJsonArray(response.content);
            if (parsed?.truncated) {
                agentLog.warn(`Verification batch ${batchNumber} returned a truncated JSON array; using its ${parsed.items.length}/${batch.length} complete results.`);
            }
            if (!parsed || parsed.items.length === 0) {
                agentLog.warn(outputCapWarning('verify'));
                agentLog.warn(`Verification batch ${batchNumber} response preview: ${responsePreview(response.content)}`);
                throw new Error('Verifier returned invalid JSON.');
            }
            for (let index = 0; index < batch.length; index += 1) {
                const result = parsed.items.find((item) => item?.index === index + 1);
                if (!result || !['supported', 'contradicted', 'unsupported'].includes(result.status)) {
                    failedPositions.add(start + index);
                    continue;
                }
                verificationByPosition.set(start + index, {
                    ...result,
                    reason: String(result.reason || '').slice(0, VERIFIER_REASON_MAX_CHARS),
                });
            }
        } catch (error) {
            agentLog.error(`Verification batch ${batchNumber} failed: ${error.message}`);
            for (let index = 0; index < batch.length; index += 1) failedPositions.add(start + index);
        }
    }

    const verifiedByPosition = new Map();
    verifiableEntries.forEach(({ finding }, index) => {
        if (failedPositions.has(index)) {
            verifiedByPosition.set(index, finding);
            return;
        }
        const result = verificationByPosition.get(index);
        if (!result) {
            verifiedByPosition.set(index, finding);
            failedPositions.add(index);
            return;
        }
        if (result.status === 'supported') {
            verifiedByPosition.set(index, {
                ...finding,
                confidence: result.confidence || 'high',
                citations: [...(finding.citations || []), { sourceId: 'verification-pass', text: result.reason }],
            });
        } else if (result.status === 'contradicted') {
            conflicts.push({
                finding: finding.text,
                reason: result.reason,
                source: 'verification',
                kind: 'verification',
            });
            verifiedByPosition.set(index, {
                ...finding,
                confidence: 'low',
                citations: [...(finding.citations || []), { sourceId: 'verification-contradiction', text: result.reason }],
            });
        } else {
            openQuestions.push(`Unverified finding: ${finding.text}`);
        }
    });

    const stitchedFindings = [];
    const positionOfOriginal = new Map(verifiableEntries.map((entry, position) => [entry.index, position]));
    allFindings.forEach((finding, originalIndex) => {
        const position = positionOfOriginal.get(originalIndex);
        if (position !== undefined) {
            if (verifiedByPosition.has(position)) stitchedFindings.push(verifiedByPosition.get(position));
        } else {
            stitchedFindings.push(finding);
        }
    });

    const guardedFindings = applyCoverageConfidenceGuard(stitchedFindings, evidencePackage);
    const coverage = evidencePackage?.meta?.coverage;
    if (isPoorDocumentCoverage(coverage) || hasPartialDocumentCoverage(coverage)) {
        const question = coverageOpenQuestion(coverage);
        if (!openQuestions.includes(question)) openQuestions.push(question);
    }
    const failedCount = failedPositions.size;
    if (failedCount > 0) {
        openQuestions.push('Dio nalaza nije mogao biti provjeren; rezultat provjere nije dostupan.');
    }

    return {
        ...report,
        findings: guardedFindings,
        verifiedFindings: guardedFindings,
        openQuestions,
        conflicts,
        meta: {
            ...(report.meta || {}),
            verification: {
                status: failedCount > 0 ? 'partial' : 'complete',
                attemptedCount: findingsToVerify.length,
                verifiedCount: findingsToVerify.length - failedCount,
                failedCount,
            },
        },
    };
}

module.exports = { verifyReport };
