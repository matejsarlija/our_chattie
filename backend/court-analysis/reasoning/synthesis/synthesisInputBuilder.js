const { normalizeReasoningEvidence } = require('./synthesizer');
const { normalizeText } = require('../retrieval/indexer');

// --- RLM Symbolic Case Environment synthesis budget (64,000 chars) ----------
// 25% protected floor for ledger-driven FTS5 BM25 ground-truth excerpts (never evicted)
// 35% thread rollups + pre-computed conflicts + outcomes/parties
// 25% chronological unthreaded claims (spreadItems)
// 15% milestone timeline
const FULL_CLAIM_LIMIT = 12;
const DIGEST_SUMMARY_CHARS = 280;
const SYNTHESIS_INPUT_CHAR_BUDGET = 64000;
const PROTECTED_BM25_BUDGET = Math.floor(SYNTHESIS_INPUT_CHAR_BUDGET * 0.25); // 16,000 chars
const CLAIM_WRAPPER_OVERHEAD_CHARS = 48; // "- [C123] [2025-01-01] ... (Confidence: medium)\n"

function isChunkMatch(match) {
    return match?.metadata?.sourceType === 'chunk';
}

function isSelectedClusterMatch(match, clusterId) {
    const matchCaseNumber = match?.metadata?.caseNumber;
    return !clusterId || !matchCaseNumber || matchCaseNumber === clusterId;
}

function iterResults(retrieval) {
    return Array.isArray(retrieval?.results) ? retrieval.results : [];
}

/**
 * Builds the set of "cited" identifiers from surviving GROUND-TRUTH CHUNK
 * matches anchored on docId / sourceEntryIndex / sourceId (avoiding bare
 * fileName collisions like Podnesak.pdf).
 */
function buildCitedIdentifiers(retrieval) {
    const docIds = new Set();
    const entryKeys = new Set();
    const sourceIds = new Set();
    const legacyFileNames = new Set();
    for (const result of iterResults(retrieval)) {
        for (const match of result.matches || []) {
            if (!isChunkMatch(match)) continue;
            const docId = match?.docId || match?.metadata?.docId;
            if (docId) docIds.add(String(docId).trim().toLowerCase());
            const entryIndex = match?.sourceEntryIndex ?? match?.metadata?.sourceEntryIndex;
            const fileName = match?.metadata?.fileName || match?.fileName;
            if (Number.isInteger(entryIndex)) {
                entryKeys.add(`${entryIndex}::${normalizeText(fileName || '')}`);
            } else if (!docId && fileName) {
                legacyFileNames.add(normalizeText(fileName));
            }
            if (match?.sourceId) sourceIds.add(match.sourceId);
        }
    }
    return { docIds, entryKeys, sourceIds, legacyFileNames };
}

function buildRetrievedEvidenceClaims(retrieval, clusterEvidencePackage) {
    const clusterId = clusterEvidencePackage?.clusterId;

    return (retrieval?.results || []).flatMap((result, resultIndex) => (
        (result.matches || [])
            .filter((match) => isSelectedClusterMatch(match, clusterId))
            .map((match, matchIndex) => ({
                id: `retrieved-${result.query?.id || resultIndex + 1}-${matchIndex + 1}`,
                text: `Relevantni izvor (${result.query?.purpose || result.query?.id || 'retrieval'}): ${match.text}`,
                confidence: 'medium',
                evidence: [{
                    sourceId: match.sourceId || `retrieved-${resultIndex + 1}-${matchIndex + 1}`,
                    ...(match.docId || match.metadata?.docId ? { docId: match.docId || match.metadata?.docId } : {}),
                    ...(Number.isInteger(match.sourceEntryIndex ?? match.metadata?.sourceEntryIndex)
                        ? { sourceEntryIndex: match.sourceEntryIndex ?? match.metadata?.sourceEntryIndex }
                        : {}),
                    ...(Array.isArray(match.metadata?.sourcePages) ? { sourcePages: match.metadata.sourcePages } : {}),
                    text: match.text,
                    retrievalScore: match.score,
                    retrievalReasons: match.reasons || [],
                    lexicalRank: match.lexicalRank ?? null,
                    metadata: match.metadata || null
                }]
            }))
    ));
}

function claimPrimarySource(claim) {
    return claim.evidence?.[0] || null;
}

