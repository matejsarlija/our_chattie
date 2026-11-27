const { sanitizeMarkdown } = require('./sanitize');
const { deriveEntryDisplayId } = require('../court-analysis/utils/entryDisplayId');

const MAX_ARTIFACT_FLOW_ENTRIES = 25;
const MAX_ARTIFACT_CONFLICTS = 25;
const MAX_ARTIFACT_QUESTIONS = 15;
const MAX_ARTIFACT_VALUE_CHANGES = 15;
const MAX_ARTIFACT_PARTIES = 60;

function boundStr(value, maxChars) {
    if (typeof value !== 'string') return value ?? null;
    return value.length <= maxChars ? value : `${value.slice(0, maxChars).trimEnd()}…`;
}

function mapProcessedCase(processedCase) {
    return {
        caseResult: {
            title: processedCase?.caseResult?.title,
            caseNumber: processedCase?.caseResult?.caseNumber,
            court: processedCase?.caseResult?.court,
            date: processedCase?.caseResult?.date,
            detailLink: processedCase?.caseResult?.detailLink,
            entryDisplayId: deriveEntryDisplayId(processedCase?.caseResult?.detailLink),
            participants: processedCase?.caseResult?.participants,
        },
        files: Array.isArray(processedCase?.files)
            ? processedCase.files.map((file) => ({ url: file.url, text: file.text }))
            : [],
        analysis: {
            individualAnalyses: Array.isArray(processedCase?.analysis?.individualAnalyses)
                ? processedCase.analysis.individualAnalyses.map((item) => ({
                    fileName: item.text,
                    error: item.error,
                    ...(item.docId !== undefined ? { docId: item.docId } : {}),
                    ...(item.docClass !== undefined ? { docClass: item.docClass } : {}),
                    ...(item.ocrEngine !== undefined ? { ocrEngine: item.ocrEngine } : {}),
                    ...(item.fromCache !== undefined ? { fromCache: Boolean(item.fromCache) } : {}),
                    ...(item.adminFastPath !== undefined ? { adminFastPath: Boolean(item.adminFastPath) } : {}),
                    ...(item.pageCount !== undefined ? { pageCount: item.pageCount } : {}),
                    ...(Array.isArray(item.skippedPageRanges) && item.skippedPageRanges.length > 0
                        ? { skippedPageRanges: item.skippedPageRanges }
                        : {}),
                    ...(item.reasonCode !== undefined ? { reasonCode: item.reasonCode } : {}),
                }))
                : [],
            coverage: processedCase?.analysis?.coverage || null
        },
        groupMetadata: processedCase?.groupMetadata || null
    };
}

function slimAnalysisForArtifact(analysis, compact = false) {
    if (!analysis || typeof analysis !== 'object') return analysis;
    return {
        id: analysis.id ?? null,
        docId: analysis.docId ?? null,
        fileName: analysis.fileName ?? null,
        caseNumber: analysis.caseNumber ?? null,
        decisionDate: analysis.decisionDate ?? null,
        decisionOutcome: analysis.decisionOutcome ?? null,
        entryDate: analysis.entryDate ?? null,
        sourceEntryIndex: analysis.sourceEntryIndex ?? null,
        sourceDocumentLinkId: analysis.sourceDocumentLinkId ?? null,
        ...(compact ? {} : { extraction: analysis.extraction ?? null }),
        summary: boundStr(analysis.summary, compact ? 140 : 400),
        ...(analysis.truncated ? { truncated: true } : {}),
        ...(analysis.degraded ? { degraded: true } : {}),
    };
}

function slimFlowEntryForArtifact(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    return {
        id: entry.id ?? null,
        kind: entry.kind ?? null,
        canonicalPartyId: entry.canonicalPartyId ?? null,
        assetType: entry.assetType ?? null,
        description: boundStr(entry.description, 200),
        value: entry.value ?? null,
        valueEur: entry.valueEur ?? null,
        sourceAmount: entry.sourceAmount ?? null,
        sourceCurrency: entry.sourceCurrency ?? null,
        currency: entry.currency ?? null,
        amountEur: entry.amountEur ?? null,
        date: entry.date ?? null,
        direction: entry.direction ?? null,
        eventType: entry.eventType ?? null,
        transferor: entry.transferor ?? null,
        transferee: entry.transferee ?? null,
        isplatniRed: entry.isplatniRed ?? null,
        claimRegistryNumber: entry.claimRegistryNumber ?? null,
        docId: entry.docId ?? null,
        sourceId: entry.sourceId ?? null,
        fileName: entry.fileName ?? null,
        sourcePages: Array.isArray(entry.sourcePages) ? entry.sourcePages : [],
        sourceChunkId: entry.sourceChunkId ?? null,
        grounded: Boolean(entry.grounded),
        crossCategoryFactId: entry.crossCategoryFactId ?? null,
    };
}

