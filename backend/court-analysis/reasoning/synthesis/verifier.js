require("dotenv").config();
const crypto = require("node:crypto");
const { withGeminiRetry, withGeminiTimeout } = require("../../../llm/retry");
const { trackUsageInvoke } = require("../../../llm/usage");
const { createOpenRouterRoleClient, outputCapWarning } = require("../../../llm/openrouterConfig");
const { createTaskRouter } = require("../../../llm/taskRouter");
const { createCreditExhaustedLatch } = require("../../../llm/creditLatch");
const { extractJsonBlock, extractJsonArray, modelContentToText } = require("../../../helpers/jsonExtract");
const logger = require("../../../services/logger");
const { isPoorDocumentCoverage, hasPartialDocumentCoverage, coverageOpenQuestion, applyCoverageConfidenceGuard } = require('../ledger/coverageGuard');

const gemini = createOpenRouterRoleClient("verify");

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

const NON_VERIFIABLE_SOURCE_TYPES = new Set(['document-link']);

function isVerifiableFinding(finding) {
    if (String(finding?.id || '').startsWith('document-')) return false;
    const sources = [...(finding.evidence || []), ...(finding.citations || [])];
    const sourceTypes = sources
        .map((source) => source?.metadata?.sourceType || source?.sourceType)
        .filter(Boolean);
    if (sourceTypes.length === 0) return true;
    return !sourceTypes.every((type) => NON_VERIFIABLE_SOURCE_TYPES.has(type));
}

const VERIFIER_FINDINGS_PER_CALL = 8;
const VERIFIER_REASON_MAX_CHARS = 160;
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

function normalizeNumString(num) {
    if (!Number.isFinite(num)) return [];
    const fixed = num.toFixed(2);
    const intOnly = Math.round(num).toString();
    const hrFormatted = num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const enFormatted = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return [...new Set([fixed, intOnly, hrFormatted, enFormatted, String(num)])];
}

function tryDeterministicVerify(finding, evidencePackage) {
    const text = String(finding?.text || '');
    if (!text) return null;
    const normFinding = text.toLowerCase();
    const findingTokens = matchTokens(text);
    const citedDocIds = new Set(
        (Array.isArray(finding?.citations) ? finding.citations : [])
            .map((c) => c?.docId || c?.source || c?.sourceId)
            .filter(Boolean)
            .map((v) => String(v).trim().toLowerCase()),
    );
    const ledger = Array.isArray(evidencePackage?.factLedger) ? evidencePackage.factLedger : [];
    const flows = Array.isArray(evidencePackage?.flows?.entries) ? evidencePackage.flows.entries : [];
    const candidates = [...ledger, ...flows].filter((row) => row && row.grounded === true);

    for (const row of candidates) {
        const val = Number.isFinite(row.valueEur) ? row.valueEur : row.value;
        const sourceVal = Number.isFinite(row.sourceAmount) ? row.sourceAmount : null;
        const valMatches = (Number.isFinite(val) && val > 0 && normalizeNumString(val).some((s) => text.includes(s)))
            || (Number.isFinite(sourceVal) && sourceVal > 0 && normalizeNumString(sourceVal).some((s) => text.includes(s)));

        const rowDocId = row.docId || row.doc?.docId || row.sourceId || null;
        const docCited = rowDocId && citedDocIds.has(String(rowDocId).trim().toLowerCase());
        const oib = row.parties?.recipientOib || row.parties?.payerOib || row.transfereeOib || row.transferorOib || row.parties?.oib || null;
        const party = row.parties?.recipientName || row.parties?.payerName || row.transferee || row.transferor || row.parties?.name || null;
        const oibMatches = oib ? text.includes(oib) : false;
        const partyTokens = party ? [...matchTokens(party)] : [];
        const partyMatches = partyTokens.length > 0 && partyTokens.some((t) => normFinding.includes(t));

        if (valMatches && (oibMatches || partyMatches || docCited || (!oib && !party))) {
            return {
                verificationStatus: 'verified_deterministic',
                verificationNote: 'Potvrđeno determinističkom provjerom izravno iz potvrđenog zapisa.',
            };
        }

        // Grounded date/party/procedural single-fact match
        const dateMatches = typeof row.date === 'string' && row.date.length >= 8 && text.includes(row.date);
        const refMatches = typeof row.filingReference === 'string' && row.filingReference.length >= 4 && normFinding.includes(row.filingReference.toLowerCase());
        const descTokens = [...matchTokens(row.description || '')];
        const descOverlap = descTokens.filter((t) => findingTokens.has(t)).length;
        if ((dateMatches || refMatches) && (partyMatches || oibMatches || docCited) && descOverlap >= 2) {
            return {
                verificationStatus: 'verified_deterministic',
                verificationNote: 'Potvrđeno determinističkom provjerom izravno iz potvrđenog zapisa.',
            };
        }
    }
    return null;
}

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

    // Pack cited snippets first, then timeline lines, then relevance-ranked claims.
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
                line: `[Citation ${citation.source || citation.sourceId || citation.docId || ''}] ${text}`,
                text,
            });
        }
    }

    for (const line of pool.timelineLines) {
        if (!push(line)) break;
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
        if (!seen.has(claim.text) && push(claim.line)) seen.add(claim.text);
        for (const citation of claim.citations) pushCitation(citation);
    }
    return { lines, truncated };
}

