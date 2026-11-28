import { useState } from 'react';
import StatusBadge from '../ui/StatusBadge';

export default function BenchCandidatesPanel({
  candidates = [],
  onSeed,
  onMicroBench,
  selectedModel = 'z-ai/glm-5.3-flash',
}) {
  const [busyId, setBusyId] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const handleMicroBench = async (id, dryRun) => {
    setBusyId(id);
    try {
      const res = await onMicroBench?.(id, {
        model: selectedModel,
        dryRun,
        approved: !dryRun,
        maxCost: dryRun ? 0 : 0.05,
      });
      setLastResult(res);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="bench-candidates-heading" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 id="bench-candidates-heading" className="text-base font-semibold text-[var(--text)]">
            Kandidati iz produkcije (bench_candidates)
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Anomalije i segmenti s greškama za referentno-slobodni mikro-bench.
          </p>
        </div>
        <button
          type="button"
          onClick={onSeed}
          className="rounded-lg border border-[var(--border-control)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          Seed Kerum uzorke
        </button>
      </div>

      {lastResult ? (
        <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text)]">
          <strong>Zadnji mikro-bench:</strong> {lastResult.docName} ({lastResult.model}) —{' '}
          {lastResult.dryRun
            ? `Procjena $${lastResult.estimatedCostUsd}`
            : `Utemeljenost ${Math.round((lastResult.score?.groundingRate ?? 0) * 100)}% (${lastResult.latencyMs} ms)`}
        </div>
      ) : null}

      {candidates.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nema zabilježenih kandidata.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <th className="py-2 pr-3">Dokument</th>
                <th className="py-2 pr-3">Razlozi</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 text-right">Akcije</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)]/60">
                  <td className="py-2 pr-3 font-medium text-[var(--text)]">{c.docName}</td>
                  <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">
                    {(c.triggerReasons || []).join(', ') || '—'}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={c.status === 'evaluated' ? 'done' : 'queued'} />
                  </td>
                  <td className="py-2 text-right space-x-2">
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => handleMicroBench(c.id, true)}
                      className="rounded border border-[var(--border-control)] px-2 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
                    >
                      Dry-run
                    </button>
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => handleMicroBench(c.id, false)}
                      className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Mikro-bench
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
