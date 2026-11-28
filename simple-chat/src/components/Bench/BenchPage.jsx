import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../Dashboard/DashboardShell';
import Callout from '../ui/Callout';
import StatusBadge from '../ui/StatusBadge';
import { useBenchWorkspace } from '../../hooks/useBenchWorkspace';
import BenchCandidatesPanel from './BenchCandidatesPanel';

export default function BenchPage() {
  const {
    documents,
    smokeDocIds,
    models,
    runs,
    candidates,
    activeJobId,
    jobProgress,
    jobLogs,
    jobStatus,
    routingOverrides,
    loading,
    error,
    startRun,
    cancelActiveJob,
    seedCandidates,
    microBenchCandidate,
    saveRoutingOverrides,
    triggerSmokeGate,
  } = useBenchWorkspace();

  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [selectedModel, setSelectedModel] = useState('z-ai/glm-5.3-flash');
  const [dryRun, setDryRun] = useState(true);
  const [approved, setApproved] = useState(false);
  const [maxCost, setMaxCost] = useState('0.25');
  const [smokeGateMsg, setSmokeGateMsg] = useState(null);
  const [overrideInput, setOverrideInput] = useState('');

  useEffect(() => {
    if (selectedDocIds.length === 0 && smokeDocIds.length > 0) {
      setSelectedDocIds(smokeDocIds);
    }
  }, [smokeDocIds, selectedDocIds.length]);

  useEffect(() => {
    setOverrideInput(JSON.stringify(routingOverrides || {}, null, 2));
  }, [routingOverrides]);

  const toggleDoc = (docId) => {
    setSelectedDocIds((prev) => (
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    ));
  };

  const handleLaunch = async (e) => {
    e.preventDefault();
    await startRun({
      docIds: selectedDocIds,
      models: [selectedModel],
      dryRun,
      approved: dryRun ? false : approved,
      maxCost: dryRun ? 0 : Number(maxCost),
      smoke: selectedDocIds.length <= 6,
    });
  };

  const handleSmokeGate = async () => {
    const res = await triggerSmokeGate({ model: selectedModel, dryRun: true });
    setSmokeGateMsg(`gbench (${selectedModel}): ${res.passed ? 'PROLAZ' : 'PAD'} · budžet $${res.budgetUsd}`);
  };

  const handleSaveOverrides = async () => {
    try {
      const parsed = JSON.parse(overrideInput || '{}');
      await saveRoutingOverrides(parsed);
    } catch {
      // Invalid JSON ignored; keep input editable.
    }
  };

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">Bench</h1>
            <p className="text-sm text-[var(--text-muted)]">
              Programatska evaluacija ekstrakcije, OCR-a i Stage-2 izvještaja na zamrznutom korpusu.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard/bench/gold"
              className="rounded-lg border border-[var(--border-control)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
            >
              Gold editor
            </Link>
          </div>
        </div>

        {error ? <Callout tone="danger" alert title="Greška">{error}</Callout> : null}
        {smokeGateMsg ? <Callout tone="info" title="gbench provjera">{smokeGateMsg}</Callout> : null}

        <section aria-labelledby="bench-launch-heading" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 id="bench-launch-heading" className="text-base font-semibold text-[var(--text)] mb-4">
            Novo izvođenje (Dry-run / Live)
          </h2>

          <form onSubmit={handleLaunch} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label htmlFor="bench-model-select" className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Model
                </label>
                <select
                  id="bench-model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-control)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  <option value="z-ai/glm-5.3-flash">z-ai/glm-5.3-flash</option>
                  <option value="google/gemini-2.5-flash">google/gemini-2.5-flash</option>
                  <option value="google/gemma-4-31b-it">google/gemma-4-31b-it</option>
                  {models
                    .filter((m) => !['z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', 'google/gemma-4-31b-it'].includes(m.modelId))
                    .map((m) => (
                      <option key={m.modelId} value={m.modelId}>{m.modelId}</option>
                    ))}
                </select>
              </div>

              <div>
                <label htmlFor="bench-max-cost" className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                  Maksimalni trošak (USD)
                </label>
                <input
                  id="bench-max-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={dryRun}
                  value={maxCost}
                  onChange={(e) => setMaxCost(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-control)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col justify-end gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                  <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                  Dry-run ($0 procjena)
                </label>
                {!dryRun ? (
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                    <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
                    Odobravam OpenRouter trošak (approved)
                  </label>
                ) : null}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  Odabrani dokumenti ({selectedDocIds.length}/{documents.length})
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDocIds(smokeDocIds)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  Odaberi smoke skup
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] p-2 grid gap-1 sm:grid-cols-2">
                {documents.map((doc) => (
                  <label key={doc.docId} className="inline-flex items-center gap-2 text-xs text-[var(--text)]">
                    <input
                      type="checkbox"
                      checked={selectedDocIds.includes(doc.docId)}
                      onChange={() => toggleDoc(doc.docId)}
                    />
                    <span className="truncate">{doc.fileName || doc.docId} ({doc.pages}p)</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading || selectedDocIds.length === 0 || (!dryRun && (!approved || Number(maxCost) <= 0))}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {dryRun ? 'Pokreni Dry-run' : 'Pokreni Live Bench'}
              </button>
              <button
                type="button"
                onClick={handleSmokeGate}
                className="rounded-lg border border-[var(--border-control)] px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
              >
                gbench smoke-gate
              </button>
              {activeJobId ? (
                <button
                  type="button"
                  onClick={cancelActiveJob}
                  className="rounded-lg border border-red-400 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Otkaži posao
                </button>
              ) : null}
            </div>
          </form>

          {(activeJobId || jobLogs.length > 0 || jobStatus) ? (
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--text)]">
                  Posao {activeJobId || 'zadnji'} · {jobProgress ? `${jobProgress.done}/${jobProgress.total}` : ''}
                </span>
                {jobStatus ? <StatusBadge status={jobStatus} /> : null}
              </div>
              {jobLogs.length > 0 ? (
                <pre className="max-h-36 overflow-auto text-xs text-[var(--text-muted)] whitespace-pre-wrap">
                  {jobLogs.join('\n')}
                </pre>
              ) : null}
            </div>
          ) : null}
        </section>

        <BenchCandidatesPanel
          candidates={candidates}
          onSeed={seedCandidates}
          onMicroBench={microBenchCandidate}
          selectedModel={selectedModel}
        />

        <section aria-labelledby="bench-runs-heading" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 id="bench-runs-heading" className="text-base font-semibold text-[var(--text)] mb-3">
            Povijest Bench izvođenja
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nema zabilježenih Bench izvođenja.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                    <th className="py-2 pr-3">Run ID</th>
                    <th className="py-2 pr-3">Opseg</th>
                    <th className="py-2 pr-3">Tip</th>
                    <th className="py-2 pr-3">Trošak</th>
                    <th className="py-2 text-right">Detalji</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.runId} className="border-b border-[var(--border)]/60">
                      <td className="py-2 pr-3 font-mono text-xs text-[var(--text)]">{r.runId}</td>
                      <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">{r.scope}</td>
                      <td className="py-2 pr-3 text-xs text-[var(--text)]">{r.dryRun ? 'Dry-run' : 'Live'}</td>
                      <td className="py-2 pr-3 text-xs text-[var(--text)]">${Number(r.actualCost || r.estimatedCost || 0).toFixed(4)}</td>
                      <td className="py-2 text-right">
                        <Link to={`/dashboard/bench/runs/${encodeURIComponent(r.runId)}`} className="text-xs text-[var(--accent)] hover:underline">
                          Otvori
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="routing-overrides-heading" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 id="routing-overrides-heading" className="text-base font-semibold text-[var(--text)] mb-2">
            activeTaskRoutingOverrides (Engineering)
          </h2>
          <textarea
            aria-label="activeTaskRoutingOverrides JSON"
            rows={4}
            value={overrideInput}
            onChange={(e) => setOverrideInput(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-control)] bg-[var(--surface)] p-2 font-mono text-xs text-[var(--text)]"
          />
          <button
            type="button"
            onClick={handleSaveOverrides}
            className="mt-2 rounded-lg border border-[var(--border-control)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
          >
            Spremi routing overrides
          </button>
        </section>
      </main>
    </DashboardShell>
  );
}
