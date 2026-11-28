import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardShell from '../Dashboard/DashboardShell';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Callout from '../ui/Callout';
import Dialog from '../ui/Dialog';
import StatusBadge from '../ui/StatusBadge';
import { useBenchRunDetail } from '../../hooks/useBenchRunDetail';
import BenchBlindedReviewPanel from './BenchBlindedReviewPanel';

const SCORECARD_BUCKETS = [
  { keys: ['oib', 'OIB'], label: 'OIB' },
  { keys: ['hrk', 'HRK'], label: 'HRK' },
  { keys: ['eur', 'EUR'], label: 'EUR' },
  { keys: ['filings', 'Filings'], label: 'Filings' },
  { keys: ['dates', 'Dates'], label: 'Dates' },
  { keys: ['decisionOutcome', 'decision_outcome', 'Decision Outcome'], label: 'Decision Outcome' },
  { keys: ['lineItems', 'line_items', 'Line Items'], label: 'Line Items' },
];

const formatPct = (val) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const normalized = num <= 1 && num >= 0 ? num * 100 : num;
  return `${Math.round(normalized)}%`;
};

function readBucketScore(bucketsObj, keys) {
  if (!bucketsObj || typeof bucketsObj !== 'object') return null;
  for (const key of keys) {
    if (bucketsObj[key] !== undefined && bucketsObj[key] !== null) {
      return bucketsObj[key];
    }
  }
  return null;
}

function formatBucketCell(cell) {
  if (cell === null || cell === undefined) return '—';
  if (typeof cell === 'number') return formatPct(cell) || '—';
  if (typeof cell === 'object') {
    const r = formatPct(cell.recall);
    const p = formatPct(cell.precision);
    if (r && p) return `${r} / ${p}`;
    if (r) return `R ${r}`;
    if (p) return `P ${p}`;
    if (cell.f1 !== undefined) return `F1 ${formatPct(cell.f1)}`;
  }
  return '—';
}

function extractScorecardRows(report) {
  if (!report || typeof report !== 'object') return [];

  if (Array.isArray(report.scorecards) && report.scorecards.length > 0) {
    return report.scorecards.map((sc, idx) => ({
      key: sc.model || sc.arm || `sc-${idx}`,
      label: sc.model || sc.arm || `Model ${idx + 1}`,
      arm: sc.arm || sc.transcriptSourceArm || null,
      costUsd: sc.costUsd ?? sc.cost ?? sc.actualCost ?? null,
      overallRecall: sc.recall ?? sc.overallRecall ?? null,
      overallPrecision: sc.precision ?? sc.overallPrecision ?? null,
      buckets: sc.buckets || sc.scores || sc,
    }));
  }

  const modelSource = report.models && typeof report.models === 'object' && !Array.isArray(report.models)
    ? Object.entries(report.models).map(([modelId, data]) => ({ modelId, ...data }))
    : Array.isArray(report.models)
      ? report.models
      : null;

  if (modelSource && modelSource.length > 0) {
    const hasScores = modelSource.some((m) => m.buckets || m.scores || m.recall !== undefined);
    if (hasScores) {
      return modelSource.map((m, idx) => ({
        key: m.modelId || m.model || `m-${idx}`,
        label: m.modelId || m.model || `Model ${idx + 1}`,
        arm: m.arm || null,
        costUsd: m.costUsd ?? m.cost ?? m.actualCost ?? null,
        overallRecall: m.recall ?? m.overallRecall ?? null,
        overallPrecision: m.precision ?? m.overallPrecision ?? null,
        buckets: m.buckets || m.scores || m,
      }));
    }
  }

  if (report.summary?.buckets || report.buckets) {
    const buckets = report.summary?.buckets || report.buckets;
    return [
      {
        key: 'summary',
        label: 'Ukupno',
        arm: null,
        costUsd: report.actualCost ?? null,
        overallRecall: report.summary?.recall ?? null,
        overallPrecision: report.summary?.precision ?? null,
        buckets,
      },
    ];
  }

  const rows = Array.isArray(report.rows) ? report.rows : [];
  const scoredRows = rows.filter((r) => r?.scores || r?.buckets);
  if (scoredRows.length > 0) {
    const byModel = new Map();
    for (const r of scoredRows) {
      const key = `${r.model || 'model'}::${r.transcriptSourceArm || r.arm || 'frozen'}`;
      if (!byModel.has(key)) {
        byModel.set(key, {
          key,
          label: r.model || 'Model',
          arm: r.transcriptSourceArm || r.arm || 'frozen',
          costUsd: 0,
          buckets: r.buckets || r.scores || {},
          overallRecall: r.scores?.recall ?? r.recall ?? null,
          overallPrecision: r.scores?.precision ?? r.precision ?? null,
        });
      }
      const entry = byModel.get(key);
      entry.costUsd += Number(r.cost || 0);
    }
    return Array.from(byModel.values());
  }

  return [];
}

