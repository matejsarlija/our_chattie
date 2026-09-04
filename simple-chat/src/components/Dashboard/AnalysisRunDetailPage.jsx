import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import MermaidDiagram from '../MermaidDiagram';
import ErrorBoundary from '../ErrorBoundary';
import RunStatusBadge from './RunStatusBadge';
import RunProgressStepper from './RunProgressStepper';
import RunEventTimeline from './RunEventTimeline';
import AnalysisActivityLog from './AnalysisActivityLog';
import AnalysisReportAnnex from './AnalysisReportAnnex';
import AnalysisReasoningTelemetry from './AnalysisReasoningTelemetry';
import AnalysisCoverageBanner from './AnalysisCoverageBanner';
import AnalysisFlowsSection from './AnalysisFlowsSection';
import AnalysisUsageSummary from './AnalysisUsageSummary';
import SecondaryClustersSection from './SecondaryClustersSection';
import DashboardShell from './DashboardShell';
import { useAnalysisRunDetail } from '../../hooks/useAnalysisRunDetail';
import { useAnalysisEvents } from '../../hooks/useAnalysisEvents';
import { env } from '../../lib/env';

const parseMaybeJson = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value;
  return null;
};

const deriveEntryDisplayId = (detailLink) => {
  if (!detailLink) return '-';
  try {
    const url = new URL(detailLink);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.at(-1) || '-';
  } catch {
    const parts = String(detailLink).split('/').filter(Boolean);
    return parts.at(-1) || '-';
  }
};

const getProcessedCasesFromParsedResult = (parsedResult, run) => {
  if (Array.isArray(parsedResult?.processedCases)) return parsedResult.processedCases;
  if (Array.isArray(run?.processedCases)) return run.processedCases;
  return [];
};

const getAnalysisCoverage = (parsedResult, run) => {
  const processedCases = getProcessedCasesFromParsedResult(parsedResult, run);
  const selected = processedCases.find((processedCase) => processedCase?.groupMetadata?.selectedForReasoning)
    || processedCases[0];
  return selected?.analysis?.coverage || null;
};

const getSecondaryClusters = (parsedResult, run) => {
  if (Array.isArray(parsedResult?.secondaryClusters) && parsedResult.secondaryClusters.length > 0) {
    return parsedResult.secondaryClusters;
  }
  if (Array.isArray(run?.secondaryClusters) && run.secondaryClusters.length > 0) {
    return run.secondaryClusters;
  }
  if (Array.isArray(parsedResult?.discoverySummary?.clusters)) {
    return parsedResult.discoverySummary.clusters.filter((cluster) => !cluster?.selectedForReasoning);
  }
  return [];
};

const getReportFromParsedResult = (parsedResult) => {
  if (parsedResult?.report && typeof parsedResult.report === 'object') return parsedResult.report;
  return null;
};

const getQueryLabel = (queryType) => {
  if (queryType === 'case_number') return 'Predmet';
  if (queryType === 'oib') return 'OIB';
  if (queryType === 'text') return 'Tekst';
  return 'Upit';
};

