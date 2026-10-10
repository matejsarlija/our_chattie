import { useNavigate } from 'react-router-dom';
import DashboardShell from '../DashboardShell';
import LabLaunchPanel from './LabLaunchPanel';
import LabExperimentList from './LabExperimentList';
import { useLabExperiments } from '../../../hooks/useLabExperiments';

export default function AnalysisLabPage() {
  const navigate = useNavigate();
  const {
    experiments, count, loading, error, hasNext, hasPrev, nextPage, prevPage, offset, limit, loadExperiments,
  } = useLabExperiments({ limit: 10 });

  const pageLabel = count === 0
    ? '0 od 0'
    : `${offset + 1}-${Math.min(offset + limit, count)} od ${count}`;

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)]">Analitički laboratorij</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text)]">Tri načina da se pročita isti predmet</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            Uspoređujemo izvještaj bez grupiranja, izvještaj s tematskim grupama i varijantu s automatskim sažecima tema.
            Sve tri koriste isti zamrznuti paket dokaza. Mjere opisuju razlike; ne biraju pobjednika.
          </p>
        </div>

        <LabLaunchPanel onCreated={(id) => navigate(`/dashboard/lab/experiments/${id}`)} />

        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-[var(--text)]">Spremljene usporedbe</h2>

          {error && (
            <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {error}
              <button type="button" onClick={() => loadExperiments(offset)} className="ml-3 underline">
                Pokušaj ponovno
              </button>
            </div>
          )}

          {loading ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">
              Učitavam usporedbe…
            </div>
          ) : (
            <>
              <LabExperimentList experiments={experiments} onOpen={(id) => navigate(`/dashboard/lab/experiments/${id}`)} />
              {count > 0 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-[var(--text-muted)]">{pageLabel}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={prevPage}
                      disabled={!hasPrev}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-40"
                    >
                      Prethodna
                    </button>
                    <button
                      type="button"
                      onClick={nextPage}
                      disabled={!hasNext}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-40"
                    >
                      Sljedeća
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </DashboardShell>
  );
}
