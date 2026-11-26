'use strict';

const { createDiscoveryClient } = require('../scraper/discoveryClient');
const { acquireClusterFiles, cleanupFiles } = require('./acquisition/clusterAcquisition');
const { analyzeClusterDocuments } = require('./extraction/documentAnalyzer');
const { enrichParticipants } = require('../court-registry/enricher');
const { resolveScanDepthEntries } = require('./utils/scanDepth');
const { buildStageCounterEvent } = require('../http/analysisStage');
const {
    computeRawScrapeLimit,
    resolveScanDepth,
    evaluateDiscoveryHeuristics,
    normalizeScraperResult,
    buildDiscoveryResult,
} = require('./discoveryStage');
const { buildClusterEvidencePackage, attachAnalysesToEvidencePackage } = require('./reasoning/ledger/evidencePackage');
const { generateClusterReport, composeOverviewMarkdown } = require('./reasoning/synthesis/reportService');
const { normalizeText } = require('./reasoning/retrieval/indexer');
const { createUsageTracker } = require('../llm/usage');
const { createCreditExhaustedLatch } = require('../llm/creditLatch');
const logger = require('../services/logger');

class PartialAnalysisError extends Error {
    constructor(message, partialResult = null, options = {}) {
        super(message);
        this.name = 'PartialAnalysisError';
        this.partialResult = partialResult || null;
        this.stage = options.stage || null;
    }
}

function buildEmptyPartialResult() {
    return {
        processedCases: [],
        comparativeAnalysis: null,
        discoverySummary: null,
        primaryCluster: null,
        secondaryClusters: [],
        clusterEvidencePackage: null,
        report: null,
        reportError: null,
        partialReason: null,
        usage: null,
    };
}

function sumDocumentCoverage(processedCases) {
    return (processedCases || []).reduce(
        (totals, processedCase) => ({
            analyzed: totals.analyzed + (processedCase?.analysis?.coverage?.analyzed ?? 0),
            failed: totals.failed + (processedCase?.analysis?.coverage?.failed ?? 0),
        }),
        { analyzed: 0, failed: 0 },
    );
}

function composeFallbackOverviewMarkdown(allProcessedCases) {
    const lines = [];
    for (const processedCase of allProcessedCases || []) {
        const individualAnalyses = Array.isArray(processedCase?.analysis?.individualAnalyses)
            ? processedCase.analysis.individualAnalyses
            : [];
        for (const item of individualAnalyses) {
            const summary = String(item?.aiResult?.summary || '').trim();
            if (summary) lines.push(`- ${summary}`);
        }
    }
    if (lines.length === 0) return '';
    return (
        `## Sa\u017eeci pojedina\u010dnih dokumenata\n${lines.join('\n')}\n\n` +
        '_Napomena: cjeloviti stru\u010dni izvje\u0161taj trenutno nije dostupan, ali su pojedina\u010dne analize dokumenata prikazane iznad._'
    );
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    throw signal.reason || Object.assign(new Error('Analysis aborted.'), { name: 'AbortError' });
}

function resolveAnalysisArgs(optionsOrProgressCallback, maybeProgressCallback) {
    const options = optionsOrProgressCallback && typeof optionsOrProgressCallback === 'object'
        ? optionsOrProgressCallback
        : {};
    const depth = resolveScanDepth(options.scanDepth);
    return {
        scrapeLimit: computeRawScrapeLimit(depth.poolCap),
        query: options.query || null,
        discoverySource: options.discoverySource || null,
        analysisStore: options.analysisStore || null,
        runId: options.runId || null,
        signal: options.signal || null,
        ...depth,
        progressCallback: typeof optionsOrProgressCallback === 'function'
            ? optionsOrProgressCallback
            : maybeProgressCallback,
    };
}

function buildGroupMetadata({ cluster, clusterSummary, clusterId, primaryClusterId }) {
    return {
        clusterId,
        primaryCaseNumber: clusterSummary?.primaryCaseNumber || cluster.caseNumber || 'N/A',
        entryCount: cluster.entries.length,
        isAnonymous: cluster.isAnonymous,
        selectionScore: clusterSummary?.score ?? 0,
        selectionDiagnostics: clusterSummary?.selectionDiagnostics || null,
        identityConsistency: clusterSummary?.identityConsistency || 'unresolved',
        identityNotes: clusterSummary?.identityNotes || [],
        participantNames: clusterSummary?.participantNames || [],
        participantOibs: clusterSummary?.participantOibs || [],
        acquisitionModes: clusterSummary?.acquisitionModes || [],
        acquisitionProvenance: clusterSummary?.acquisitionProvenance || [],
        entryCountsByAcquisitionMode: clusterSummary?.entryCountsByAcquisitionMode || {},
        documentCountsByAcquisitionMode: clusterSummary?.documentCountsByAcquisitionMode || {},
        selectedForReasoning: clusterId === primaryClusterId,
    };
}

