import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import MermaidDiagram from '../MermaidDiagram';
import ErrorBoundary from '../ErrorBoundary';
import RunStatusBadge from './RunStatusBadge';
import RunProgressStepper from './RunProgressStepper';
import RunEventTimeline from './RunEventTimeline';
import DashboardShell from './DashboardShell';
import { useAuth } from '../../contexts/AuthContext';
import { useAnalysisRunDetail } from '../../hooks/useAnalysisRunDetail';
import { useAnalysisEvents } from '../../hooks/useAnalysisEvents';
import { env } from '../../lib/env';

const formatDate = (iso) => {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('hr-HR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
};

export default function AnalysisRunDetailPage() {
  const { id } = useParams();
  const { user, accessToken, loading: authLoading, openAuthModal } = useAuth();
  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const CONNECTION_LABELS = {
    live: 'Live',
    syncing: 'Syncing',
    idle: 'Idle',
  };

  const { run, events, loading, eventsLoading, error, isRunning, connectionMode, lastUpdatedAt, refresh } = useAnalysisRunDetail({
    runId: id,
    token: accessToken,
    enabled: Boolean(user),
    streamEnabled: env.analysisDetailSseEnabled,
  });

  const { timeline, stages, isErrored } = useAnalysisEvents(events);
  const timelineToRender = showFullTimeline ? timeline : timeline.slice(-2);

  const resultMarkdown = useMemo(() => run?.result_text || '', [run?.result_text]);

  if (authLoading) {
    return (
      <DashboardShell>
        <main className="mx-auto max-w-6xl px-4 py-8 text-sm text-[var(--text-muted)]">Provjeravam prijavu…</main>
      </DashboardShell>
    );
  }

  if (!user) {
    return (
      <DashboardShell>
        <main className="mx-auto max-w-3xl px-4 py-12">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <p className="text-[var(--text)]">Za prikaz detalja analize potrebna je prijava.</p>
            <button
              onClick={openAuthModal}
              className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"
            >
              Prijava
            </button>
          </div>
        </main>
      </DashboardShell>
    );
  }

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
                  <span className="text-sm text-[var(--text-muted)]">OIB: {run.oib || id}</span>
                </div>
                <span className="text-sm text-[var(--text-muted)]">Ažurirano: {formatDate(lastUpdatedAt)}</span>
              </div>
            </section>

            <section className="mb-5">
              <RunProgressStepper stages={stages} isErrored={isErrored} />
            </section>

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
                  {isRunning ? 'Analiza je u tijeku, rezultat će biti prikazan po završetku.' : 'Rezultat još nije dostupan.'}
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
          </>
        )}
      </main>
    </DashboardShell>
  );
}
