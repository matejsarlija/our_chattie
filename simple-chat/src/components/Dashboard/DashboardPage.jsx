import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAnalysisRuns } from '../../hooks/useAnalysisRuns';
import RunsTable from './RunsTable';
import RunsCardList from './RunsCardList';
import DashboardShell from './DashboardShell';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { runs, count, loading, error, hasNext, hasPrev, nextPage, prevPage, offset, limit, loadRuns } = useAnalysisRuns({
    limit: 10,
  });

  const pageLabel = useMemo(() => {
    if (!count) return '0 od 0';
    const start = offset + 1;
    const end = Math.min(offset + limit, count);
    return `${start}-${end} od ${count}`;
  }, [count, limit, offset]);

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Povijest analiza</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Pregled svih pokrenutih analiza.</p>
          </div>
          <button
            onClick={() => navigate('/dashboard?new=1')}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white hover:opacity-90"
          >
            + Nova analiza
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
            <button
              onClick={() => loadRuns(offset)}
              className="ml-3 underline"
            >
              Pokušaj ponovno
            </button>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">
            Učitavam analize…
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <p className="text-[var(--text)]">Nemate spremljenih analiza.</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Pokrenite prvu analizu klikom na gumb “Nova analiza”.</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <RunsTable runs={runs} onOpenRun={(id) => navigate(`/dashboard/runs/${id}`)} />
            </div>
            <div className="md:hidden">
              <RunsCardList runs={runs} onOpenRun={(id) => navigate(`/dashboard/runs/${id}`)} />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-[var(--text-muted)]">{pageLabel}</p>
              <div className="flex gap-2">
                <button
                  onClick={prevPage}
                  disabled={!hasPrev}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-40"
                >
                  Prethodna
                </button>
                <button
                  onClick={nextPage}
                  disabled={!hasNext}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-40"
                >
                  Sljedeća
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </DashboardShell>
  );
}