function persistReasoningArtifacts({ runId, analysisStore, enrichedEvidencePackage }) {
    if (!runId || !analysisStore) return;
    if (analysisStore.insertRunChunks) {
        analysisStore.insertRunChunks({
            runId,
            chunks: (enrichedEvidencePackage.chunks || []).map((chunk) => ({
                chunkId: chunk.id,
                docId: chunk.metadata?.docId || chunk.id,
                fileName: chunk.metadata?.fileName || null,
                caseNumber: chunk.metadata?.caseNumber || null,
                sourceEntryIndex: chunk.metadata?.sourceEntryIndex ?? null,
                sourceLinkId: chunk.metadata?.sourceDocumentLinkId || null,
                pageNumbers: chunk.metadata?.pageNumbers || [],
                startIndex: chunk.metadata?.startIndex ?? null,
                endIndex: chunk.metadata?.endIndex ?? null,
                text: chunk.text,
                normalizedText: normalizeText(chunk.text),
            })),
        });
    }
    if (analysisStore.insertRunFacts) {
        analysisStore.insertRunFacts({
            runId,
            facts: (enrichedEvidencePackage.factLedger || []).map((fact, index) => ({
                id: fact.id || `${runId}:fact:${index + 1}`,
                kind: fact.kind,
                description: fact.description,
                value: fact.value,
                valueEur: fact.valueEur,
                valueHrk: fact.valueHrk ?? fact.amountHrk ?? null,
                currency: fact.currency,
                date: fact.date,
                direction: fact.direction,
                amountRole: fact.amountRole,
                eventType: fact.eventType,
                valueRole: fact.valueRole ?? null,
                legalEffect: fact.legalEffect,
                isplatniRed: fact.isplatniRed,
                supersedes: fact.supersedes ?? null,
                claimRegistryNumber: fact.claimRegistryNumber,
                filingReference: fact.filingReference,
                canonicalPartyId: fact.canonicalPartyId,
                payerOib: fact.parties?.payerOib,
                recipientOib: fact.parties?.recipientOib,
                grounded: fact.grounded,
                docHash: fact.doc?.contentHash,
                sourceEntryIndex: fact.doc?.sourceEntryIndex,
                sourceChunkId: fact.sourceChunkId,
                sourceStartIndex: fact.sourceStartIndex ?? null,
                sourceEndIndex: fact.sourceEndIndex ?? null,
                sourcePages: fact.sourcePages,
                rawJson: fact,
            })),
        });
    }
}

async function runCourtAnalysis(searchTerm, optionsOrProgressCallback, progressCallback) {
    const resolved = resolveAnalysisArgs(optionsOrProgressCallback, progressCallback);
    const callback = resolved.progressCallback;
    const automator = createDiscoveryClient({ discoverySource: resolved.discoverySource });

    try {
        logger.info('pipeline.runCourtAnalysis', 'Starting court analysis', {
            runId: resolved.runId || null,
            queryType: resolved.query?.type || null,
            scanDepth: resolved.scanDepth,
            scrapeLimit: resolved.scrapeLimit,
        });
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        throwIfAborted(resolved.signal);
        await automator.init();
        const scrapeResult = await automator.searchAndGetLatestCasesWithDocuments(
            searchTerm,
            resolved.scrapeLimit,
            resolved.maxPagesScanned,
            resolved.tailSample,
            resolved.query?.type === 'oib' ? resolved.query.value : null,
            resolved.query || null,
            resolved.scanDepth,
        );
        throwIfAborted(resolved.signal);
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);

        callback?.({
            step: 'discovering',
            progress: 12,
            message: `Pronađeno ${casesToProcess.length} objava na ${discoveryMetadata?.pagesScanned ?? '?'} stranica${discoveryMetadata?.hasNextPage ? ' (postoji više stranica)' : ''}.`,
        });
        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        logger.info('pipeline.runCourtAnalysis', 'Scrape completed', {
            runId: resolved.runId || null,
            cases: casesToProcess.length,
            discoveryMode: discoveryMetadata?.discoveryMode || null,
            scanDepth: resolved.scanDepth,
        });
        return await processScrapedCases(casesToProcess, callback, {
            query: resolved.query || { value: searchTerm },
            discoveryMetadata,
            scanDepth: resolved.scanDepth,
            analysisStore: resolved.analysisStore,
            signal: resolved.signal,
            runId: resolved.runId,
        });
    } catch (error) {
        logger.error('pipeline.runCourtAnalysis', 'Court analysis failed', { runId: resolved.runId || null, error: error.message });
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        await automator.close();
    }
}