export default function BenchRunDetailPage() {
  const { runId } = useParams();
  const { report, traces, review, loading, error, loadReview, saveVerdicts } = useBenchRunDetail(runId);
  const [traceModalOpen, setTraceModalOpen] = useState(false);
  const [expandedTraceId, setExpandedTraceId] = useState(null);

  const rows = report?.rows || [];
  const scorecardRows = useMemo(() => extractScorecardRows(report), [report]);

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/dashboard/bench" className="text-xs text-accent hover:underline">
              ← Natrag na Bench
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-ink">Bench izvođenje: {runId}</h1>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setTraceModalOpen(true)}
          >
            llm_traces ({traces.length})
          </Button>
        </div>

        {error ? <Callout tone="danger" alert title="Greška">{error}</Callout> : null}
        {loading ? <p className="text-sm text-ink-muted">Učitavam...</p> : null}

        {report ? (
          <>
            <section className="grid gap-4 sm:grid-cols-4">
              <div className="card p-4">
                <div className="text-xs text-ink-muted">Opseg</div>
                <div className="mt-1 text-lg font-semibold text-ink">{report.scope || 'pilot'}</div>
              </div>
              <div className="card p-4">
                <div className="text-xs text-ink-muted">Dokumenti / Stranice</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {report.docs?.length || 0} / {report.totalPages || 0}
                </div>
              </div>
              <div className="card p-4">
                <div className="text-xs text-ink-muted">Stvarni trošak</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                  ${Number(report.actualCost || 0).toFixed(4)}
                </div>
              </div>
              <div className="card p-4">
                <div className="text-xs text-ink-muted">Ćelija</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{rows.length}</div>
              </div>
            </section>

            <section className="card p-5" aria-labelledby="scorecard-matrix-heading" data-testid="bench-scorecard-matrix">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="scorecard-matrix-heading" className="text-base font-semibold text-ink">
                    Matrica točnosti po kategorijama (Recall / Precision)
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Usporedba pokrivenosti ekstrakcije i troška po modelu.
                  </p>
                </div>
              </div>

              {scorecardRows.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Rezultati ocjenjivanja nisu dostupni (dry-run ili izvođenje bez Gold skupa).
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-line text-ink-muted">
                        <th className="py-2 pr-3 font-medium">Model / Izvor</th>
                        <th className="py-2 pr-3 font-medium">Trošak</th>
                        <th className="py-2 pr-3 font-medium">Ukupno (R / P)</th>
                        {SCORECARD_BUCKETS.map((b) => (
                          <th key={b.label} className="py-2 pr-3 font-medium">{b.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {scorecardRows.map((sc) => {
                        const rStr = formatPct(sc.overallRecall);
                        const pStr = formatPct(sc.overallPrecision);
                        const overall = rStr || pStr ? `${rStr || '—'} / ${pStr || '—'}` : '—';

                        return (
                          <tr key={sc.key}>
                            <td className="py-2 pr-3 font-medium text-ink">
                              <div>{sc.label}</div>
                              {sc.arm ? <div className="text-ink-muted">{sc.arm}</div> : null}
                            </td>
                            <td className="py-2 pr-3 font-mono tabular-nums text-ink">
                              {Number.isFinite(Number(sc.costUsd)) ? `$${Number(sc.costUsd).toFixed(4)}` : '—'}
                            </td>
                            <td className="py-2 pr-3 font-mono tabular-nums text-ink">{overall}</td>
                            {SCORECARD_BUCKETS.map((b) => {
                              const cell = readBucketScore(sc.buckets, b.keys);
                              return (
                                <td key={b.label} className="py-2 pr-3 font-mono tabular-nums text-ink-muted">
                                  {formatBucketCell(cell)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card p-5">
              <h2 className="mb-3 text-base font-semibold text-ink">Rezultati po dokumentu i Stage T izvoru</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-muted">
                      <th className="py-2 pr-3">Dokument</th>
                      <th className="py-2 pr-3">Model</th>
                      <th className="py-2 pr-3">Stage T izvor</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Trošak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={`${row.docId}-${row.model}-${idx}`} className="border-b border-line">
                        <td className="py-2 pr-3 text-xs font-medium text-ink">{row.docId}</td>
                        <td className="py-2 pr-3 text-xs text-ink-muted">{row.model}</td>
                        <td className="py-2 pr-3 text-xs text-ink-muted">
                          {row.transcriptSourceArm || row.arm || 'frozen'}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={row.status === 'SKIPPED' ? 'canceled' : row.errors?.length ? 'error' : 'done'} />
                        </td>
                        <td className="py-2 text-right font-mono text-xs tabular-nums text-ink">
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
          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {traces.length === 0 ? (
              <p className="text-sm text-ink-muted">Nema zabilježenih LLM tragova za ovo izvođenje.</p>
            ) : (
              traces.map((t) => {
                const isExpanded = expandedTraceId === t.id;
                const validationErrors = t.validationErrors ?? t.validation_errors_json ?? t.validation_errors ?? null;
                const rawResponse = t.rawResponse ?? t.raw_response ?? null;
                const cachedTokens = t.cachedTokens ?? t.cached_tokens;
                const reasoningTokens = t.reasoningTokens ?? t.reasoning_tokens;
                const provider = t.actual_provider || t.actualProvider || t.provider || '—';

                return (
                  <div key={t.id} className="rounded-md border border-line bg-surface p-2.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setExpandedTraceId((prev) => (prev === t.id ? null : t.id))}
                      aria-expanded={isExpanded}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <div>
                        <div className="font-medium text-ink">
                          {t.task_type || t.taskType} · {t.actual_model || t.actualModel || t.requested_model || t.requestedModel}
                        </div>
                        <div className="font-mono tabular-nums text-ink-muted">
                          {t.latency_ms ?? t.latencyMs ?? '—'} ms · ${Number(t.cost_usd ?? t.costUsd ?? 0).toFixed(5)} · {t.finish_reason || t.finishReason || '—'}
                        </div>
                      </div>
                      <Badge tone="neutral" className="px-2 py-0.5 text-xs">
                        {isExpanded ? 'Sakrij ▾' : 'Detalji ▸'}
                      </Badge>
                    </button>

                    {isExpanded ? (
                      <div className="mt-2.5 space-y-2 border-t border-line pt-2.5" data-testid="bench-trace-detail">
                        <div className="grid grid-cols-2 gap-2 font-mono text-xs text-ink-muted">
                          <div>Provider: <span className="text-ink">{provider}</span></div>
                          <div>TTFT: <span className="tabular-nums text-ink">{t.ttft_ms ?? t.ttftMs ?? '—'} ms</span></div>
                          <div>Cached tokeni: <span className="tabular-nums text-ink">{cachedTokens ?? '—'}</span></div>
                          <div>Reasoning tokeni: <span className="tabular-nums text-ink">{reasoningTokens ?? '—'}</span></div>
                        </div>

                        {validationErrors && (Array.isArray(validationErrors) ? validationErrors.length > 0 : String(validationErrors) !== '[]') ? (
                          <div>
                            <p className="eyebrow">Validacijske greške</p>
                            <pre className="mt-1 max-h-28 overflow-auto rounded border border-line bg-warning-surface p-2 font-mono text-xs text-ink">
                              {typeof validationErrors === 'string' ? validationErrors : JSON.stringify(validationErrors, null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        <div>
                          <p className="eyebrow">raw_response</p>
                          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-surface-muted p-2 font-mono text-xs text-ink">
                            {rawResponse || 'Nema spremljenog odgovora.'}
                          </pre>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </Dialog>
      </main>
    </DashboardShell>
  );
}