function slimFlowsForArtifact(flows) {
    if (!flows || typeof flows !== 'object') return flows;
    const entries = Array.isArray(flows.entries) ? flows.entries : [];
    return {
        count: flows.count ?? entries.length,
        currencyTotals: flows.currencyTotals || {},
        hasFlows: Boolean(flows.hasFlows ?? entries.length > 0),
        ...(entries.length > MAX_ARTIFACT_FLOW_ENTRIES ? { truncated: true } : {}),
        entries: entries.slice(0, MAX_ARTIFACT_FLOW_ENTRIES).map(slimFlowEntryForArtifact),
    };
}

function slimConflictForArtifact(c) {
    if (!c || typeof c !== 'object') return c;
    return {
        finding: boundStr(c.finding, 300),
        reason: boundStr(c.reason, 300),
        sources: Array.isArray(c.sources) ? c.sources.slice(0, 8) : [],
        source: c.source ?? 'reconciliation',
        kind: c.kind ?? 'arithmetic',
    };
}

function slimQuestionForArtifact(q) {
    if (typeof q === 'string') return boundStr(q, 300);
    if (!q || typeof q !== 'object') return q;
    return {
        ...q,
        text: boundStr(q.text, 300),
        ...(Array.isArray(q.documents) ? { documents: q.documents.slice(0, 5) } : {}),
    };
}

function slimReconciliationForArtifact(reconciliation) {
    if (!reconciliation || typeof reconciliation !== 'object') return reconciliation;
    const conflicts = Array.isArray(reconciliation.conflicts) ? reconciliation.conflicts : [];
    const openQuestions = Array.isArray(reconciliation.openQuestions) ? reconciliation.openQuestions : [];
    const validationWarnings = Array.isArray(reconciliation.validationWarnings) ? reconciliation.validationWarnings : [];
    const valueChanges = Array.isArray(reconciliation.valueChanges) ? reconciliation.valueChanges : [];
    return {
        conflicts: conflicts.slice(0, MAX_ARTIFACT_CONFLICTS).map(slimConflictForArtifact),
        openQuestions: openQuestions.slice(0, MAX_ARTIFACT_QUESTIONS).map(slimQuestionForArtifact),
        validationWarnings: validationWarnings.slice(0, 10).map(slimQuestionForArtifact),
        valueChanges: valueChanges.slice(0, MAX_ARTIFACT_VALUE_CHANGES).map((vc) => ({
            description: boundStr(vc.description, 200),
            linkage: vc.linkage ?? null,
            originalValue: vc.originalValue ?? null,
            latestValue: vc.latestValue ?? null,
            currency: vc.currency ?? null,
            delta: vc.delta ?? null,
            discountPct: vc.discountPct ?? null,
            comparisonStatus: vc.comparisonStatus ?? null,
            finding: boundStr(vc.finding, 250),
            stages: Array.isArray(vc.stages)
                ? vc.stages.slice(0, 6).map((s) => ({
                    id: s.id ?? null,
                    eventType: s.eventType ?? null,
                    value: s.value ?? null,
                    currency: s.currency ?? null,
                    date: s.date ?? null,
                    fileName: s.fileName ?? null,
                }))
                : [],
        })),
        totalConflicts: conflicts.length,
        totalOpenQuestions: openQuestions.length,
        totalValueChanges: valueChanges.length,
    };
}

function slimRetrievalForArtifact(retrieval) {
    if (!retrieval || typeof retrieval !== 'object') return retrieval;
    const results = Array.isArray(retrieval.results) ? retrieval.results : [];
    const queries = Array.isArray(retrieval.queries) ? retrieval.queries : [];
    return {
        queries: queries.slice(0, 10).map((q) => ({
            id: q?.id ?? null,
            purpose: q?.purpose ?? null,
            text: boundStr(q?.text, 120),
            queryType: q?.queryType ?? null,
        })),
        metrics: retrieval.metrics || null,
        results: results.slice(0, 10).map((r) => ({
            query: r.query ? { id: r.query.id ?? null, purpose: r.query.purpose ?? null, text: boundStr(r.query.text, 120) } : null,
            matches: (Array.isArray(r.matches) ? r.matches : []).slice(0, 3).map((m) => ({
                sourceId: m.sourceId ?? null,
                fileName: m.fileName ?? m.metadata?.fileName ?? null,
                sourceType: m.sourceType ?? m.metadata?.sourceType ?? null,
                score: m.score ?? null,
                reasons: Array.isArray(m.reasons) ? m.reasons.slice(0, 3) : [],
                snippet: boundStr(m.snippet || m.text || '', 180),
            })),
        })),
    };
}

