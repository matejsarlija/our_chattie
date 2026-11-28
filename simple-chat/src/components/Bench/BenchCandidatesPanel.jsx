import { useState } from 'react';
import Button from '../ui/Button';
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
    <section aria-labelledby="bench-candidates-heading" className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">02 · Anomalije iz produkcije</p>
          <h2 id="bench-candidates-heading" className="mt-1 text-lg font-semibold text-ink">
            Kandidati iz produkcije (bench_candidates)
          </h2>
          <p className="text-xs text-ink-muted">
            Anomalije i segmenti s greškama za referentno-slobodni mikro-bench.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onSeed}>
          Seed Kerum uzorke
        </Button>
      </div>

      {lastResult ? (
        <div className="mb-3 rounded-md border border-line bg-surface-muted p-3 text-xs text-ink">
          <strong>Zadnji mikro-bench:</strong> {lastResult.docName} ({lastResult.model}) —{' '}
          {lastResult.dryRun
            ? `Procjena $${lastResult.estimatedCostUsd}`
            : `Utemeljenost ${Math.round((lastResult.score?.groundingRate ?? 0) * 100)}% (${lastResult.latencyMs} ms)`}
        </div>
      ) : null}

      {candidates.length === 0 ? (
        <p className="text-sm text-ink-muted">Nema zabilježenih kandidata.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <th className="py-2 pr-3">Dokument</th>
                <th className="py-2 pr-3">Razlozi</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 text-right">Akcije</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-b border-line">
                  <td className="py-2 pr-3 font-medium text-ink">{c.docName}</td>
                  <td className="py-2 pr-3 text-xs text-ink-muted">
                    {(c.triggerReasons || []).join(', ') || '—'}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={c.status === 'evaluated' ? 'done' : 'queued'} />
                  </td>
                  <td className="space-x-2 py-2 text-right">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busyId === c.id}
                      onClick={() => handleMicroBench(c.id, true)}
                    >
                      Dry-run
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={busyId === c.id}
                      onClick={() => handleMicroBench(c.id, false)}
                    >
                      Mikro-bench
                    </Button>
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
