const { buildLexicalIndex, collectSources, normalizeText, tokenize } = require('./indexer');

// Hybrid token scoring weights (Phase 0.4). Substring matching stays as a
// fallback signal — it acts as accidental Croatian stemming (trazbina matches
// trazbine) — but exact-token agreement earns full weight and IDF scaling
// demotes generic vocabulary that appears in nearly every source.
const EXACT_TOKEN_WEIGHT = 1;
const STEM_MATCH_WEIGHT = 0.4;
function uniqueSorted(values) {
    return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))].sort();
}

function createLedgerQueries(evidencePackage) {
    const facts = Array.isArray(evidencePackage?.factLedger) ? evidencePackage.factLedger : [];
    const partyAnchors = uniqueSorted([
        ...(evidencePackage?.identity?.participantOibs || []),
        ...(evidencePackage?.identity?.participantNames || []),
        ...(evidencePackage?.analyses || []).flatMap((analysis) => (
            Array.isArray(analysis.documentParties)
                ? analysis.documentParties.flatMap((party) => [party.oib, party.name])
                : []
        )),
        ...facts.flatMap((fact) => Object.values(fact.parties || {}).filter((value) => typeof value === 'string')),
    ]);
    const filingAnchors = uniqueSorted([
        ...facts.flatMap((fact) => [
            fact.claimRegistryNumber,
            fact.filingReference,
            ...(Array.isArray(fact.references) ? fact.references : []),
        ]),
        ...(evidencePackage?.analyses || []).flatMap((analysis) => [
            ...(Array.isArray(analysis.citedFilingReferences) ? analysis.citedFilingReferences : []),
            ...(Array.isArray(analysis.proceduralEvents) ? analysis.proceduralEvents.flatMap((event) => [
                event.filingReference,
                ...(Array.isArray(event.citedFilingReferences) ? event.citedFilingReferences : []),
            ]) : []),
        ]),
    ]);
    const conflicts = [
        ...(evidencePackage?.reconciliation?.conflicts || []),
        ...(evidencePackage?.reconciliation?.openQuestions || []),
    ];
    const conflictTerms = uniqueSorted(conflicts.flatMap((conflict) => [
        conflict.finding,
        conflict.reason,
        conflict.text,
        ...(Array.isArray(conflict.unresolvedReferences) ? conflict.unresolvedReferences : []),
        ...(Array.isArray(conflict.sources) ? conflict.sources : []),
    ]));
    const queryType = ['oib', 'case_number', 'text'].includes(evidencePackage?.query?.type)
        ? evidencePackage.query.type
        : 'text';
    return [
        ...(partyAnchors.length ? [{
            id: 'ledger-parties', purpose: 'ledger-party-identities', text: partyAnchors.join(' '), anchors: partyAnchors, queryType,
        }] : []),
        ...(filingAnchors.length ? [{
            id: 'ledger-filings', purpose: 'ledger-filing-identifiers', text: filingAnchors.join(' '), anchors: filingAnchors, queryType,
        }] : []),
        ...(conflictTerms.length ? [{
            id: 'ledger-conflicts', purpose: 'unresolved-ledger-conflicts', text: conflictTerms.join(' '), anchors: filingAnchors, queryType,
        }] : []),
    ];
}


function scoreSource(source, retrievalQuery, evidencePackage, idfStats = null) {
    const normalizedSource = source.normalizedText || normalizeText(source.text);
    const sourceTokenSet = new Set(source.tokens || []);
    const queryTokens = tokenize(retrievalQuery.text);
    const reasons = [];
    let score = 0;

    for (const token of queryTokens) {
        let weight = 0;
        let reasonKind = null;
        if (sourceTokenSet.has(token)) {
            weight = EXACT_TOKEN_WEIGHT;
            reasonKind = `token:${token}`;
        } else if (normalizedSource.includes(token)) {
            // Substring hit on the normalized text — pseudo-stemming credit.
            weight = STEM_MATCH_WEIGHT;
            reasonKind = `stem:${token}`;
        }
        if (weight === 0) continue;

        if (idfStats && idfStats.totalSources > 0) {
            const documentFrequency = idfStats.df?.[token] || 0;
            const idf = Math.log(1 + idfStats.totalSources / (documentFrequency || 0.5));
            // Squash to (0, 1] so scores stay comparable with/without stats.
            weight *= idf / (idf + 1);
        }
        score += weight;
        reasons.push(reasonKind);
    }

    for (const anchor of retrievalQuery.anchors || []) {
        const normalizedAnchor = normalizeText(anchor);
        if (normalizedAnchor && normalizedSource.includes(normalizedAnchor)) {
            const boost = retrievalQuery.queryType === 'oib' && /^\d{11}$/.test(String(anchor)) ? 5 : 3;
            score += boost;
            reasons.push(`anchor:${anchor}`);
        }
    }

    const sourceCaseNumber = source.metadata?.caseNumber;
    if (sourceCaseNumber && evidencePackage?.clusterId && sourceCaseNumber === evidencePackage.clusterId) {
        score += 2;
        reasons.push('same-cluster');
    }

    return {
        score,
        reasons
    };
}
function createRetrievalQueries({ query = null, clusterId = null, primaryCaseNumber = null, identity = {} } = {}) {
    const queryType = ['oib', 'case_number', 'text'].includes(query?.type) ? query.type : 'text';
    const caseNumber = primaryCaseNumber || clusterId || '';
    const participantOibs = Array.isArray(identity.participantOibs) ? identity.participantOibs : [];
    const participantNames = Array.isArray(identity.participantNames) ? identity.participantNames : [];
    const anchors = [query?.value || '', caseNumber, ...participantOibs, ...participantNames].filter(Boolean);

    return [
        {
            id: 'timeline',
            purpose: 'timeline',
            text: ['datumi ročište rješenje zaključak objava tijek predmeta', caseNumber].filter(Boolean).join(' '),
            anchors,
            queryType
        },
        {
            id: 'amounts',
            purpose: 'financial-amounts',
            text: ['iznos tražbina dug uplata kamata eur hrk trošak', caseNumber].filter(Boolean).join(' '),
            anchors,
            queryType
        },
        {
            id: 'procedural-status',
            purpose: 'procedural-status',
            text: ['status postupka stečaj obustava nastavak pravomoćnost odluka', caseNumber].filter(Boolean).join(' '),
            anchors,
            queryType
        },
        {
            id: 'party-roles',
            purpose: 'party-roles',
            text: ['dužnik vjerovnik stranka sudionik oib tvrtka osoba', ...participantNames].filter(Boolean).join(' '),
            anchors,
            queryType
        },
        {
            id: 'property-flow',
            purpose: 'property-assets',
            text: ['imovina nekretnina pokretnina tražbina ustup cesija hipoteka katastar prodaja imovine', caseNumber].filter(Boolean).join(' '),
            anchors,
            queryType
        }
    ];
}


