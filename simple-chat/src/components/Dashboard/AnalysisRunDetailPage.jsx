import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import StatusBadge from "../ui/StatusBadge";
import PipelinePhases from "../ui/PipelinePhases";
import Callout from "../ui/Callout";
import Button from "../ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/Tabs";
import RunEventTimeline from "./RunEventTimeline";
import AnalysisActivityLog from "./AnalysisActivityLog";
import AnalysisReportAnnex from './AnalysisReportAnnex';
import AnalysisCaseBrief from './AnalysisCaseBrief';
import AnalysisRiskList from "./AnalysisRiskList";
import LatestProceduralStep from "./LatestProceduralStep";
import CaseTimeline from "./CaseTimeline";
import AnalysisReasoningTelemetry from "./AnalysisReasoningTelemetry";
import AnalysisCoverageBanner from "./AnalysisCoverageBanner";
import AnalysisScopeCard from "./AnalysisScopeCard";
import AnalysisEntitiesExplorer from "./AnalysisEntitiesExplorer";
import AnalysisFlowsSection from "./AnalysisFlowsSection";
import AnalysisUsageSummary from "./AnalysisUsageSummary";
import SecondaryClustersSection from "./SecondaryClustersSection";
import DocketSearchPanel from "./DocketSearchPanel";
import EvidenceDrawer from "./EvidenceDrawer";
import ChangeDetectionControl, { ChangeDetectionNotice } from "./ChangeDetectionControl";
import LiveRunControlBar from "./LiveRunControlBar";
import RunTracesDrawer from "./RunTracesDrawer";
import DashboardShell from "./DashboardShell";
import { useAnalysisRunDetail } from "../../hooks/useAnalysisRunDetail";
import { useAnalysisEvents } from "../../hooks/useAnalysisEvents";
import { useEvidenceDrawer } from "../../hooks/useEvidenceDrawer";
import { useChangeDetection } from "../../hooks/useChangeDetection";
import { retryAnalysisReport } from "../../lib/apiClient";
import { env } from "../../lib/env";
import { formatDateTime } from "../ui/format";

const METADATA_PAGE_SIZE = 10;
const VALID_TABS = new Set(["overview", "parties", "flows", "timeline", "search"]);

const parseMaybeJson = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value;
  return null;
};

const deriveEntryDisplayId = (detailLink) => {
  if (!detailLink) return "-";
  try {
    const url = new URL(detailLink);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) || "-";
  } catch {
    const parts = String(detailLink).split("/").filter(Boolean);
    return parts.at(-1) || "-";
  }
};

const getProcessedCasesFromParsedResult = (parsedResult, run) => {
  if (Array.isArray(parsedResult?.processedCases))
    return parsedResult.processedCases;
  if (Array.isArray(run?.processedCases)) return run.processedCases;
  return [];
};

const getAnalysisCoverage = (parsedResult, run) => {
  const processedCases = getProcessedCasesFromParsedResult(parsedResult, run);
  const selected =
    processedCases.find(
      (processedCase) => processedCase?.groupMetadata?.selectedForReasoning,
    ) || processedCases[0];
  return selected?.analysis?.coverage || null;
};

const getSecondaryClusters = (parsedResult, run) => {
  if (
    Array.isArray(parsedResult?.secondaryClusters) &&
    parsedResult.secondaryClusters.length > 0
  ) {
    return parsedResult.secondaryClusters;
  }
  if (
    Array.isArray(run?.secondaryClusters) &&
    run.secondaryClusters.length > 0
  ) {
    return run.secondaryClusters;
  }
  if (Array.isArray(parsedResult?.discoverySummary?.clusters)) {
    return parsedResult.discoverySummary.clusters.filter(
      (cluster) => !cluster?.selectedForReasoning,
    );
  }
  return [];
};

const getReportFromParsedResult = (parsedResult) => {
  if (parsedResult?.report && typeof parsedResult.report === "object")
    return parsedResult.report;
  return null;
};

const getQueryLabel = (queryType) => {
  if (queryType === "case_number") return "Predmet";
  if (queryType === "oib") return "OIB";
  if (queryType === "text") return "Tekst";
  return "Upit";
};