function isClaimCited(claim, cited) {
    const source = claimPrimarySource(claim);
    if (!source) return false;
    const docId = source.docId || source.metadata?.docId;
    if (docId && cited.docIds.has(String(docId).trim().toLowerCase())) return true;
    const entryIndex = source.sourceEntryIndex ?? source.metadata?.sourceEntryIndex;
    const fileName = source.metadata?.fileName;
    if (Number.isInteger(entryIndex) && cited.entryKeys.has(`${entryIndex}::${normalizeText(fileName || '')}`)) {
        return true;
    }
    if (source.sourceId && cited.sourceIds.has(source.sourceId)) return true;
    if (!docId && !Number.isInteger(entryIndex) && fileName && cited.legacyFileNames.has(normalizeText(fileName))) {
        return true;
    }

    const sourceText = normalizeText(source.text || '');
    if (!sourceText) return false;
    for (const result of iterResults(cited.retrievalRef)) {
        for (const match of result.matches || []) {
            if (!isChunkMatch(match)) continue;
            const matchText = normalizeText(match.text || '');
            if (!matchText) continue;
            if (matchText.includes(sourceText.slice(0, 120)) || sourceText.includes(matchText.slice(0, 120))) {
                return true;
            }
        }
    }
    return false;
}

function truncateDigest(text, chars = DIGEST_SUMMARY_CHARS) {
    const flat = String(text || '');
    return flat.length <= chars ? flat : `${flat.slice(0, chars).trimEnd()}…`;
}

function buildCreditorDigest(pkg) {
    const flows = Array.isArray(pkg?.flows?.entries) ? pkg.flows.entries : [];
    const byRank = new Map();
    const byCreditor = new Map();
    const cessionChains = Array.isArray(pkg?.reconciliation?.valueChanges)
        ? pkg.reconciliation.valueChanges.slice(0, 20).map((vc) => ({
            description: vc.description || null,
            linkage: vc.linkage || null,
            originalValue: vc.originalValue ?? null,
            latestValue: vc.latestValue ?? null,
            currency: vc.currency || null,
            discountPct: vc.discountPct ?? null,
        }))
        : [];

    for (const entry of flows) {
        if (!entry) continue;
        const val = Number.isFinite(entry.valueEur) ? entry.valueEur : (Number.isFinite(entry.value) ? entry.value : null);
        const rank = entry.isplatniRed || 'neklasificirano';
        if (!byRank.has(rank)) byRank.set(rank, { isplatniRed: rank, count: 0, totalEur: 0 });
        const rankBucket = byRank.get(rank);
        rankBucket.count += 1;
        if (Number.isFinite(val)) rankBucket.totalEur = Number((rankBucket.totalEur + val).toFixed(2));

        const creditorKey = entry.canonicalPartyId || entry.transferee || entry.recipientName || entry.description || null;
        if (creditorKey && Number.isFinite(val)) {
            if (!byCreditor.has(creditorKey)) {
                byCreditor.set(creditorKey, {
                    creditor: entry.transferee || entry.recipientName || creditorKey,
                    canonicalPartyId: entry.canonicalPartyId || null,
                    isplatniRed: entry.isplatniRed || null,
                    totalEur: 0,
                    claimCount: 0,
                });
            }
            const c = byCreditor.get(creditorKey);
            c.totalEur = Number((c.totalEur + val).toFixed(2));
            c.claimCount += 1;
        }
    }

    const topCreditors = [...byCreditor.values()]
        .sort((a, b) => b.totalEur - a.totalEur)
        .slice(0, 25);

    return {
        byIsplatniRed: [...byRank.values()].sort((a, b) => b.totalEur - a.totalEur),
        topCreditors,
        cessionChains,
    };
}

function buildProceduralOutcomesDigest(pkg) {
    const analyses = Array.isArray(pkg?.analyses) ? pkg.analyses : [];
    const outcomeCounts = {};
    const milestoneEvents = [];
    for (const analysis of analyses) {
        if (analysis?.decisionOutcome) {
            outcomeCounts[analysis.decisionOutcome] = (outcomeCounts[analysis.decisionOutcome] || 0) + 1;
        }
        for (const ev of Array.isArray(analysis?.proceduralEvents) ? analysis.proceduralEvents : []) {
            if (!ev || typeof ev !== 'object') continue;
            milestoneEvents.push({
                date: ev.date || analysis.decisionDate || analysis.entryDate || null,
                eventType: ev.eventType || 'decision',
                instance: ev.instance || null,
                outcome: ev.outcome || null,
                filingReference: ev.filingReference || analysis.caseNumber || null,
                description: ev.description || null,
                docId: analysis.docId || analysis.id || null,
                fileName: analysis.fileName || null,
            });
        }
    }
    return {
        outcomeCounts,
        milestoneEvents: milestoneEvents.slice(0, 30),
    };
}