async function runCourtDiscovery(searchTerm, optionsOrProgressCallback, progressCallback) {
    const resolved = resolveAnalysisArgs(optionsOrProgressCallback, progressCallback);
    const callback = resolved.progressCallback;
    const automator = createDiscoveryClient({ discoverySource: resolved.discoverySource });

    try {
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const scrapeResult = await automator.searchAndGetLatestCases(
            searchTerm,
            null,
            resolved.maxPagesScanned,
            resolved.tailSample,
            resolved.query?.type === 'oib' ? resolved.query.value : null,
        );
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);
        return buildDiscoveryResult(casesToProcess, {
            query: resolved.query || { value: searchTerm },
            discoveryMetadata,
        }, callback);
    } catch (error) {
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        await automator.close();
    }
}

async function processScrapedCases(casesToProcess, progressCallback, options = {}) {
    const resolvedOptions = { ...options, scanDepth: resolveScanDepthEntries(options.scanDepth).scanDepth };
    const runId = resolvedOptions.runId || null;
    const runStartedAt = Date.now();
    const allFilesToCleanup = [];
    const usageTracker = createUsageTracker();
    const creditLatch = createCreditExhaustedLatch({ runId, sqliteStore: resolvedOptions.analysisStore });
    let lastStage = null;

    const stageAwareProgress = (event) => {
        if (event?.step) lastStage = event.step;
        progressCallback?.(event);
    };
    const emitUsage = (snapshot) => {
        stageAwareProgress({ step: lastStage || 'reasoning', usage: snapshot });
    };

    let state = {
        allProcessedCases: [],
        partialResult: buildEmptyPartialResult(),
    };

    try {
        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        // Stage 1: Discovery & Primary Cluster Selection
        const {
            clusters,
            discoverySummary,
            primaryClusterId,
            primaryCluster,
            secondaryClusters,
        } = buildDiscoveryResult(casesToProcess, resolvedOptions, stageAwareProgress);
        stageAwareProgress(buildStageCounterEvent({
            stage: 'discovering',
            done: 0,
            total: discoverySummary.rawEntryCount ?? null,
            unit: 'objava',
        }));

        const selectedReasoningCluster = primaryClusterId
            ? clusters.find((cluster) => (cluster.clusterId || cluster.caseNumber) === primaryClusterId) || null
            : clusters[0] || null;
        const selectedClusterSummary = selectedReasoningCluster
            ? discoverySummary.clusters.find((s) => s.clusterId === (selectedReasoningCluster.clusterId || selectedReasoningCluster.caseNumber))
            : null;
        const clusterEvidencePackage = buildClusterEvidencePackage({
            cluster: selectedReasoningCluster,
            clusterSummary: selectedClusterSummary,
            discoverySummary,
            query: resolvedOptions.query || null,
        });
        state.partialResult = {
            ...state.partialResult,
            discoverySummary,
            primaryCluster,
            secondaryClusters,
            clusterEvidencePackage,
        };
        logger.info('pipeline.processScrapedCases', 'Discovery grouped', {
            runId,
            clusters: clusters.length,
            reasoningClusters: selectedReasoningCluster ? 1 : 0,
            primaryClusterId: primaryClusterId || null,
            secondaryClusters: secondaryClusters.length,
            queryType: resolvedOptions.query?.type || null,
        });

        // Stage 2: Enrichment, Acquisition & Document Extraction (Stage T0 / T0.5 / T / A)
        if (selectedReasoningCluster) {
            throwIfAborted(resolvedOptions.signal);
            const cluster = selectedReasoningCluster;
            const clusterId = cluster.clusterId || cluster.caseNumber || 'anonymous-1';
            const clusterSummary = discoverySummary.clusters.find((s) => s.clusterId === clusterId);
            const { caseInfo } = cluster.entries[0];

            stageAwareProgress?.({ step: 'downloading', progress: 25, message: `Obrađujem predmet ${caseInfo.caseNumber} (${cluster.entries.length} objava)` });
            if (Array.isArray(caseInfo.participants) && caseInfo.participants.length > 0) {
                stageAwareProgress?.({ step: 'discovering', message: 'Dohvaćam podatke iz Sudskog registra za sudionike...' });
                try {
                    caseInfo.participants = await enrichParticipants(caseInfo.participants, { store: resolvedOptions.analysisStore });
                } catch (err) {
                    logger.agent.error('Enrichment failed gracefully:', err.message);
                }
            }

            const acquired = await acquireClusterFiles({
                cluster,
                caseInfo,
                progressCallback: stageAwareProgress,
                signal: resolvedOptions.signal,
            });
            allFilesToCleanup.push(...acquired.cleanupPaths);
            const groupMetadata = buildGroupMetadata({ cluster, clusterSummary, clusterId, primaryClusterId });

            if (acquired.filesForAnalysis.length === 0) {
                logger.agent.warn(`No files to analyze for case ${caseInfo.title}. Skipping analysis.`);
                state.allProcessedCases.push({
                    caseResult: caseInfo,
                    analysis: { individualAnalyses: [], sourceDocuments: [], finalSummary: 'Nema dokumenata za analizu.' },
                    groupMetadata,
                });
            } else {
                stageAwareProgress?.({ step: 'reasoning', message: `Analiziram ${acquired.filesForAnalysis.length} datoteka za predmet ${caseInfo.caseNumber}...` });
                const analysis = await analyzeClusterDocuments({
                    files: acquired.filesForAnalysis,
                    caseInfo,
                    progressCallback: stageAwareProgress,
                    usageTracker,
                    onUsage: emitUsage,
                    runId,
                    sqliteStore: resolvedOptions.analysisStore,
                    creditLatch,
                    signal: resolvedOptions.signal,
                });
                throwIfAborted(resolvedOptions.signal);
                const cov = analysis?.coverage || {};
                stageAwareProgress?.({
                    step: 'reasoning',
                    message: `AI analiza predmeta ${caseInfo.caseNumber} dovršena: ${cov.analyzed ?? 0} uspješno, ${cov.failed ?? 0} neuspjelo od ${cov.total ?? acquired.filesForAnalysis.length} datoteka.`,
                });
                logger.info('pipeline.processScrapedCases', 'Case analyzed', {
                    runId,
                    filesAnalyzed: acquired.filesForAnalysis.length,
                    individualAnalyses: Array.isArray(analysis?.individualAnalyses) ? analysis.individualAnalyses.length : 0,
                });
                state.allProcessedCases.push({
                    caseResult: caseInfo,
                    files: acquired.downloadedFiles,
                    analysis,
                    groupMetadata,
                });
                if (analysis?.partialReason) {
                    state.partialResult.partialReason = analysis.partialReason;
                }
            }
        }

        // Stage 3: Reasoning Persistence & Evidence Package Assembly
        state.partialResult.processedCases = state.allProcessedCases;
        const enrichedEvidencePackage = attachAnalysesToEvidencePackage(
            clusterEvidencePackage,
            state.allProcessedCases,
            primaryClusterId || null,
        );
        state.partialResult.clusterEvidencePackage = enrichedEvidencePackage;
        persistReasoningArtifacts({ runId, analysisStore: resolvedOptions.analysisStore, enrichedEvidencePackage });

        // Stage 4: Synthesis & Report Generation
        stageAwareProgress?.({ step: 'reasoning', progress: 85, message: 'Generiram stručni izvještaj i zaključak...' });
        let report = null;
        let reportError = null;
        try {
            report = await generateClusterReport(enrichedEvidencePackage, {
                onStage: (event) => stageAwareProgress?.(event),
                tracker: usageTracker,
                onUsage: emitUsage,
                runId,
                analysisStore: resolvedOptions.analysisStore,
                creditLatch,
            });
        } catch (err) {
            reportError = err.message;
            logger.agent.error('Report generation failed; returning partial per-document results without a synthesized report:', err.message);
            logger.error('pipeline.processScrapedCases', 'Report generation failed', { runId, error: reportError });
        }
        state.partialResult.report = report;
        state.partialResult.reportError = reportError;

        const comparativeAnalysis = report
            ? composeOverviewMarkdown(report)
            : composeFallbackOverviewMarkdown(state.allProcessedCases);
        state.partialResult.comparativeAnalysis = comparativeAnalysis;
        logger.info('pipeline.processScrapedCases', 'Reasoning report generated', {
            runId,
            processedCases: state.allProcessedCases.length,
            reportFindings: Array.isArray(report?.findings) ? report.findings.length : 0,
            verificationStatus: report?.verification?.status || null,
            reportError,
        });

        stageAwareProgress?.({ step: 'complete', progress: 100, message: 'Analiza je završena!' });
        logger.info('pipeline.processScrapedCases', 'Analysis complete', {
            runId,
            processedCases: state.allProcessedCases.length,
            hasReport: Boolean(report),
            reportError,
        });

        const summaryCoverage = sumDocumentCoverage(state.allProcessedCases);
        logger.info('pipeline.processScrapedCases', 'Run summary', {
            runId,
            status: 'complete',
            query: { type: resolvedOptions.query?.type || null, value: resolvedOptions.query?.value || null },
            discoveryMode: discoverySummary?.discoveryMode || null,
            scanDepth: resolvedOptions.scanDepth || null,
            processedCases: state.allProcessedCases.length,
            documentsAnalyzed: summaryCoverage.analyzed,
            documentsFailed: summaryCoverage.failed,
            groundedClaims: enrichedEvidencePackage?.coverage?.groundedClaims ?? null,
            totalClaims: enrichedEvidencePackage?.coverage?.totalClaims ?? null,
            propertyFlowEntries: enrichedEvidencePackage?.flows?.entries?.filter((e) => e.kind === 'property').length ?? 0,
            propertyConflicts: enrichedEvidencePackage?.reconciliation?.conflicts?.filter((c) => c.kind === 'property' || c.kind === 'lifecycle').length ?? 0,
            usage: usageTracker.snapshot(),
            durationMs: Date.now() - runStartedAt,
            reportError,
        });

        const partialReason = state.partialResult.partialReason
            || (creditLatch.isTripped() ? 'provider_credits_exhausted' : null);

        return {
            processedCases: state.allProcessedCases,
            comparativeAnalysis,
            discoverySummary,
            primaryCluster,
            secondaryClusters,
            clusterEvidencePackage: enrichedEvidencePackage,
            report,
            reportError,
            partialReason,
            usage: usageTracker.snapshot(),
        };
    } catch (error) {
        state.partialResult.usage = usageTracker.snapshot();
        const failureCoverage = sumDocumentCoverage(state.allProcessedCases);
        logger.error('pipeline.processScrapedCases', 'Run summary', {
            runId,
            status: 'failed',
            query: { type: resolvedOptions.query?.type || null, value: resolvedOptions.query?.value || null },
            discoveryMode: state.partialResult.discoverySummary?.discoveryMode || null,
            scanDepth: resolvedOptions.scanDepth || null,
            processedCases: state.allProcessedCases.length,
            documentsAnalyzed: failureCoverage.analyzed,
            documentsFailed: failureCoverage.failed,
            groundedClaims: state.partialResult.clusterEvidencePackage?.coverage?.groundedClaims ?? null,
            totalClaims: state.partialResult.clusterEvidencePackage?.coverage?.totalClaims ?? null,
            propertyFlowEntries: state.partialResult.clusterEvidencePackage?.flows?.entries?.filter((e) => e.kind === 'property').length ?? 0,
            propertyConflicts: state.partialResult.clusterEvidencePackage?.reconciliation?.conflicts?.filter((c) => c.kind === 'property' || c.kind === 'lifecycle').length ?? 0,
            usage: usageTracker.snapshot(),
            durationMs: Date.now() - runStartedAt,
            error: error.message,
        });
        throw new PartialAnalysisError(error.message, state.partialResult, { stage: lastStage });
    } finally {
        await cleanupFiles(allFilesToCleanup);
    }
}

module.exports = {
    runCourtAnalysis,
    runCourtDiscovery,
    resolveScanDepth,
    computeRawScrapeLimit,
    processScrapedCases,
    buildDiscoveryResult,
    PartialAnalysisError,
    buildEmptyPartialResult,
    evaluateDiscoveryHeuristics,
};