export default function AnalysisRunDetailPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFullTimeline] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [metadataPage, setMetadataPage] = useState(0);
  const [retryState, setRetryState] = useState({ loading: false, error: "" });
  const [tracesOpen, setTracesOpen] = useState(false);

  const rawTab = searchParams.get("tab");
  const activeTab = VALID_TABS.has(rawTab) ? rawTab : "overview";

  const handleTabChange = (nextTab) => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "overview") {
      next.delete("tab");
    } else {
      next.set("tab", nextTab);
    }
    setSearchParams(next, { replace: true });
  };

  const {
    run,
    events,
    loading,
    eventsLoading,
    error,
    isRunning,
    refresh,
  } = useAnalysisRunDetail({
    runId: id,
    streamEnabled: env.analysisDetailSseEnabled,
  });

  const evidenceDrawer = useEvidenceDrawer(id);

  const { timeline, stages, activity, isErrored, headerCounter, counterKnown, lanes } =
    useAnalysisEvents(events);
  const timelineToRender = showFullTimeline ? timeline : timeline.slice(-2);

  const parsedResult = useMemo(
    () => parseMaybeJson(run?.result_json ?? run?.resultJson),
    [run?.result_json, run?.resultJson],
  );
  const report = useMemo(
    () => getReportFromParsedResult(parsedResult),
    [parsedResult],
  );
  const findings = useMemo(
    () => (Array.isArray(report?.findings) ? report.findings : []),
    [report?.findings],
  );
  const reportTimeline = useMemo(
    () => (Array.isArray(report?.timeline) ? report.timeline : []),
    [report?.timeline],
  );
  const conflicts = useMemo(
    () => (Array.isArray(report?.conflicts) ? report.conflicts : []),
    [report?.conflicts],
  );
  const openQuestions = useMemo(() => {
    if (Array.isArray(report?.open_questions)) return report.open_questions;
    if (Array.isArray(report?.openQuestions)) return report.openQuestions;
    return [];
  }, [report?.open_questions, report?.openQuestions]);
  const resultMarkdown = useMemo(
    () => run?.result_text || "",
    [run?.result_text],
  );
  const reportNarrative = typeof report?.narrative === 'string' ? report.narrative : '';
  const nextSteps = Array.isArray(report?.nextSteps) ? report.nextSteps : [];
  const usage = useMemo(
    () => run?.token_usage || parsedResult?.usage || null,
    [run?.token_usage, parsedResult?.usage],
  );
  const coverage = useMemo(
    () => getAnalysisCoverage(parsedResult, run),
    [parsedResult, run],
  );
  const scope = useMemo(() => report?.meta?.scope || null, [report]);
  const flows = useMemo(() => {
    const pkg = parsedResult?.clusterEvidencePackage || null;
    return {
      flows: pkg?.flows || null,
      reconciliation: pkg?.reconciliation || null,
    };
  }, [parsedResult]);
  const flowEntryCount = Array.isArray(flows?.flows?.entries) ? flows.flows.entries.length : 0;
  const hasFlowData = flowEntryCount > 0 || (Array.isArray(flows?.reconciliation?.valueChanges) && flows.reconciliation.valueChanges.length > 0);
  const sourceDocuments = useMemo(() => {
    const pkg = parsedResult?.clusterEvidencePackage;
    const analyses = Array.isArray(pkg?.analyses) ? pkg.analyses : [];
    const links = Array.isArray(pkg?.documentLinks) ? pkg.documentLinks : [];
    return analyses
      .filter((analysis) => typeof analysis?.id === 'string' && analysis.id)
      .map((analysis) => {
        const link = links.find((candidate) => candidate?.id === analysis.sourceDocumentLinkId);
        const rawName = analysis.fileName || link?.text || 'Izvorni dokument';
        let safeUrl = null;
        try {
          const parsedUrl = new URL(link?.url);
          if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') safeUrl = parsedUrl.href;
        } catch {
          // Missing or malformed source URL: keep the document name without a link.
        }
        return {
          id: analysis.id,
          fileName: String(rawName).split(/[\\/]/).pop(),
          url: safeUrl,
        };
      });
  }, [parsedResult]);
  const legacyAnalyses = useMemo(
    () => (Array.isArray(parsedResult?.clusterEvidencePackage?.analyses) ? parsedResult.clusterEvidencePackage.analyses : []),
    [parsedResult],
  );
  const canonicalParties = useMemo(
    () => (Array.isArray(parsedResult?.canonicalParties) ? parsedResult.canonicalParties : []),
    [parsedResult?.canonicalParties],
  );
  const creditorDigest = useMemo(
    () => parsedResult?.creditorDigest || report?.meta?.creditorDigest || null,
    [parsedResult?.creditorDigest, report?.meta?.creditorDigest],
  );
  const secondaryClusters = useMemo(
    () => getSecondaryClusters(parsedResult, run),
    [parsedResult, run],
  );
  const hasEvidencePackage = Boolean(parsedResult?.clusterEvidencePackage);
  const isDeterministicFallback = !isRunning && report?.generationMode === "deterministic_fallback";
  const canRetryReport =
    !isRunning
    && !loading
    && hasEvidencePackage
    && (!report || report.generationMode === "deterministic_fallback");

  const handleRetryReport = async () => {
    if (!canRetryReport || retryState.loading) return;
    setRetryState({ loading: true, error: "" });
    try {
      await retryAnalysisReport(id);
      await refresh();
      setRetryState({ loading: false, error: "" });
    } catch (err) {
      setRetryState({
        loading: false,
        error: err?.message || "Ponovna izrada izvještaja nije uspjela.",
      });
    }
  };
  const queryLabel = useMemo(
    () => getQueryLabel(run?.query_type),
    [run?.query_type],
  );
  const queryValue = useMemo(
    () => run?.query_value || run?.oib || id,
    [run?.query_value, run?.oib, id],
  );
  const changeDetection = useChangeDetection({
    queryType: run?.query_type,
    queryValue,
    status: run?.status,
    enabled: Boolean(run && !isRunning),
  });
  const metadataEntries = useMemo(() => {
    const processedCases = getProcessedCasesFromParsedResult(parsedResult, run);
    return processedCases.map((processedCase, index) => {
      const caseResult = processedCase?.caseResult || {};
      return {
        key: `${caseResult.detailLink || caseResult.caseNumber || caseResult.title || "entry"}-${index}`,
        title: caseResult.title || "-",
        caseNumber: caseResult.caseNumber || "-",
        entryDisplayId:
          caseResult.entryDisplayId ||
          deriveEntryDisplayId(caseResult.detailLink),
        detailLink: caseResult.detailLink || null,
      };
    });
  }, [parsedResult, run]);
  const metadataStart = metadataPage * METADATA_PAGE_SIZE;
  const visibleMetadataEntries = metadataEntries.slice(metadataStart, metadataStart + METADATA_PAGE_SIZE);

  return (
    <DashboardShell>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
        {/* Persistent Executive Header */}
        <header className="mb-5 border-b border-line pb-4 sm:mb-6 sm:pb-5">
          <div className="text-sm text-ink-muted">
            <Link to="/dashboard" className="hover:underline">
              Dashboard
            </Link>{" "}
            / detalj analize
          </div>
          <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3 sm:items-center sm:gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-semibold tracking-tight text-ink">
                  Analiza {run?.oib || id}
                </h1>
                <StatusBadge status={run?.status} />
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Upit: <span className="font-mono">{queryLabel} {queryValue}</span>
                {metadataEntries[0]?.caseNumber &&
                metadataEntries[0].caseNumber !== "-" ? (
                  <>
                    {" "}
                    · predmet{" "}
                    <span className="font-mono">
                      {metadataEntries[0].caseNumber}
                    </span>
                  </>
                ) : null}
                {run?.created_at ? (
                  <>
                    {" "}
                    · <span className="tabular-nums">{formatDateTime(run.created_at)}</span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <ChangeDetectionControl hookState={changeDetection} inlineNotice={false} />
              {isRunning ? (
                <Button variant="secondary" size="sm" onClick={refresh}>
                  Osvježi
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                Ispis sažetka
              </Button>
            </div>
          </div>
          <LiveRunControlBar run={run} lanes={lanes} isRunning={isRunning} onRefresh={refresh} />
        </header>

        <ChangeDetectionNotice
          latestCheck={changeDetection.latestCheck}
          error={changeDetection.error}
        />

        {error ? (
          <Callout
            tone="danger"
            glyph="!"
            alert
            title="Analizu nije uspjelo učitati"
          >
            {error}
          </Callout>
        ) : null}

        {!error && run?.status === "error" && run?.error ? (
          <Callout
            tone="danger"
            glyph="!"
            alert
            title="Obrada nije uspješno dovršena"
          >
            {run.error}
          </Callout>
        ) : null}

        {loading ? (
          <div className="card p-6 text-sm text-ink-muted" aria-busy="true">
            Učitavam detalje…
          </div>
        ) : !run ? (
          <div className="card p-6 text-sm text-ink-muted">
            Analiza nije pronađena.
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
            {/* ══ LEFT: 5-TAB WORKSPACE ══ */}
            <div className="min-w-0" id="answer-column">
              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <TabsList aria-label="Odjeljci analize" className="print:hidden">
                  <TabsTrigger value="overview">Pregled</TabsTrigger>
                  <TabsTrigger value="parties">
                    Stranke i vjerovnici
                    {canonicalParties.length > 0 ? (
                      <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-xs tabular-nums text-ink-muted">
                        {canonicalParties.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="flows">
                    Tražbine i imovina
                    {flowEntryCount > 0 ? (
                      <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-xs tabular-nums text-ink-muted">
                        {flowEntryCount}
                      </span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="timeline">Kronologija i spisi</TabsTrigger>
                  <TabsTrigger value="search">Pretraga spisa</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  {isDeterministicFallback ? (
                    <Callout
                      tone="warning"
                      title="Prikazan je deterministički sažetak ($0)"
                      action={(
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleRetryReport}
                            disabled={retryState.loading}
                          >
                            {retryState.loading ? 'Izrađujem izvještaj…' : 'Izradi potpuni AI izvještaj'}
                          </Button>
                          {retryState.error ? (
                            <span className="text-xs text-danger" role="alert">{retryState.error}</span>
                          ) : null}
                        </div>
                      )}
                    >
                      <p>
                        {report?.fallbackReason || run?.partial_reason || 'AI sinteza nije provedena; prikazani su deterministički izdvojeni podaci iz spisa.'}
                      </p>
                    </Callout>
                  ) : null}

                  <AnalysisCaseBrief
                    narrative={reportNarrative || (!report ? resultMarkdown : '')}
                    nextSteps={nextSteps}
                    fallback={!reportNarrative && (report || !resultMarkdown)
                      ? (isRunning
                        ? 'Analiza je u tijeku; sažetak će biti prikazan po završetku.'
                        : run?.status === 'error'
                          ? 'Rezultat analize nije dostupan jer obrada nije uspješno dovršena. Djelomični podaci prikazani su niže.'
                          : 'Sažetak izvještaja nije dostupan.')
                      : null}
                    retryAction={canRetryReport ? (
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleRetryReport}
                          disabled={retryState.loading}
                        >
                          {retryState.loading ? 'Izrađujem izvještaj…' : 'Ponovi izradu izvještaja'}
                        </Button>
                        {retryState.error ? <span className="text-xs text-danger" role="alert">{retryState.error}</span> : null}
                      </div>
                    ) : null}
                  />

                  <AnalysisCoverageBanner coverage={coverage} status={run.status} />

                  <AnalysisScopeCard scope={scope} />

                  <AnalysisRiskList
                    conflicts={conflicts}
                    openQuestions={openQuestions}
                    sourceDocuments={sourceDocuments}
                    hasStructuredReport={Boolean(report)}
                    onOpenEvidence={evidenceDrawer.openEvidence}
                  />

                  <AnalysisReportAnnex
                    findings={findings}
                    timeline={reportTimeline}
                    hasStructuredReport={Boolean(report)}
                    onOpenEvidence={evidenceDrawer.openEvidence}
                  />

                  {isRunning ? (
                    <AnalysisActivityLog
                      activity={activity}
                      isRunning={isRunning}
                      headerCounter={headerCounter}
                      counterKnown={counterKnown}
                    />
                  ) : null}
                </TabsContent>

                <TabsContent value="parties" className="space-y-4">
                  <AnalysisEntitiesExplorer
                    runId={id}
                    canonicalParties={canonicalParties}
                    creditorDigest={creditorDigest}
                    legacyAnalyses={legacyAnalyses}
                    sourceDocuments={sourceDocuments}
                    onOpenEvidence={evidenceDrawer.openEvidence}
                  />
                </TabsContent>

                <TabsContent value="flows" className="space-y-4">
                  {hasFlowData ? (
                    <AnalysisFlowsSection
                      flows={flows.flows}
                      reconciliation={flows.reconciliation}
                      sourceDocuments={sourceDocuments}
                      onOpenEvidence={evidenceDrawer.openEvidence}
                    />
                  ) : (
                    <section className="card p-5" data-testid="flows-empty-placeholder">
                      <h2 className="sec-title">Tražbine i imovina</h2>
                      <p className="mt-1 text-sm text-ink-muted">
                        U ovoj analizi nisu zabilježene financijske ni imovinske stavke.
                      </p>
                    </section>
                  )}
                </TabsContent>

                <TabsContent value="timeline" className="space-y-4">
                  <LatestProceduralStep timeline={reportTimeline} />

                  <CaseTimeline
                    timeline={reportTimeline}
                    onOpenEvidence={evidenceDrawer.openEvidence}
                  />

                  <SecondaryClustersSection clusters={secondaryClusters} />

                  {metadataEntries.length > 0 ? (
                    <section className="card p-4">
                      <button
                        type="button"
                        onClick={() => setShowMetadata((prev) => !prev)}
                        aria-expanded={showMetadata}
                        className="flex w-full items-center justify-between gap-3 text-left"
                      >
                        <h2 className="sec-title">
                          Povezane objave i metapodaci predmeta
                        </h2>
                        <span className="pill">
                          {metadataEntries.length} {showMetadata ? "▾" : "▸"}
                        </span>
                      </button>
                      {showMetadata ? (
                        <div className="mt-3 space-y-3">
                          {visibleMetadataEntries.map((entry) => (
                            <article
                              key={entry.key}
                              className="rounded-lg border border-line bg-surface p-4"
                            >
                              <div className="grid gap-2 sm:grid-cols-3">
                                <div className="rounded-md border border-line bg-surface-muted px-3 py-2">
                                  <p className="eyebrow">Naziv objave</p>
                                  <p className="mt-0.5 text-sm font-medium text-ink">
                                    {entry.title}
                                  </p>
                                </div>
                                <div className="rounded-md border border-line bg-surface-muted px-3 py-2">
                                  <p className="eyebrow">Broj predmeta</p>
                                  <p className="mt-0.5 text-sm font-medium text-ink">
                                    {entry.caseNumber}
                                  </p>
                                </div>
                                <div className="rounded-md border border-line bg-surface-muted px-3 py-2">
                                  <p className="eyebrow">ID objave</p>
                                  <p className="mt-0.5 text-sm font-medium text-ink">
                                    {entry.entryDisplayId || "-"}
                                  </p>
                                </div>
                              </div>
                              {entry.detailLink ? (
                                <div className="mt-3 border-t border-line pt-3">
                                  <a
                                    href={entry.detailLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-accent hover:underline"
                                  >
                                    Vidi izvornu objavu
                                  </a>
                                </div>
                              ) : null}
                            </article>
                          ))}
                          {metadataEntries.length > METADATA_PAGE_SIZE ? (
                            <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-ink-muted">
                              <span>Prikaz {metadataStart + 1}–{metadataStart + visibleMetadataEntries.length} od {metadataEntries.length} objava</span>
                              <div className="flex gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setMetadataPage((page) => page - 1)}
                                  disabled={metadataPage === 0}
                                >
                                  Prethodna
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setMetadataPage((page) => page + 1)}
                                  disabled={metadataStart + visibleMetadataEntries.length >= metadataEntries.length}
                                >
                                  Sljedeća
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </TabsContent>

                <TabsContent value="search">
                  <DocketSearchPanel
                    runId={id}
                    onOpenEvidence={evidenceDrawer.openEvidence}
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* ══ RIGHT: THE TRACE ══ */}
            <aside aria-label="Trag obrade" className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
              <div className="space-y-3">
                <h2 className="eyebrow">Trag obrade</h2>

                <PipelinePhases
                  stages={stages}
                  isErrored={isErrored}
                  runStatus={run?.status}
                  coverage={coverage}
                  scope={scope}
                  retrieval={report?.meta?.retrieval}
                />

                <AnalysisReasoningTelemetry report={report} collapsible />

                <AnalysisUsageSummary
                  usage={usage}
                  isRunning={isRunning}
                  onOpenTraces={id ? () => setTracesOpen(true) : null}
                />

                <RunEventTimeline
                  timeline={timelineToRender}
                  isRunning={isRunning}
                  loading={eventsLoading}
                  embedded
                />
              </div>
            </aside>
          </div>
        )}
      </main>

      <EvidenceDrawer
        isOpen={evidenceDrawer.isOpen}
        onClose={evidenceDrawer.closeEvidence}
        activeContext={evidenceDrawer.activeContext}
        chunk={evidenceDrawer.chunk}
        loading={evidenceDrawer.loading}
        error={evidenceDrawer.error}
      />

      <RunTracesDrawer
        runId={id}
        isOpen={tracesOpen}
        onClose={() => setTracesOpen(false)}
      />
    </DashboardShell>
  );
}
