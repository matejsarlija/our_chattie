import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardShell from '../Dashboard/DashboardShell';
import Callout from '../ui/Callout';
import Dialog from '../ui/Dialog';
import StatusBadge from '../ui/StatusBadge';
import { useBenchRunDetail } from '../../hooks/useBenchRunDetail';
import BenchBlindedReviewPanel from './BenchBlindedReviewPanel';

export default function BenchRunDetailPage() {
  const { runId } = useParams();
  const { report, traces, review, loading, error, loadReview, saveVerdicts } = useBenchRunDetail(runId);
  const [traceModalOpen, setTraceModalOpen] = useState(false);

  const rows = report?.rows || [];

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/dashboard/bench" className="text-xs text-[var(--accent)] hover:underline">
              ← Natrag na Bench
            </Link>
            <h1 className="text-xl font-semibold text-[var(--text)] mt-1">Bench izvođenje: {runId}</h1>
          </div>
          <button
            type="button"
            onClick={() => setTraceModalOpen(true)}
            className="rounded-lg border border-[var(--border-control)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
          >
            llm_traces ({traces.length})
          </button>
        </div>

        {error ? <Callout tone="danger" alert title="Greška">{error}</Callout> : null}
        {loading ? <p className="text-sm text-[var(--text-muted)]">Učitavam...</p> : null}

        {report ? (
          <>
            <section className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--text-muted)]">Opseg</div>
                <div className="text-lg font-semibold text-[var(--text)]">{report.scope || 'pilot'}</div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--text-muted)]">Dokumenti / Stranice</div>
                <div className="text-lg font-semibold text-[var(--text)]">
                  {report.docs?.length || 0} / {report.totalPages || 0}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--text-muted)]">Stvarni trošak</div>
                <div className="text-lg font-semibold text-[var(--text)]">${Number(report.actualCost || 0).toFixed(4)}</div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-xs text-[var(--text-muted)]">Ćelija</div>
                <div className="text-lg font-semibold text-[var(--text)]">{rows.length}</div>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="text-base font-semibold text-[var(--text)] mb-3">Rezultati po dokumentu i Stage T izvoru</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                      <th className="py-2 pr-3">Dokument</th>
                      <th className="py-2 pr-3">Model</th>
                      <th className="py-2 pr-3">Stage T izvor</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Trošak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={`${row.docId}-${row.model}-${idx}`} className="border-b border-[var(--border)]/60">
                        <td className="py-2 pr-3 text-xs font-medium text-[var(--text)]">{row.docId}</td>
                        <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">{row.model}</td>
                        <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">
                          {row.transcriptSourceArm || row.arm || 'frozen'}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={row.status === 'SKIPPED' ? 'canceled' : row.errors?.length ? 'error' : 'done'} />
                        </td>
                        <td className="py-2 text-right text-xs text-[var(--text)]">
                          ${Number(row.cost || 0).toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <BenchBlindedReviewPanel
              review={review}
              onLoadReview={loadReview}
              onSubmitVerdicts={saveVerdicts}
            />
          </>
        ) : null}

        <Dialog
          isOpen={traceModalOpen}
          onClose={() => setTraceModalOpen(false)}
          title="Sirovi llm_traces zapisi"
          size="lg"
        >
          <div className="p-6 space-y-2 max-h-96 overflow-y-auto">
            {traces.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Nema zabilježenih LLM tragova za ovo izvođenje.</p>
            ) : (
              traces.map((t) => (
                <div key={t.id} className="rounded border border-[var(--border)] p-2 text-xs">
                  <div className="font-medium text-[var(--text)]">
                    {t.task_type} · {t.actual_model || t.requested_model}
                  </div>
                  <div className="text-[var(--text-muted)]">
                    {t.latency_ms} ms · ${Number(t.cost_usd || 0).toFixed(5)} · {t.finish_reason || '—'}
                  </div>
                </div>
              ))
            )}
          </div>
        </Dialog>
      </main>
    </DashboardShell>
  );
}
