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
        const source = createSource(
            analysis.id || analysis.filePath || analysis.fileName,
            [analysis.summary, analysis.fileName, analysis.caseNumber, analysis.decisionDate]
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

    return {
        indexType: 'lexical',
        clusterId: evidencePackage?.clusterId || null,
        sources,
        metrics: {
            sourceCount: sources.length,
            tokenCount: sources.reduce((sum, source) => sum + source.tokens.length, 0),
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