function retrieveEvidence(evidencePackage, options = {}) {
    const templates = createRetrievalQueries({
        query: evidencePackage?.query,
        clusterId: evidencePackage?.clusterId,
        primaryCaseNumber: evidencePackage?.primaryCaseNumber,
        identity: evidencePackage?.identity
    });
    const queries = Array.isArray(options.queries) && options.queries.length > 0
        ? options.queries
        : [...templates, ...createLedgerQueries(evidencePackage)];
    const topK = options.topK ?? 5;
    const index = options.index || buildLexicalIndex(evidencePackage);
    const useFts = Boolean(options.runId && typeof options.analysisStore?.searchRunChunks === 'function');

    const results = queries.map((query) => {
        const lexicalMatches = index.sources
            .filter((source) => !useFts || source.metadata?.sourceType !== 'chunk')
            .map((source, sourceIndex) => {
                const scored = scoreSource(source, query, evidencePackage, index.idfStats || null);
                return {
                    sourceId: source.id,
                    text: source.text,
                    score: scored.score,
                    reasons: scored.reasons,
                    metadata: source.metadata,
                    sourceIndex
                };
            })
            .filter((match) => match.score > 0);

        const ftsResult = useFts
            ? options.analysisStore.searchRunChunks({
                runId: options.runId,
                query: query.text,
                operator: 'OR',
                limit: topK,
                offset: 0,
            })
            : { chunks: [] };
        const ftsMatches = ftsResult.chunks.map((chunk) => {
            const normalizedText = normalizeText(chunk.normalizedText || chunk.text).replace(/[^a-z0-9]+/g, ' ').trim();
            const reasons = ['fts5-bm25'];
            let anchorBoost = 0;
            for (const anchor of query.anchors || []) {
                const normalizedAnchor = normalizeText(anchor).replace(/[^a-z0-9]+/g, ' ').trim();
                if (!normalizedAnchor) continue;
                const matched = /^\d{11}$/.test(String(anchor))
                    ? new RegExp(`(^|\\D)${String(anchor)}(?!\\d)`).test(normalizedText)
                    : normalizedText.includes(normalizedAnchor);
                if (!matched) continue;
                const boost = /^\d{11}$/.test(String(anchor)) ? 5 : (/[a-z].*[/-]\d|\d.*[/-]\d/i.test(String(anchor)) ? 3 : 1);
                anchorBoost += boost;
                reasons.push(`anchor:${anchor}`);
            }
            const rank = Number.isFinite(chunk.rank) ? chunk.rank : 0;
            return {
                sourceId: chunk.chunkId,
                text: chunk.text,
                snippet: chunk.snippet,
                score: 20 + Math.max(0, -rank) + anchorBoost,
                rank,
                reasons,
                metadata: {
                    sourceType: 'chunk',
                    docId: chunk.docId,
                    fileName: chunk.fileName,
                    caseNumber: chunk.caseNumber,
                    sourceEntryIndex: chunk.sourceEntryIndex,
                    pageNumbers: chunk.pageNumbers,
                    startIndex: chunk.startIndex,
                    endIndex: chunk.endIndex,
                },
            };
        });

        const matches = [...lexicalMatches, ...ftsMatches]
            .sort((a, b) => b.score - a.score || (a.rank ?? 0) - (b.rank ?? 0) || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0))
            .slice(0, topK)
            .map(({ sourceIndex, ...match }) => match);

        return { query, matches };
    });

    return {
        queries,
        results,
        metrics: {
            queryCount: queries.length,
            sourceCount: index.sources.length,
            indexBuildTimeMs: index.metrics.buildTimeMs,
            tokenCount: index.metrics.tokenCount,
            sourceTypeCounts: index.metrics.sourceTypeCounts,
            matchCount: results.reduce((sum, result) => sum + result.matches.length, 0)
        }
    };
}

module.exports = {
    collectSources,
    retrieveEvidence,
    createLedgerQueries,
    tokenize
};