function responsePreview(content, maxChars = 160) {
    const text = modelContentToText(content).replace(/\s+/g, ' ').trim();
    if (!text) return '(empty)';
    if (text.length <= maxChars * 2) return text;
    return `${text.slice(0, maxChars)} … ${text.slice(-maxChars)}`;
}

function parseVerifierResponse(content) {
    const obj = extractJsonBlock(content);
    if (obj && !Array.isArray(obj) && Array.isArray(obj.verdicts)) {
        return { items: obj.verdicts, truncated: false };
    }
    return extractJsonArray(content);
}

async function verifyReport(report, evidencePackage, options = {}) {
    const verifyStartedAt = Date.now();
    const allFindings = normalizeFindingsForVerification(report);
    const verifiableEntries = [];
    const deterministicByOriginalIndex = new Map();

    allFindings.forEach((finding, index) => {
        if (!isVerifiableFinding(finding)) return;
        const det = tryDeterministicVerify(finding, evidencePackage);
        if (det) {
            deterministicByOriginalIndex.set(index, {
                ...finding,
                confidence: finding.confidence || 'high',
                verificationStatus: det.verificationStatus,
                verificationNote: det.verificationNote,
            });
        } else {
            verifiableEntries.push({ finding, index });
        }
    });

    if (!report || (verifiableEntries.length === 0 && deterministicByOriginalIndex.size === 0)) {
        return report;
    }

    const openQuestions = [...(report.openQuestions || [])];
    const conflicts = [...(report.conflicts || [])];
    const evidencePool = buildEvidencePool(evidencePackage);
    const verificationByPosition = new Map();
    const failedPositions = new Set();

    const systemPrompt = [
        'You are a strict legal verification engine.',
        'Verify each finding against the supplied evidence. For each, return exactly one result.',
        'Use status "supported", "contradicted", or "unsupported".',
        `Give a concise Croatian reason of at most ${VERIFIER_REASON_MAX_CHARS} characters.`,
        'Do not add legal conclusions beyond what the evidence states.',
        'Return strictly a JSON object: {"verdicts": [{"index": 1, "status": "supported|contradicted|unsupported", "reason": "short explanation", "confidence": "high|medium|low"}]}',
    ].join('\n');

    const promptHash = crypto.createHash('sha256').update(`verify_v1:${systemPrompt}`).digest('hex').slice(0, 16);
    if (options.sqliteStore?.upsertPromptRegistry && verifiableEntries.length > 0) {
        try {
            options.sqliteStore.upsertPromptRegistry({
                promptHash,
                promptName: 'verify_v1',
                schemaVersion: 1,
                systemPrompt,
            });
        } catch {
            // Non-fatal telemetry
        }
    }

    for (let start = 0; start < verifiableEntries.length; start += VERIFIER_FINDINGS_PER_CALL) {
        if (options.creditLatch?.isTripped?.()) {
            for (let k = start; k < verifiableEntries.length; k += 1) failedPositions.add(k);
            break;
        }
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
        const userContent = `EVIDENCE:\n${evidenceText}\n\nFINDINGS TO VERIFY:\n${claimsList}`;
        const prompt = `${systemPrompt}\n\n${userContent}`;

        try {
            let response;
            const useLegacyClient = gemini?.invoke?._isMockFunction
                || options.taskRouter === null
                || !process.env.OPENROUTER_API_KEY;
            if (!useLegacyClient && (options.taskRouter || options.sqliteStore || options.creditLatch)) {
                const router = options.taskRouter || createTaskRouter({
                    creditLatch: options.creditLatch || createCreditExhaustedLatch({
                        runId: options.runId || null,
                        sqliteStore: options.sqliteStore || null,
                    }),
                    sqliteStore: options.sqliteStore || null,
                    runId: options.runId || null,
                });
                response = await router.invokeTask('VerifyReport', [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent },
                ], {
                    promptHash,
                    responseFormat: { type: 'json_object' },
                    tracker: options.tracker,
                    onUsage: options.onUsage,
                    signal: options.signal,
                });
            } else {
                response = await withGeminiRetry(() => withGeminiTimeout(
                    (reqSignal) => trackUsageInvoke(gemini, prompt, {
                        signal: options.signal || reqSignal,
                        tracker: options.tracker,
                        onUsage: options.onUsage,
                    })
                ), { signal: options.signal });
            }
            const parsed = parseVerifierResponse(response.content);
            if (parsed?.truncated) {
                logger.agent.warn(`Verification batch ${batchNumber} returned a truncated JSON array; using its ${parsed.items.length}/${batch.length} complete results.`);
            }
            if (!parsed || parsed.items.length === 0) {
                logger.agent.warn(outputCapWarning('verify'));
                logger.agent.warn(`Verification batch ${batchNumber} response preview: ${responsePreview(response.content)}`);
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
            logger.agent.error(`Verification batch ${batchNumber} failed: ${error.message}`);
            for (let index = 0; index < batch.length; index += 1) failedPositions.add(start + index);
        }
    }

    const verifiedByPosition = new Map();
    verifiableEntries.forEach(({ finding }, index) => {
        if (failedPositions.has(index)) {
            verifiedByPosition.set(index, {
                ...finding,
                verificationStatus: 'unverified',
                verificationNote: 'Provjera nije dovršena zbog pogreške ili ograničenja modela.',
            });
            return;
        }
        const result = verificationByPosition.get(index);
        if (!result) {
            failedPositions.add(index);
            verifiedByPosition.set(index, {
                ...finding,
                verificationStatus: 'unverified',
                verificationNote: 'Provjera nije vratila rezultat.',
            });
            return;
        }
        if (result.status === 'supported') {
            verifiedByPosition.set(index, {
                ...finding,
                confidence: result.confidence || 'high',
                verificationStatus: 'verified_llm',
                verificationNote: result.reason || 'Potvrđeno u dokaznom materijalu.',
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
                verificationStatus: 'unverified',
                verificationNote: result.reason ? `Proturječi dokazima: ${result.reason}` : 'Nalaz proturječi dostupnim dokazima.',
            });
        } else {
            openQuestions.push(`Nepotvrđen nalaz: ${finding.text}`);
            verifiedByPosition.set(index, {
                ...finding,
                confidence: 'low',
                verificationStatus: 'unverified',
                verificationNote: result.reason || 'Nalaz nije potvrđen u dostupnim dokazima.',
            });
        }
    });

    const stitchedFindings = [];
    const positionOfOriginal = new Map(verifiableEntries.map((entry, position) => [entry.index, position]));
    allFindings.forEach((finding, originalIndex) => {
        if (deterministicByOriginalIndex.has(originalIndex)) {
            stitchedFindings.push(deterministicByOriginalIndex.get(originalIndex));
            return;
        }
        const position = positionOfOriginal.get(originalIndex);
        if (position !== undefined) {
            if (verifiedByPosition.has(position)) stitchedFindings.push(verifiedByPosition.get(position));
        } else {
            stitchedFindings.push({
                ...finding,
                verificationStatus: 'not_checked',
                verificationNote: 'Strukturni podatak — nije predmet provjere.',
            });
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

    const totalAttempted = verifiableEntries.length + deterministicByOriginalIndex.size;
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
                attemptedCount: totalAttempted,
                verifiedCount: totalAttempted - failedCount,
                deterministicVerifiedCount: deterministicByOriginalIndex.size,
                failedCount,
                durationMs: Date.now() - verifyStartedAt,
            },
        },
    };
}

module.exports = {
    verifyReport,
    isVerifiableFinding,
    tryDeterministicVerify,
    buildEvidencePool,
    selectEvidenceForBatch,
};