function mapClusterEvidencePackage(pkg) {
    if (!pkg || typeof pkg !== 'object') return pkg || null;
    const {
        chunks,
        factLedger,
        analyses,
        proceduralFlow,
        citationGraph,
        flows,
        reconciliation,
        entries,
        canonicalParties,
        documentLinks,
        ...rest
    } = pkg;
    const mapped = { ...rest };
    if (Array.isArray(chunks) && chunks.length > 0) {
        mapped.chunkCount = chunks.length;
    }
    if (Array.isArray(factLedger)) {
        mapped.factLedgerCount = factLedger.length;
    }
    if (Array.isArray(analyses)) {
        const compact = analyses.length > 30;
        mapped.analysesCount = analyses.length;
        mapped.analyses = (analyses.length > 50 ? analyses.slice(0, 50) : analyses)
            .map((a) => slimAnalysisForArtifact(a, compact));
    }
    if (proceduralFlow && typeof proceduralFlow === 'object') {
        mapped.proceduralFlowSummary = {
            eventCount: Array.isArray(proceduralFlow.events) ? proceduralFlow.events.length : 0,
            chainCount: Array.isArray(proceduralFlow.chains) ? proceduralFlow.chains.length : 0,
        };
    }
    if (citationGraph && typeof citationGraph === 'object') {
        const nodes = Array.isArray(citationGraph.nodes) ? citationGraph.nodes : [];
        const edges = Array.isArray(citationGraph.edges) ? citationGraph.edges : [];
        mapped.citationGraph = edges.length > 50
            ? { nodeCount: nodes.length, edgeCount: edges.length }
            : citationGraph;
    }
    if (Array.isArray(entries)) {
        mapped.entries = entries.length > 20
            ? entries.map((e) => ({
                index: e.index ?? null,
                caseNumber: e.caseNumber ?? null,
                title: e.title ?? null,
                date: e.date ?? null,
                detailLink: e.detailLink ?? null,
                documentCount: e.documentCount ?? null,
            }))
            : entries;
    }
    if (Array.isArray(documentLinks)) {
        mapped.documentLinks = documentLinks.length > 20
            ? documentLinks.map((dl) => ({ id: dl.id ?? null, url: dl.url ?? null, text: dl.text ?? null }))
            : documentLinks;
    }
    if (Array.isArray(canonicalParties)) {
        mapped.canonicalParties = canonicalParties.slice(0, MAX_ARTIFACT_PARTIES);
    }
    if (flows !== undefined) {
        mapped.flows = slimFlowsForArtifact(flows);
    }
    if (reconciliation !== undefined) {
        mapped.reconciliation = slimReconciliationForArtifact(reconciliation);
    }
    return mapped;
}

function mapReportForArtifact(report) {
    if (!report || typeof report !== 'object') return report || null;
    const { verifiedFindings, conflicts, ...restReport } = report;
    const mapped = { ...restReport };
    if (Array.isArray(conflicts)) {
        mapped.conflicts = conflicts.slice(0, MAX_ARTIFACT_CONFLICTS).map(slimConflictForArtifact);
    }
    if (Array.isArray(mapped.findings)) {
        mapped.findings = mapped.findings.map((f) => ({
            ...f,
            citations: Array.isArray(f?.citations)
                ? f.citations.slice(0, 8).map((c) => {
                    if (!c || typeof c !== 'object') return c;
                    const { retrievedBy, ...restCit } = c;
                    return {
                        ...restCit,
                        ...(restCit.text ? { text: boundStr(restCit.text, 200) } : {}),
                        ...(Array.isArray(retrievedBy) && retrievedBy.length > 0
                            ? { retrievedBy: retrievedBy.slice(0, 1).map((r) => ({ queryId: r.queryId, queryText: boundStr(r.queryText, 100), score: r.score })) }
                            : {}),
                    };
                })
                : f?.citations,
        }));
    }
    if (mapped.meta && typeof mapped.meta === 'object') {
        const {
            flows,
            proceduralFlow,
            reconciliation,
            documentLinks,
            coverage,
            creditorDigest,
            proceduralOutcomes,
            retrieval,
            ...restMeta
        } = mapped.meta;
        mapped.meta = {
            ...restMeta,
            ...(retrieval ? { retrieval: slimRetrievalForArtifact(retrieval) } : {}),
            ...(flows ? { flowsCount: flows.count ?? (Array.isArray(flows.entries) ? flows.entries.length : 0) } : {}),
            ...(proceduralFlow ? { proceduralEventsCount: Array.isArray(proceduralFlow.events) ? proceduralFlow.events.length : 0 } : {}),
            ...(reconciliation ? { conflictsCount: Array.isArray(reconciliation.conflicts) ? reconciliation.conflicts.length : 0 } : {}),
        };
    }
    return mapped;
}

function buildCourtAnalysisPayload(finalResult) {
    const sanitizedComparativeAnalysis = sanitizeMarkdown(finalResult?.comparativeAnalysis || '');

    return {
        processedCases: Array.isArray(finalResult?.processedCases)
            ? finalResult.processedCases.map(mapProcessedCase)
            : [],
        comparativeAnalysis: sanitizedComparativeAnalysis,
        discoverySummary: finalResult?.discoverySummary || null,
        primaryCluster: finalResult?.primaryCluster || null,
        secondaryClusters: Array.isArray(finalResult?.secondaryClusters)
            ? finalResult.secondaryClusters
            : [],
        clusterEvidencePackage: mapClusterEvidencePackage(finalResult?.clusterEvidencePackage),
        report: mapReportForArtifact(finalResult?.report),
        reportError: finalResult?.reportError || null,
        usage: finalResult?.usage || null
    };
}

module.exports = {
    buildCourtAnalysisPayload,
    mapClusterEvidencePackage,
    mapReportForArtifact,
};
