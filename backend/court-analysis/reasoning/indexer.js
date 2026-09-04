const CROATIAN_STOP_WORDS = new Set([
    'a', 'ali', 'i', 'ili', 'je', 'se', 'su', 'u', 'za', 'na', 'od', 'do', 'po', 'sa', 's', 'te', 'to'
]);

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(value) {
    return normalizeText(value)
        .split(/[^a-z0-9čćđšž]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !CROATIAN_STOP_WORDS.has(token));
}

function createSource(id, text, metadata = {}) {
    const normalizedText = String(text || '').trim();
    if (!normalizedText) return null;

    return {
        id,
        text: normalizedText,
        metadata
    };
}

function collectSources(evidencePackage) {
    const sources = [];

    if (Array.isArray(evidencePackage?.chunks)) {
        for (const chunk of evidencePackage.chunks) {
            const source = createSource(chunk.id, chunk.text, {
                ...(chunk.metadata || {}),
                sourceType: 'chunk'
            });
            if (source) sources.push(source);
        }
    }

    for (const entry of evidencePackage?.entries || []) {
        const source = createSource(
            entry.detailLink || `${evidencePackage.clusterId}:entry-${entry.index ?? sources.length}`,
            [
                entry.title,
                entry.caseNumber,
                entry.court,
                entry.date,
                ...(entry.participants || []).flatMap((participant) => [participant.name, participant.oib])
            ].filter(Boolean).join(' '),
            {
                sourceType: 'entry',
                caseNumber: entry.caseNumber,
                entryDisplayId: entry.entryDisplayId,
                acquisition: entry.acquisition || null
            }
        );
        if (source) sources.push(source);
    }

    for (const link of evidencePackage?.documentLinks || []) {
        const source = createSource(
            link.id || link.url,
            [link.text, link.url, link.caseNumber, link.entryTitle].filter(Boolean).join(' '),
            {
                sourceType: 'document-link',
                caseNumber: link.caseNumber,
                url: link.url,
                entryDisplayId: link.entryDisplayId,
                sourceProvenance: link.sourceProvenance || null
            }
        );
        if (source) sources.push(source);
    }

    // Per-document AI analyses carry the actual legal substance (summaries,
    // amounts, decision dates). Indexing them lets the retriever find real
    // content instead of only structural metadata.
    for (const analysis of evidencePackage?.analyses || []) {
        const amountText = (Array.isArray(analysis.amounts) ? analysis.amounts : [])
            .map((amount) => `${amount.amount || ''} ${amount.currency || ''} ${amount.description || ''}`.trim())
            .filter(Boolean)
            .join(' ');
        const propertyText = (Array.isArray(analysis.propertyFlow) ? analysis.propertyFlow : [])
            .map((item) => `${item.value ?? ''} ${item.currency || ''} ${item.description || ''} ${item.transferor || ''} ${item.transferee || ''}`.trim())
            .filter(Boolean)
            .join(' ');
        const source = createSource(
            analysis.id || analysis.filePath || analysis.fileName,
            [analysis.summary, analysis.fileName, analysis.caseNumber, analysis.decisionDate, amountText, propertyText]
                .filter(Boolean)
                .join(' '),
            {
                sourceType: 'analysis',
                caseNumber: analysis.caseNumber || null,
                fileName: analysis.fileName || null,
                decisionDate: analysis.decisionDate || null
            }
        );
        if (source) sources.push(source);
    }

    return sources;
}

function buildLexicalIndex(evidencePackage) {
    const startedAt = Date.now();
    const sources = collectSources(evidencePackage).map((source, sourceIndex) => {
        const tokens = tokenize(source.text);
        return {
            ...source,
            sourceIndex,
            normalizedText: normalizeText(source.text),
            tokens
        };
    });

    // Document frequency per unique token across sources — feeds IDF weighting
    // in the retriever so generic vocabulary (present in nearly every source)
    // stops dominating lexical scores.
    const df = new Map();
    for (const source of sources) {
        for (const token of new Set(source.tokens)) {
            df.set(token, (df.get(token) || 0) + 1);
        }
    }

    // Per-sourceType composition of the index — persisted via report meta so
    // chunk-vs-summary grounding ratios are auditable after the run, not just
    // logged once to a console nobody re-reads.
    const sourceTypeCounts = {};
    for (const source of sources) {
        const type = source.metadata?.sourceType || 'unknown';
        sourceTypeCounts[type] = (sourceTypeCounts[type] || 0) + 1;
    }

    return {
        indexType: 'lexical',
        clusterId: evidencePackage?.clusterId || null,
        sources,
        idfStats: {
            totalSources: sources.length,
            df: Object.fromEntries(df)
        },
        metrics: {
            sourceCount: sources.length,
            tokenCount: sources.reduce((sum, source) => sum + source.tokens.length, 0),
            sourceTypeCounts,
            buildTimeMs: Date.now() - startedAt
        }
    };
}

module.exports = {
    buildLexicalIndex,
    collectSources,
    normalizeText,
    tokenize
};
