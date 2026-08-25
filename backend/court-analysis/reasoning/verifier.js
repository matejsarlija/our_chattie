require("dotenv").config();
const { withGeminiRetry, withGeminiTimeout } = require("../../helpers/geminiRetry");
const { trackGeminiInvoke } = require("../../helpers/geminiUsage");
const { createGeminiClient, outputCapWarning } = require("../../helpers/geminiConfig");
const { extractJsonBlock } = require("../../helpers/jsonExtract");
const agentLog = require("../../helpers/agentLog");
const { isPoorDocumentCoverage, coverageOpenQuestion, applyCoverageConfidenceGuard } = require('./coverageGuard');

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

// Evidence budget for the verify prompt (refinement: verifier input needs the
// same discipline synthesis got). Ground-truth chunk passages grow this
// assembly per finding; without a ceiling, dense clusters pay real input
// tokens for marginal verification signal. Timeline lines go in first (they
// are compact and anchor dates); the cap then walks claim/citation lines.
const VERIFIER_EVIDENCE_CHAR_BUDGET = 24000;

function buildEvidenceLines(evidencePackage) {
    const lines = [
        ...(evidencePackage.timeline || []).map(event => `[Date: ${event.date}] ${event.description}`),
    ];
    // Evidence is assembled once per unique snippet: claim texts are printed
    // as claims, so a citation whose text merely echoes its own claim adds
    // nothing but billed tokens.
    const verifiableClaims = (evidencePackage.claims || [])
        .filter((claim) => isVerifiableFinding({ evidence: claim.evidence }));
    const claimTexts = new Set(
        verifiableClaims.map((claim) => String(claim.text || '').trim()),
    );

    const seenSnippets = new Set();
    let budgetUsed = lines.reduce((sum, line) => sum + line.length + 1, 0);
    for (const claim of verifiableClaims) {
        if (budgetUsed >= VERIFIER_EVIDENCE_CHAR_BUDGET) break;
        const claimText = String(claim.text || '').trim();
        if (claimText && !seenSnippets.has(claimText)) {
            seenSnippets.add(claimText);
            lines.push(`[Source Claim] ${claimText}`);
            budgetUsed += claimText.length + 1;
        }
        for (const snippet of claim.evidence || []) {
            if (budgetUsed >= VERIFIER_EVIDENCE_CHAR_BUDGET) break;
            const snippetText = String(snippet?.text || '').trim();
            if (!snippetText || seenSnippets.has(snippetText) || claimTexts.has(snippetText)) continue;
            seenSnippets.add(snippetText);
            lines.push(`[Citation ${snippet.sourceId || ''}] ${snippetText}`);
            budgetUsed += snippetText.length + 1;
        }
    }
    return { lines, truncated: budgetUsed >= VERIFIER_EVIDENCE_CHAR_BUDGET };
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

    const { lines: evidenceLineList, truncated } = buildEvidenceLines(evidencePackage);
    if (truncated) {
        evidenceLineList.push('[Dokazni materijal je skraćen zbog ograničenja veličine — provjeri samo protiv navedenih dokaza.]');
    }
    const evidenceText = evidenceLineList.join('\n');

    const claimsList = findingsToVerify.map((finding, index) => `${index + 1}. ${finding.text}`).join('\n');

    const prompt = `
    You are a strict legal verification engine.
    Your task is to verify the following FINDINGS against the provided EVIDENCE.

    EVIDENCE:
    ${evidenceText}

    FINDINGS TO VERIFY:
    ${claimsList}

    INSTRUCTIONS:
    For each finding:
    1. Determine if it is "supported" by the evidence, "contradicted" by the evidence, or "unsupported".
    2. If supported, cite the specific evidence snippet.
    3. If contradicted, explain the conflict.

    OUTPUT FORMAT:
    Return strictly JSON array:
    [
        {
            "index": 1,
            "status": "supported|contradicted|unsupported",
            "reason": "explanation",
            "confidence": "high|medium|low"
        }
    ]
    `;

    try {
        const response = await withGeminiRetry(() => withGeminiTimeout((signal) => trackGeminiInvoke(gemini, prompt, { signal, tracker: options.tracker, onUsage: options.onUsage })));
        const verificationResults = extractJsonBlock(response.content);
        if (!Array.isArray(verificationResults)) {
            agentLog.warn(outputCapWarning("verify"));
            agentLog.error("Failed to parse verifier JSON:", response.content);
            throw new Error("Verifier returned invalid JSON.");
        }

        const verifiedByPosition = new Map();
        findingsToVerify.forEach((finding, index) => {
            const result = verificationResults.find(item => item.index === index + 1);

            if (!result) {
                verifiedByPosition.set(index, finding);
                return;
            }

            if (result.status === 'supported') {
                verifiedByPosition.set(index, {
                    ...finding,
                    confidence: result.confidence || 'high',
                    citations: [...(finding.citations || []), { sourceId: 'verification-pass', text: result.reason }]
                });
                return;
            }

            if (result.status === 'contradicted') {
                conflicts.push({
                    finding: finding.text,
                    reason: result.reason
                });
                verifiedByPosition.set(index, {
                    ...finding,
                    confidence: 'low',
                    citations: [...(finding.citations || []), { sourceId: 'verification-contradiction', text: result.reason }]
                });
                return;
            }

            openQuestions.push(`Unverified finding: ${finding.text}`);
        });

        // Stitch back in original report order: mechanical findings stay put
        // untouched; verifiable ones are replaced by their verification
        // outcome. Verifiable findings the model could not support drop out
        // here — they were surfaced as open questions above.
        const stitchedFindings = [];
        const positionOfOriginal = new Map(verifiableEntries.map((entry, position) => [entry.index, position]));
        allFindings.forEach((finding, originalIndex) => {
            const position = positionOfOriginal.get(originalIndex);
            if (position !== undefined) {
                if (verifiedByPosition.has(position)) {
                    stitchedFindings.push(verifiedByPosition.get(position));
                }
                // else: unsupported → intentionally omitted.
            } else {
                stitchedFindings.push(finding);
            }
        });

        const guardedFindings = applyCoverageConfidenceGuard(stitchedFindings, evidencePackage);
        if (isPoorDocumentCoverage(evidencePackage?.meta?.coverage)) {
            const question = coverageOpenQuestion(evidencePackage.meta.coverage);
            if (!openQuestions.includes(question)) openQuestions.push(question);
        }

        return {
            ...report,
            findings: guardedFindings,
            verifiedFindings: guardedFindings,
            openQuestions,
            conflicts
        };
    } catch (error) {
        agentLog.error("Verification failed:", error);
        return report;
    }
}

module.exports = { verifyReport };