function buildSupplementalClaims(pkg, proceduralOutcomes) {
    const extra = [];
    const analyses = Array.isArray(pkg?.analyses) ? pkg.analyses : [];

    analyses.forEach((analysis, idx) => {
        if (analysis?.decisionOutcome) {
            extra.push({
                id: `outcome-${idx + 1}`,
                text: `Ishod odluke (${analysis.fileName || analysis.caseNumber || 'dokument'}): ${analysis.decisionOutcome}${analysis.decisionDate ? ` (${analysis.decisionDate})` : ''}.`,
                confidence: 'high',
                evidence: [{
                    sourceId: analysis.docId || analysis.id || `outcome-${idx + 1}`,
                    docId: analysis.docId || null,
                    text: analysis.summary || analysis.decisionOutcome,
                    metadata: {
                        sourceType: 'outcome',
                        fileName: analysis.fileName || null,
                        date: analysis.decisionDate || analysis.entryDate || null,
                        sourceEntryIndex: analysis.sourceEntryIndex ?? null,
                    },
                }],
            });
        }
    });

    proceduralOutcomes.milestoneEvents.forEach((ev, idx) => {
        extra.push({
            id: `procedural-${idx + 1}`,
            text: `Postupovni događaj [${ev.eventType}${ev.outcome ? ` / ${ev.outcome}` : ''}]${ev.instance ? ` (${ev.instance})` : ''}: ${ev.description || ev.filingReference || 'odluka'}.`,
            confidence: 'high',
            evidence: [{
                sourceId: ev.docId || `procedural-${idx + 1}`,
                docId: ev.docId || null,
                text: ev.description || ev.filingReference || '',
                metadata: {
                    sourceType: 'procedural',
                    fileName: ev.fileName || null,
                    date: ev.date || null,
                },
            }],
        });
    });

    const parties = Array.isArray(pkg?.canonicalParties) ? pkg.canonicalParties : [];
    parties.slice(0, 20).forEach((party, idx) => {
        extra.push({
            id: `party-${idx + 1}`,
            text: `Stranka ${party.name}${party.oib ? ` (OIB: ${party.oib})` : ''}${party.roles?.length ? ` — uloge: ${party.roles.join(', ')}` : ''} [${party.documentCount || 1} dok.].`,
            confidence: 'high',
            evidence: [{
                sourceId: party.canonicalPartyId || `party-${idx + 1}`,
                text: party.name,
                metadata: { sourceType: 'party' },
            }],
        });
    });

    return extra;
}

function claimRenderedLength(claim) {
    return String(claim?.text || '').length + CLAIM_WRAPPER_OVERHEAD_CHARS;
}

function spreadClaimsSlice(items, limit) {
    if (items.length <= limit) return items;
    if (limit <= 1) return [items[0]];
    return Array.from({ length: limit }, (_, index) => (
        items[Math.round(index * (items.length - 1) / (limit - 1))]
    ));
}

/**
 * Applies budget tiers with a 25% protected FTS5 BM25 floor and wrapper-aware
 * 64,000-char accounting.
 */
