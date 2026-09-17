const { normalizeReasoningEvidence } = require('./synthesizer');
const { normalizeText } = require('./indexer');

// --- Synthesis budget tiers (Phase 0.5) -------------------------------------
// Concrete ranking rule (refinement: write the join down or the implementation
// will improvise): an analysis-derived claim keeps FULL length when a surviving
// GROUND-TRUTH CHUNK match cites it — match.metadata.sourceType === 'chunk'
// and its metadata.fileName equals the claim's evidence fileName, or
// match.sourceId equals the claim's evidence sourceId. Analysis summaries are
// themselves retrieval sources, so counting them would make a claim "cited"
// whenever its own summary survives a query — self-referential and useless.
// Everything else degrades to a digest. Money-flow claims are always full:
// they are short, structured, and load-bearing for who-owes-whom.
const FULL_CLAIM_LIMIT = 12;
const DIGEST_SUMMARY_CHARS = 280;
const SYNTHESIS_INPUT_CHAR_BUDGET = 48000;

function isChunkMatch(match) {
    return match?.metadata?.sourceType === 'chunk';
}

function isSelectedClusterMatch(match, clusterId) {
    const matchCaseNumber = match?.metadata?.caseNumber;
    return !clusterId || !matchCaseNumber || matchCaseNumber === clusterId;
}

/**
 * Builds the set of "cited" identifiers from surviving GROUND-TRUTH CHUNK
 * matches so claim tiering is a deterministic join, not a heuristic vibe.
 */
function buildCitedIdentifiers(rerankedRetrieval) {
    const fileNames = new Set();
    const sourceIds = new Set();
    for (const result of iterResults(rerankedRetrieval)) {
        for (const match of result.matches || []) {
            if (!isChunkMatch(match)) continue;
            const fileName = match?.metadata?.fileName;
            if (fileName) fileNames.add(normalizeText(fileName));
            if (match?.sourceId) sourceIds.add(match.sourceId);
        }
    }
    return { fileNames, sourceIds };
}

function iterResults(rerankedRetrieval) {
    return Array.isArray(rerankedRetrieval?.results) ? rerankedRetrieval.results : [];
}

function buildRetrievedEvidenceClaims(rerankedRetrieval, clusterEvidencePackage) {
    const clusterId = clusterEvidencePackage?.clusterId;

    return (rerankedRetrieval?.results || []).flatMap((result, resultIndex) => (
        (result.matches || [])
            .filter((match) => isSelectedClusterMatch(match, clusterId))
            .map((match, matchIndex) => ({
                id: `retrieved-${result.query?.id || resultIndex + 1}-${matchIndex + 1}`,
                text: `Relevantni izvor (${result.query?.purpose || result.query?.id || 'retrieval'}): ${match.text}`,
                confidence: 'medium',
                evidence: [{
                    sourceId: match.sourceId || `retrieved-${resultIndex + 1}-${matchIndex + 1}`,
                    text: match.text,
                    retrievalScore: match.score,
                    retrievalReasons: match.reasons || [],
                    lexicalRank: match.lexicalRank ?? null,
                    rerankStatus: match.rerankStatus || rerankedRetrieval?.rerankStatus || null,
                    rerankScore: match.rerankScore ?? null,
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
    if (source.sourceId && cited.sourceIds.has(source.sourceId)) return true;
    const fileName = source.metadata?.fileName;
    if (fileName && cited.fileNames.has(normalizeText(fileName))) return true;

    // Text-overlap join: chunk matches quote document content that analysis
    // summaries paraphrase; normalized containment in either direction counts
    // as citation. Chunk-only (see buildCitedIdentifiers) so a summary matching
    // itself in the index never self-cites.
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

/**
 * Applies budget tiers to the deterministic claims list. Order preserved;
 * degradation walks uncited analysis claims first, then cited ones, then
 * money-flow/structural claims last (they are small and factual).
 */
function applyBudgetTiers(claims, rerankedRetrieval) {
    const cited = buildCitedIdentifiers(rerankedRetrieval);
    cited.retrievalRef = rerankedRetrieval;

    const decorated = claims.map((claim) => {
        const id = String(claim.id || '');
        const groundedMeta = claimPrimarySource(claim)?.metadata?.grounded;
        // Unverified extraction-time claims never keep full length: an
        // ungrounded money/property entry degrades to a digest even though
        // those families are otherwise always full (short + load-bearing).
        if ((id.startsWith('money-flow') || id.startsWith('property-flow')) && groundedMeta === false) {
            return { claim, tier: 'digest' };
        }
        if (id.startsWith('money-flow')) return { claim, tier: 'full' };
        if (id.startsWith('property-flow') || id.startsWith('property-value-change')) return { claim, tier: 'full' };
        if (id.startsWith('analysis-') || claimPrimarySource(claim)?.metadata?.sourceType === 'analysis') {
            return { claim, tier: isClaimCited(claim, cited) ? 'full-cited' : 'digest' };
        }
        return { claim, tier: 'full' }; // structural/document-link claims are short
    });

    // Cap full analysis claims at FULL_CLAIM_LIMIT by citation order.
    let fullCount = 0;
    for (const entry of decorated) {
        if (entry.tier !== 'full-cited') continue;
        fullCount += 1;
        if (fullCount > FULL_CLAIM_LIMIT) entry.tier = 'digest';
    }

    let sized = decorated.map(({ claim, tier }) => (
        tier === 'digest'
            ? { ...claim, text: truncateDigest(claim.text), digest: true }
            : claim
    ));

    // Hard char budget: degrade remaining digests to one-liners, then drop
    // retrieved claims from the tail. Structural/money-flow survive longest.
    const totalChars = () => sized.reduce((sum, c) => sum + c.text.length, 0);
    if (totalChars() > SYNTHESIS_INPUT_CHAR_BUDGET) {
        sized = sized.map((claim) => (
            claim.digest ? { ...claim, text: truncateDigest(claim.text, 120), digest: true } : claim
        ));
    }
    while (totalChars() > SYNTHESIS_INPUT_CHAR_BUDGET && sized.some((c) => c.id?.startsWith('retrieved-'))) {
        const lastRetrieved = sized.map((c) => c.id?.startsWith('retrieved-')).lastIndexOf(true);
        sized.splice(lastRetrieved, 1);
    }

    return sized;
}

function buildSynthesisInput(clusterEvidencePackage, retrieval, rerankedRetrieval = retrieval) {
    const normalizedEvidence = normalizeReasoningEvidence(clusterEvidencePackage);
    const retrievedClaims = buildRetrievedEvidenceClaims(rerankedRetrieval, clusterEvidencePackage);

    const mergedClaims = applyBudgetTiers(
        [...(normalizedEvidence?.claims || []), ...retrievedClaims],
        rerankedRetrieval
    );

    return {
        ...(normalizedEvidence || {}),
        timeline: normalizedEvidence?.timeline || [],
        claims: mergedClaims,
        meta: {
            ...(normalizedEvidence?.meta || {}),
            retrieval,
            rerank: rerankedRetrieval
        }
    };
}

module.exports = {
    buildSynthesisInput,
    buildRetrievedEvidenceClaims
};