const formatDate = (iso) => {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('hr-HR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
};

export default function AnalysisRunDetailPage() {
  const { id } = useParams();
  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const CONNECTION_LABELS = {
    live: 'Live',
    syncing: 'Syncing',
    idle: 'Idle',
  };

  const { run, events, loading, eventsLoading, error, isRunning, connectionMode, lastUpdatedAt, refresh } = useAnalysisRunDetail({
    runId: id,
    streamEnabled: env.analysisDetailSseEnabled,
  });

  const { timeline, stages, activity, isErrored } = useAnalysisEvents(events);
  const timelineToRender = showFullTimeline ? timeline : timeline.slice(-2);

  const parsedResult = useMemo(() => parseMaybeJson(run?.result_json ?? run?.resultJson), [run?.result_json, run?.resultJson]);
  const report = useMemo(() => getReportFromParsedResult(parsedResult), [parsedResult]);
  const findings = useMemo(() => Array.isArray(report?.findings) ? report.findings : [], [report?.findings]);
  const reportTimeline = useMemo(() => Array.isArray(report?.timeline) ? report.timeline : [], [report?.timeline]);
  const conflicts = useMemo(() => Array.isArray(report?.conflicts) ? report.conflicts : [], [report?.conflicts]);
  const openQuestions = useMemo(() => {
    if (Array.isArray(report?.open_questions)) return report.open_questions;
    if (Array.isArray(report?.openQuestions)) return report.openQuestions;
    return [];
  }, [report?.open_questions, report?.openQuestions]);
  const resultMarkdown = useMemo(() => run?.result_text || '', [run?.result_text]);
  const usage = useMemo(() => run?.token_usage || parsedResult?.usage || null, [run?.token_usage, parsedResult?.usage]);
  const coverage = useMemo(() => getAnalysisCoverage(parsedResult, run), [parsedResult, run]);
  const flows = useMemo(() => {
    const pkg = parsedResult?.clusterEvidencePackage || null;
    return {
      moneyFlow: pkg?.moneyFlow || report?.meta?.moneyFlow || null,
      propertyFlow: pkg?.propertyFlow || report?.meta?.propertyFlow || null,
      valueChanges: pkg?.propertyReconciliation?.valueChanges
        || report?.meta?.propertyReconciliation?.valueChanges
        || [],
    };
  }, [parsedResult, report]);
  const secondaryClusters = useMemo(() => getSecondaryClusters(parsedResult, run), [parsedResult, run]);
  const queryLabel = useMemo(() => getQueryLabel(run?.query_type), [run?.query_type]);
  const queryValue = useMemo(() => run?.query_value || run?.oib || id, [run?.query_value, run?.oib, id]);
  const metadataEntries = useMemo(() => {
    const processedCases = getProcessedCasesFromParsedResult(parsedResult, run);
    return processedCases.map((processedCase, index) => {
      const caseResult = processedCase?.caseResult || {};
      return {
        key: `${caseResult.detailLink || caseResult.caseNumber || caseResult.title || 'entry'}-${index}`,
        title: caseResult.title || '-',
        caseNumber: caseResult.caseNumber || '-',
        entryDisplayId: caseResult.entryDisplayId || deriveEntryDisplayId(caseResult.detailLink),
        detailLink: caseResult.detailLink || null,
      };
    });
  }, [parsedResult, run]);

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <div className="mb-1 text-sm text-[var(--text-muted)]">
              <Link to="/dashboard" className="hover:underline">Dashboard</Link> / detalj analize
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Analiza {run?.oib || id}</h1>
          </div>
          {isRunning && (
            <button
              onClick={refresh}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
            >
              Osvježi
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        )}

        {!error && run?.status === 'error' && run?.error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{run.error}</div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">Učitavam detalje…</div>
        ) : !run ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">Analiza nije pronađena.</div>
        ) : (
          <>
            <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <RunStatusBadge status={run.status} />
                  {isRunning && (
                    <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                      {CONNECTION_LABELS[connectionMode] || CONNECTION_LABELS.idle}
                    </span>
                  )}
                  <span className="text-sm text-[var(--text-muted)]">{queryLabel}: {queryValue}</span>
                </div>
                <span className="text-sm text-[var(--text-muted)]">Ažurirano: {formatDate(lastUpdatedAt)}</span>
              </div>
            </section>

            {metadataEntries.length > 0 && (
              <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Povezane objave i metapodaci predmeta</h2>
                <div className="space-y-3">
                  {metadataEntries.map((entry) => (
                    <article key={entry.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Naziv objave</p>
                          <p className="mt-0.5 text-sm font-medium text-[var(--text)]">{entry.title}</p>
                        </div>
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Broj predmeta</p>
                          <p className="mt-0.5 text-sm font-medium text-[var(--text)]">{entry.caseNumber}</p>
                        </div>
                        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                          <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">ID objave</p>
                          <p className="mt-0.5 text-sm font-medium text-[var(--text)]">{entry.entryDisplayId || '-'}</p>
                        </div>
                      </div>
                      {entry.detailLink && (
                        <div className="mt-3 border-t border-[var(--border)] pt-3">
                          <a href={entry.detailLink} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)] hover:underline">
                            Vidi izvornu objavu
                          </a>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="mb-5">
              <RunProgressStepper stages={stages} isErrored={isErrored} />
            </section>

            <AnalysisActivityLog activity={activity} isRunning={isRunning} />

            <AnalysisUsageSummary usage={usage} isRunning={isRunning} />

            <AnalysisCoverageBanner coverage={coverage} />

            <AnalysisFlowsSection
              moneyFlow={flows.moneyFlow}
              propertyFlow={flows.propertyFlow}
              valueChanges={flows.valueChanges}
            />

            <SecondaryClustersSection clusters={secondaryClusters} />

            <section className="mb-5">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--text)]">Događaji</h3>
                  {timeline.length > 2 && (
                    <button
                      onClick={() => setShowFullTimeline((prev) => !prev)}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
                    >
                      {showFullTimeline ? 'Prikaži zadnje događaje' : 'Prikaži sve događaje'}
                    </button>
                  )}
                </div>
                <RunEventTimeline timeline={timelineToRender} isRunning={isRunning} loading={eventsLoading} embedded />
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Rezultat analize</h2>

              {!resultMarkdown ? (
                <p className="text-sm text-[var(--text-muted)]">
                  {isRunning
                    ? 'Analiza je u tijeku, rezultat će biti prikazan po završetku.'
                    : run?.status === 'error'
                      ? 'Rezultat analize nije dostupan jer obrada nije uspješno dovršena. Djelomični podaci, ako ih ima, prikazani su niže.'
                      : 'Rezultat još nije dostupan.'}
                </p>
              ) : (
                <ErrorBoundary>
                  <article className="prose max-w-none prose-slate">
                    <ReactMarkdown
                      components={{
                        code({ inline, className, children, ...props }) {
                          const match = /language-mermaid/.exec(className || '');
                          return !inline && match ? (
                            <MermaidDiagram chart={String(children).replace(/\n$/, '')} />
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {resultMarkdown}
                    </ReactMarkdown>
                  </article>
                </ErrorBoundary>
              )}
            </section>

            <AnalysisReportAnnex
              findings={findings}
              timeline={reportTimeline}
              conflicts={conflicts}
              openQuestions={openQuestions}
              hasStructuredReport={Boolean(report)}
            />

            <AnalysisReasoningTelemetry report={report} />
          </>
        )}
      </main>
    </DashboardShell>
  );
}
