require("dotenv").config();
const crypto = require("node:crypto");
const { withGeminiRetry, withGeminiTimeout } = require("../../../llm/retry");
const { trackUsageInvoke } = require("../../../llm/usage");
const { createOpenRouterRoleClient, outputCapWarning } = require("../../../llm/openrouterConfig");
const { createTaskRouter } = require("../../../llm/taskRouter");
const { createCreditExhaustedLatch } = require("../../../llm/creditLatch");
const { extractJsonBlock } = require("../../../llm/jsonExtract");
const logger = require("../../../services/logger");
const { SCHEMA_VERSION, validateReport } = require("../schema/schema");
const { validateClusterEvidencePackage } = require("../ledger/evidencePackage");
const { buildTimeline, parseDate } = require("./timelineBuilder");
const {
    isPoorDocumentCoverage,
    hasPartialDocumentCoverage,
    coverageOpenQuestion,
    applyCoverageConfidenceGuard
} = require("../ledger/coverageGuard");

const gemini = createOpenRouterRoleClient("synthesis");
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
            if (evidence.docId || evidence.metadata?.docId) citation.docId = evidence.docId || evidence.metadata.docId;
            if (evidence.chunkId || evidence.metadata?.chunkId || evidence.metadata?.sourceChunkId) {
                citation.chunkId = evidence.chunkId || evidence.metadata?.chunkId || evidence.metadata?.sourceChunkId;
            }
            if (Array.isArray(evidence.sourcePages || evidence.metadata?.sourcePages)) {
                citation.sourcePages = [...(evidence.sourcePages || evidence.metadata.sourcePages)];
            }
            if (Number.isInteger(evidence.sourceEntryIndex ?? evidence.metadata?.sourceEntryIndex)) {
                citation.sourceEntryIndex = evidence.sourceEntryIndex ?? evidence.metadata.sourceEntryIndex;
            }
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

    const { timeline = [], claims = [], meta = {}, creditorDigest = null, proceduralOutcomes = null } = normalizedEvidence;

    // 1. Prepare RLM Symbolic Case Environment (Markdown Pipe Tables + Tagged [C<N>] Blocks)
    const timelineText = timeline.map(e => `- ${e.date || 'Nedatirano'}: ${e.description}`).join('\n');
    const claimByRef = new Map(claims.map((claim, index) => [`C${index + 1}`, claim]));
    const pipeTablesSection = formatRlmPipeTables({
        creditorDigest: creditorDigest || meta.creditorDigest,
        proceduralOutcomes: proceduralOutcomes || meta.proceduralOutcomes,
        reconciliation: meta.reconciliation,
    });
    const claimsText = claims.map((claim, index) => formatTaggedClaimBlock(claim, index)).join('\n\n');
    const partiesText = (meta.parties || []).join(', ');
    const caseNumber = meta.caseNumber || 'Nepoznato';
    const poorDocumentCoverage = isPoorDocumentCoverage(meta.coverage);
    const partialDocumentCoverage = hasPartialDocumentCoverage(meta.coverage);
    const coverageInstruction = poorDocumentCoverage || partialDocumentCoverage
        ? `\n    DOCUMENT COVERAGE WARNING: ${meta.coverage.analyzed || 0} of ${meta.coverage.total || 0} documents were analyzed successfully${partialDocumentCoverage ? `; ${meta.coverage.partial} were only partially extracted or analyzed` : ''}. Titles and links are structural metadata only. Do not infer facts from missing pages or failed chunks; qualify findings that depend on incomplete documents and identify those gaps as open questions. Low confidence is not a substitute for missing evidence.\n`
        : '';

    const systemPrompt = [
        'You are a legal analyst assistant for Croatian court cases.',
        'Generate a final report in CROATIAN based ONLY on the supplied RLM Symbolic Case Environment.',
        '1. Write one concise Croatian narrative (at most 1,500 characters).',
        '2. List at most 12 key findings based on the claims. Each claim block has a stable reference [C1], [C2], ... Cite only the references that support the finding, at most 4 per finding. Never copy claim or citation text into the citations list.',
        '3. Identify at most 8 concise open questions if information is missing or ambiguous.',
        '4. Suggest at most 8 concise next steps grounded in the evidence; do not invent procedural actions.',
        'Keep each finding, question, and next step short. Do not repeat the same fact across findings.',
        'Return strictly a JSON object with keys: "narrative", "findings" ([{ "text", "confidence": "high|medium|low", "citations": ["C1"] }]), "openQuestions" ([string]), "nextSteps" ([string]).',
        'Use only claim references from the list below in "citations"; do not invent references.',
    ].join('\n');

    const userContent = `CASE INFO:
Number: ${caseNumber}
Parties: ${partiesText || 'Nepoznato'}
${pipeTablesSection ? `\n${pipeTablesSection}\n` : ''}
TIMELINE OF EVENTS:
${timelineText || "Nema kronoloških objava."}

VERIFIED CLAIMS & SOURCE EXCERPTS:
${claimsText || "Nema potvrđenih tvrdnji."}
${coverageInstruction}`;

    const promptHash = crypto.createHash('sha256').update(`synthesis_v1:${systemPrompt}`).digest('hex').slice(0, 16);
    if (options.sqliteStore?.upsertPromptRegistry) {
        try {
            options.sqliteStore.upsertPromptRegistry({
                promptHash,
                promptName: 'synthesis_v1',
                schemaVersion: 1,
                systemPrompt,
            });
        } catch {
            // Non-fatal telemetry
        }
    }

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
            response = await router.invokeTask('SynthesizeCase', [
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
            response = await withGeminiRetry(() => withGeminiTimeout((reqSignal) => trackUsageInvoke(gemini, prompt, {
                signal: options.signal || reqSignal,
                tracker: options.tracker,
                onUsage: options.onUsage,
            })), { signal: options.signal });
        }
        const parsed = extractJsonBlock(response.content);

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            logger.agent.warn(outputCapWarning("synthesis"));
            logger.agent.error("Failed to parse synthesizer JSON:", response.content);
            throw new Error("Synthesizer returned invalid JSON.");
        }

        const rawFindings = Array.isArray(parsed.findings)
            ? parsed.findings.filter((finding) => finding && typeof finding === 'object')
            : [];
        const selectedFindings = spreadItems(rawFindings, MAX_REPORT_FINDINGS);
        const findingsOmitted = rawFindings.length - selectedFindings.length;
        const findings = applyCoverageConfidenceGuard(selectedFindings.map((finding, index) => ({
            id: finding.id || `finding-${index + 1}`,
            text: boundedText(finding.text || finding.claim || 'Nalaz bez naslova', MAX_REPORT_FINDING_CHARS),
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
            generationMode: 'llm',
            narrative: boundedText(parsed.narrative, MAX_REPORT_NARRATIVE_CHARS),
            openQuestions: [...seededOpenQuestions, ...openQuestions],
            nextSteps,
            conflicts: seededConflicts,
            claims: [],
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
        logger.agent.error("Synthesizer failed:", error);
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
        flows: pkg.flows || { count: 0, entries: [], currencyTotals: {}, hasFlows: false },
        analysesCount: Array.isArray(pkg.analyses) ? pkg.analyses.length : 0,
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
    return `- ${ref}[${date || 'Nedatirano'}] ${claim?.text || ''} (Confidence: ${claim?.confidence || 'medium'})`;
}

function formatTaggedClaimBlock(claim, index) {
    const ref = Number.isInteger(index) ? `C${index + 1}` : 'C?';
    const ev = claim?.evidence?.[0] || {};
    const meta = ev?.metadata || {};
    const fileName = meta.fileName || ev.fileName || null;
    const pages = Array.isArray(ev.sourcePages || meta.sourcePages) && (ev.sourcePages || meta.sourcePages).length > 0
        ? ` (str. ${(ev.sourcePages || meta.sourcePages).join(', ')})`
        : '';
    if (String(claim?.id || '').startsWith('retrieved-') && fileName) {
        return `### [${ref}] ${fileName}${pages}\n${claim.text || ''}`;
    }
    return formatClaimLine(claim, index);
}

function formatRlmPipeTables({ creditorDigest, proceduralOutcomes, reconciliation }) {
    const sections = [];
    const conflicts = Array.isArray(reconciliation?.conflicts) ? reconciliation.conflicts : [];
    const openQuestions = Array.isArray(reconciliation?.openQuestions) ? reconciliation.openQuestions : [];

    if (conflicts.length > 0) {
        sections.push([
            'RECONCILIATION CONFLICTS:',
            '| Vrsta | Nalaz | Razlog |',
            '|---|---|---|',
            ...conflicts.slice(0, 15).map((c) => `| ${c.kind || 'arithmetic'} | ${String(c.finding || '').replace(/\|/g, '/')} | ${String(c.reason || '').replace(/\|/g, '/')} |`),
        ].join('\n'));
    }
    if (openQuestions.length > 0) {
        sections.push([
            'RECONCILIATION OPEN QUESTIONS:',
            ...openQuestions.slice(0, 10).map((q) => `- ${typeof q === 'string' ? q : q?.text || ''}`),
        ].join('\n'));
    }
    if (creditorDigest?.topCreditors?.length > 0) {
        sections.push([
            'TOP CREDITORS DIGEST:',
            '| Vjerovnik | Isplatni red | Ukupno EUR | Stavki |',
            '|---|---|---|---|',
            ...creditorDigest.topCreditors.slice(0, 15).map((c) => `| ${String(c.creditor || '').replace(/\|/g, '/')} | ${c.isplatniRed || '-'} | ${c.totalEur} | ${c.claimCount} |`),
        ].join('\n'));
    }
    if (proceduralOutcomes?.milestoneEvents?.length > 0) {
        sections.push([
            'PROCEDURAL OUTCOMES:',
            '| Datum | Tip | Instanca | Ishod | Opis |',
            '|---|---|---|---|---|',
            ...proceduralOutcomes.milestoneEvents.slice(0, 15).map((e) => `| ${e.date || 'Nedatirano'} | ${e.eventType || '-'} | ${e.instance || '-'} | ${e.outcome || '-'} | ${String(e.description || '').slice(0, 120).replace(/\|/g, '/')} |`),
        ].join('\n'));
    }
    return sections.join('\n\n');
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

    const claims = [];

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

    const flowClaims = (pkg.flows?.entries || []).map((entry, index) => {
        const isAmount = entry.kind === 'amount';
        const sourceAmount = entry.sourceAmount ?? '';
        const displayAmount = Number.isFinite(sourceAmount) ? sourceAmount.toLocaleString('en-US') : String(sourceAmount);
        const flowId = entry.id || `flow-${index + 1}`;
        return {
            id: `flow-claim-${flowId}`,
            text: `${isAmount ? 'Financijski iznos' : `Imovina (${entry.assetType || 'drugo'})`} ${displayAmount} ${entry.sourceCurrency || ''} ${entry.description ? `(${entry.description})` : ''}${entry.transferor || entry.transferee ? ` — ${entry.transferor || '?'} → ${entry.transferee || '?'}` : ''}${entry.eventType ? ` [${entry.eventType}]` : ''}${entry.date ? ` — ${entry.date}` : ''}${entry.fileName ? ` iz dokumenta "${entry.fileName}"` : ''}${entry.grounded === false ? ' [nepotvrđeno u izvornom tekstu]' : ''}.`,
            confidence: 'medium',
            evidence: [{
                sourceId: entry.docId || entry.sourceId || `${pkg.clusterId}:${flowId}`,
                text: `${sourceAmount} ${entry.sourceCurrency || ''} ${entry.description || ''}`.trim(),
                metadata: {
                    sourceType: isAmount ? 'analysis-amount' : 'analysis-property',
                    fileName: entry.fileName || null,
                    caseNumber: entry.caseNumber || null,
                    date: entry.date || null,
                    assetType: entry.assetType || null,
                    eventType: entry.eventType || null,
                    from: entry.from || null,
                    to: entry.to || null,
                    grounded: entry.grounded === true
                }
            }]
        };
    });

    const valueChangeClaims = (pkg.reconciliation?.valueChanges || []).map((change, index) => ({
        id: `value-change-${index + 1}`,
        text: change.finding || `Vrijednosna promjena tražbine "${change.description}".`,
        confidence: 'medium',
        evidence: (change.stages || []).map((stage) => ({
            sourceId: stage.sourceId || `${pkg.clusterId}:value-change-${index + 1}`,
            text: `${stage.value ?? ''} ${change.currency || ''} ${change.description || ''}`.trim(),
            metadata: {
                sourceType: 'analysis-property',
                fileName: stage.fileName || null,
                eventType: stage.eventType || null,
                date: stage.date || null,
                grounded: stage.grounded === true
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
            ...flowClaims,
            ...valueChangeClaims
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