function applyBudgetTiers(claims, retrieval) {
    const cited = buildCitedIdentifiers(retrieval);
    cited.retrievalRef = retrieval;
    const decorated = claims.map((claim) => {
        const id = String(claim.id || '');
        const groundedMeta = claimPrimarySource(claim)?.metadata?.grounded;
        if ((id.startsWith('money-flow') || id.startsWith('property-flow')) && groundedMeta === false) {
            return { claim, tier: 'digest' };
        }
        if (id.startsWith('retrieved-')) return { claim, tier: 'protected-bm25' };
        if (id.startsWith('money-flow') || id.startsWith('property-flow') || id.startsWith('property-value-change') || id.startsWith('value-change-')) {
            return { claim, tier: 'full' };
        }
        if (id.startsWith('procedural-') || id.startsWith('outcome-') || id.startsWith('party-')) {
            return { claim, tier: 'full' };
        }
        if (id.startsWith('analysis-') || claimPrimarySource(claim)?.metadata?.sourceType === 'analysis') {
            return { claim, tier: isClaimCited(claim, cited) ? 'full-cited' : 'digest' };
        }
        return { claim, tier: 'full' };
    });

    const citedIndexes = decorated
        .map((entry, index) => entry.tier === 'full-cited' ? index : -1)
        .filter((index) => index >= 0);
    if (citedIndexes.length > FULL_CLAIM_LIMIT) {
        const keepIndexes = new Set();
        for (let slot = 0; slot < FULL_CLAIM_LIMIT; slot += 1) {
            const candidatePosition = FULL_CLAIM_LIMIT === 1
                ? 0
                : Math.round(slot * (citedIndexes.length - 1) / (FULL_CLAIM_LIMIT - 1));
            keepIndexes.add(citedIndexes[candidatePosition]);
        }
        for (const index of citedIndexes) {
            if (!keepIndexes.has(index)) decorated[index].tier = 'digest';
        }
    }

    let sized = decorated.map(({ claim, tier }) => (
        tier === 'digest'
            ? { ...claim, text: truncateDigest(claim.text), digest: true }
            : claim
    ));

    const totalChars = () => sized.reduce((sum, c) => sum + claimRenderedLength(c), 0);
    if (totalChars() > SYNTHESIS_INPUT_CHAR_BUDGET) {
        sized = sized.map((claim) => (
            claim.digest ? { ...claim, text: truncateDigest(claim.text, 120), digest: true } : claim
        ));
    }

    // Evict non-BM25 claims first so the 25% BM25 floor is never evicted by flow rows.
    const bm25Chars = () => sized
        .filter((c) => String(c.id || '').startsWith('retrieved-'))
        .reduce((sum, c) => sum + claimRenderedLength(c), 0);

    while (totalChars() > SYNTHESIS_INPUT_CHAR_BUDGET) {
        const nonBm25Idx = sized.findLastIndex((c) => !String(c.id || '').startsWith('retrieved-'));
        if (nonBm25Idx >= 0) {
            // Prefer keeping chronological spread by dropping from dense unthreaded flow/analysis tails
            sized.splice(nonBm25Idx, 1);
            continue;
        }
        if (bm25Chars() > PROTECTED_BM25_BUDGET) {
            const lastBm25 = sized.findLastIndex((c) => String(c.id || '').startsWith('retrieved-'));
            if (lastBm25 >= 0) {
                sized.splice(lastBm25, 1);
                continue;
            }
        }
        break;
    }

    return sized;
}

function buildSynthesisInput(clusterEvidencePackage, retrieval) {
    const normalizedEvidence = normalizeReasoningEvidence(clusterEvidencePackage);
    const creditorDigest = buildCreditorDigest(clusterEvidencePackage);
    const proceduralOutcomes = buildProceduralOutcomesDigest(clusterEvidencePackage);

    // Drop mechanical document-* inventory items before merging
    const baseClaims = (normalizedEvidence?.claims || []).filter((c) => !String(c?.id || '').startsWith('document-'));
    const supplementalClaims = buildSupplementalClaims(clusterEvidencePackage, proceduralOutcomes);
    const retrievedClaims = buildRetrievedEvidenceClaims(retrieval, clusterEvidencePackage);

    const mergedClaims = applyBudgetTiers(
        [...baseClaims, ...supplementalClaims, ...retrievedClaims],
        retrieval
    );

    const timelineBudget = Math.floor(SYNTHESIS_INPUT_CHAR_BUDGET * 0.15);
    const rawTimeline = normalizedEvidence?.timeline || [];
    const boundedTimeline = rawTimeline.length > 40 ? spreadClaimsSlice(rawTimeline, 40) : rawTimeline;
    let timelineChars = 0;
    const finalTimeline = [];
    for (const item of boundedTimeline) {
        const len = String(item?.description || '').length + 24;
        if (timelineChars + len > timelineBudget && finalTimeline.length > 0) break;
        timelineChars += len;
        finalTimeline.push(item);
    }

    return {
        ...(normalizedEvidence || {}),
        timeline: finalTimeline,
        claims: mergedClaims,
        creditorDigest,
        proceduralOutcomes,
        meta: {
            ...(normalizedEvidence?.meta || {}),
            creditorDigest,
            proceduralOutcomes,
            retrieval
        }
    };
}

function appendContextClaims(flatClaims, contextClaims) {
    return [
        ...(Array.isArray(flatClaims) ? flatClaims : []),
        ...(Array.isArray(contextClaims) ? contextClaims : []),
    ];
}

module.exports = {
    buildSynthesisInput,
    buildRetrievedEvidenceClaims,
    buildCreditorDigest,
    buildProceduralOutcomesDigest,
    appendContextClaims,
    SYNTHESIS_INPUT_CHAR_BUDGET,
    PROTECTED_BM25_BUDGET,
};
