import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet';
import Badge from '../ui/Badge';
import Callout from '../ui/Callout';
import { getRunTrace, listRunTraces } from '../../lib/apiClient';
import { formatDateTime } from '../ui/format';

export default function RunTracesDrawer({ runId, isOpen, onClose }) {
  const [traces, setTraces] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    if (!isOpen || !runId) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSelectedId(null);
    setDetail(null);

    listRunTraces(runId, { limit: 50, offset: 0 }, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setTraces(Array.isArray(data?.traces) ? data.traces : []);
        setTotal(Number.isFinite(Number(data?.total)) ? Number(data.total) : 0);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        setError(err?.message || 'Učitavanje forenzičkih tragova nije uspjelo.');
        setLoading(false);
      });

    return () => controller.abort();
  }, [isOpen, runId]);

  const handleSelectTrace = async (traceId) => {
    if (!runId || !traceId) return;
    setSelectedId(traceId);
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    try {
      const data = await getRunTrace(runId, traceId);
      setDetail(data || null);
    } catch (err) {
      setDetailError(err?.message || 'Učitavanje detalja traga nije uspjelo.');
    } finally {
      setDetailLoading(false);
    }
  };

  const validationErrors = detail?.validationErrors ?? detail?.validation_errors ?? [];
  const rawResponse = detail?.rawResponse ?? detail?.raw_response ?? '';
  const actualModel = detail?.actualModel ?? detail?.actual_model ?? detail?.requestedModel ?? detail?.requested_model;
  const actualProvider = detail?.actualProvider ?? detail?.actual_provider;
  const finishReason = detail?.finishReason ?? detail?.finish_reason;
  const ttftMs = detail?.ttftMs ?? detail?.ttft_ms;
  const latencyMs = detail?.latencyMs ?? detail?.latency_ms;
  const costUsd = detail?.costUsd ?? detail?.cost_usd;

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Forenzički tragovi (llm_traces)"
      description={total > 0 ? `Zabilježeno ${total} LLM poziva za ovu analizu.` : 'Inspekcija sirovih odgovora modela i validacije.'}
      size="lg"
    >
      <div className="space-y-4" data-testid="run-traces-drawer">
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-line p-3">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton mt-2 h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <Callout tone="danger" glyph="!" alert title="Tragovi nisu dostupni">
            {error}
          </Callout>
        ) : traces.length === 0 ? (
          <p className="text-sm text-ink-muted">Nema spremljenih LLM tragova za ovu analizu.</p>
        ) : (
          <div className="space-y-2">
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1" data-testid="traces-list">
              {traces.map((trace) => {
                const isSelected = selectedId === trace.id;
                const model = trace.actualModel || trace.actual_model || trace.requestedModel || trace.requested_model || '—';
                const cost = Number.isFinite(Number(trace.costUsd ?? trace.cost_usd))
                  ? `$${Number(trace.costUsd ?? trace.cost_usd).toFixed(4)}`
                  : '—';
                const errCount = Array.isArray(trace.validationErrors) ? trace.validationErrors.length : 0;

                return (
                  <li key={trace.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectTrace(trace.id)}
                      aria-pressed={isSelected}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? 'border-accent bg-info-surface'
                          : 'border-line bg-surface hover:bg-surface-muted'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs font-medium text-ink">
                          {trace.taskType || trace.task_type || 'llm'} · {model}
                        </span>
                        <div className="flex items-center gap-2 text-xs tabular-nums text-ink-muted">
                          {errCount > 0 ? (
                            <Badge tone="warning" className="px-2 py-0.5 text-xs">
                              {errCount} greš.
                            </Badge>
                          ) : null}
                          <span>{cost}</span>
                        </div>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {trace.actualProvider || trace.actual_provider || 'OpenRouter'}
                        {trace.finishReason || trace.finish_reason ? ` · ${trace.finishReason || trace.finish_reason}` : ''}
                        {trace.createdAt || trace.created_at ? ` · ${formatDateTime(trace.createdAt || trace.created_at)}` : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>

            {selectedId ? (
              <div className="border-t border-line pt-4" data-testid="trace-detail-panel">
                {detailLoading ? (
                  <p className="text-sm text-ink-muted" aria-busy="true">Učitavam detalje traga…</p>
                ) : detailError ? (
                  <Callout tone="danger" glyph="!" alert title="Detalj traga nije dostupan">
                    {detailError}
                  </Callout>
                ) : detail ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="rounded-md border border-line bg-surface-muted px-2.5 py-1.5">
                        <p className="eyebrow">Model</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-ink">{actualModel || '—'}</p>
                      </div>
                      <div className="rounded-md border border-line bg-surface-muted px-2.5 py-1.5">
                        <p className="eyebrow">Provider / Finish</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-ink">
                          {[actualProvider, finishReason].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <div className="rounded-md border border-line bg-surface-muted px-2.5 py-1.5">
                        <p className="eyebrow">TTFT / Latencija / Trošak</p>
                        <p className="mt-0.5 font-mono text-xs tabular-nums text-ink">
                          {ttftMs ?? '—'} ms / {latencyMs ?? '—'} ms / {Number.isFinite(Number(costUsd)) ? `$${Number(costUsd).toFixed(4)}` : '—'}
                        </p>
                      </div>
                    </div>

                    {Array.isArray(validationErrors) && validationErrors.length > 0 ? (
                      <div>
                        <p className="eyebrow">Greške validacije</p>
                        <pre className="mt-1 max-h-36 overflow-auto rounded-md border border-line bg-warning-surface p-2.5 font-mono text-xs text-ink">
                          {JSON.stringify(validationErrors, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    <div>
                      <p className="eyebrow">Sirovi odgovor (raw_response)</p>
                      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-muted p-3 font-mono text-xs text-ink">
                        {rawResponse || 'Nema spremljenog odgovora.'}
                      </pre>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Sheet>
  );
}
