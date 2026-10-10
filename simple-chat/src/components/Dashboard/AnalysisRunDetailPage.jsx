import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import StatusBadge from "../ui/StatusBadge";
import PipelinePhases from "../ui/PipelinePhases";
import Callout from "../ui/Callout";
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
import AnalysisFlowsSection from "./AnalysisFlowsSection";
import AnalysisUsageSummary from "./AnalysisUsageSummary";
import SecondaryClustersSection from "./SecondaryClustersSection";
import DashboardShell from "./DashboardShell";
import { useAnalysisRunDetail } from "../../hooks/useAnalysisRunDetail";
import { useAnalysisEvents } from "../../hooks/useAnalysisEvents";
import { apiFetch } from "../../lib/apiClient";
import { env } from "../../lib/env";
import { formatDateTime } from "../ui/format";

const METADATA_PAGE_SIZE = 10;

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
  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [metadataPage, setMetadataPage] = useState(0);
  const [retryState, setRetryState] = useState({ loading: false, error: "" });

  const {
    run,
    events,
    loading,
    eventsLoading,
    error,
    isRunning,
    connectionMode,
    lastUpdatedAt,
    refresh,
  } = useAnalysisRunDetail({
    runId: id,
    streamEnabled: env.analysisDetailSseEnabled,
  });

  const { timeline, stages, activity, isErrored, headerCounter, counterKnown } =
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
      moneyFlow: pkg?.moneyFlow || report?.meta?.moneyFlow || null,
      propertyFlow: pkg?.propertyFlow || report?.meta?.propertyFlow || null,
      valueChanges:
        pkg?.propertyReconciliation?.valueChanges ||
        report?.meta?.propertyReconciliation?.valueChanges ||
        [],
    };
  }, [parsedResult, report]);
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
  const secondaryClusters = useMemo(
    () => getSecondaryClusters(parsedResult, run),
    [parsedResult, run],
  );
  const hasEvidencePackage = Boolean(parsedResult?.clusterEvidencePackage);
  const canRetryReport =
    !isRunning && !loading && !report && hasEvidencePackage;

  const handleRetryReport = async () => {
    if (!canRetryReport || retryState.loading) return;
    setRetryState({ loading: true, error: "" });
    try {
      await apiFetch(`/api/analysis/runs/${id}/report`, { method: "POST" });
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
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6">
          <div className="text-sm text-ink-muted">
            <Link to="/dashboard" className="hover:underline">
              Dashboard
            </Link>{" "}
            / detalj analize
          </div>
          <div className="mt-1 flex items-end justify-between gap-4 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Analiza {run?.oib || id}
            </h1>
            <div className="flex items-center gap-3">
              <StatusBadge status={run?.status} />
              <span className="text-sm tabular-nums text-ink-muted">
                {formatDateTime(run?.created_at)}
              </span>
              {isRunning && (
                <button
                  type="button"
                  onClick={refresh}
                  className="rounded-md border border-line-control px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
                >
                  Osvježi
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {/* Label and value live in ONE token. As sibling spans with no
                separating space they rendered as "OIB12345678901" — a
                run-together word that copies and screen-reads wrongly. */}
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
          </p>
        </div>

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
          <>
          <nav aria-label="Sadržaj analize" className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
            {[
              ['case-brief', 'Sažetak'],
              ['analysis-coverage', 'Pokrivenost'],
              ['analysis-scope', 'Opseg'],
              ['analysis-flows', 'Tražbine i imovina'],
              ['analysis-risks', 'Rizici'],
              ['case-timeline', 'Kronologija'],
              ['analysis-findings', 'Nalazi izvještaja'],
            ].map(([target, label]) => (
              <a key={target} href={`#${target}`} className="shrink-0 rounded-md px-2.5 py-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink">
                {label}
              </a>
            ))}
          </nav>
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
            {/* ══ LEFT: THE ANSWER ══ */}
            <div className="min-w-0 space-y-4" id="answer-column">
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
                    <button
                      type="button"
                      onClick={handleRetryReport}
                      disabled={retryState.loading}
                      className="rounded-md border border-line-control px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted disabled:opacity-60"
                    >
                      {retryState.loading ? 'Izrađujem izvještaj…' : 'Ponovi izradu izvještaja'}
                    </button>
                    {retryState.error ? <span className="text-xs text-danger" role="alert">{retryState.error}</span> : null}
                  </div>
                ) : null}
              />

              <AnalysisCoverageBanner coverage={coverage} status={run.status} />

              <AnalysisScopeCard scope={scope} />

              <AnalysisFlowsSection
                moneyFlow={flows.moneyFlow}
                propertyFlow={flows.propertyFlow}
                valueChanges={flows.valueChanges}
                sourceDocuments={sourceDocuments}
              />

              <AnalysisRiskList
                conflicts={conflicts}
                openQuestions={openQuestions}
                sourceDocuments={sourceDocuments}
                hasStructuredReport={Boolean(report)}
              />

              <LatestProceduralStep timeline={reportTimeline} />

              <CaseTimeline timeline={reportTimeline} />

              <AnalysisReportAnnex
                findings={findings}
                timeline={reportTimeline}
                hasStructuredReport={Boolean(report)}
              />

              <SecondaryClustersSection clusters={secondaryClusters} />

              {/* Activity stays in the answer column while a run is live: it is the
                only place progress is visible, and burying it in a rail is how
                the old page ended up with a 14-card scroll. Once finished it
                collapses into the rail's event list. */}
              {isRunning ? (
                <AnalysisActivityLog
                  activity={activity}
                  isRunning={isRunning}
                  headerCounter={headerCounter}
                  counterKnown={counterKnown}
                />
              ) : null}

              {metadataEntries.length > 0 && (
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
                  {showMetadata && (
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
                          {entry.detailLink && (
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
                          )}
                        </article>
                      ))}
                      {metadataEntries.length > METADATA_PAGE_SIZE ? (
                        <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-ink-muted">
                          <span>Prikaz {metadataStart + 1}–{metadataStart + visibleMetadataEntries.length} od {metadataEntries.length} objava</span>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setMetadataPage((page) => page - 1)} disabled={metadataPage === 0} className="rounded-md border border-line-control px-2.5 py-1.5 text-ink disabled:opacity-50">Prethodna</button>
                            <button type="button" onClick={() => setMetadataPage((page) => page + 1)} disabled={metadataStart + visibleMetadataEntries.length >= metadataEntries.length} className="rounded-md border border-line-control px-2.5 py-1.5 text-ink disabled:opacity-50">Sljedeća</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* ══ RIGHT: THE TRACE ══
                Telemetry moves out of the scrolling stack and becomes a sticky
                rail, so it is never something you scroll past to reach the
                answer, and never more than a glance away when you need it.

                Rendered ONCE. The grid is `grid-cols-1` below `lg`, so on a
                narrow screen this aside simply becomes the second grid row and
                lands AFTER the answer — which is exactly the intended mobile
                behaviour. An earlier version duplicated the whole rail behind a
                `lg:hidden` disclosure, which put every trace heading and testid
                in the DOM twice. */}
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

                <AnalysisUsageSummary usage={usage} isRunning={isRunning} />

                <RunEventTimeline
                  timeline={timelineToRender}
                  isRunning={isRunning}
                  loading={eventsLoading}
                  embedded
                />
              </div>
            </aside>
          </div>
          </>
        )}
      </main>
    </DashboardShell>
  );
}
