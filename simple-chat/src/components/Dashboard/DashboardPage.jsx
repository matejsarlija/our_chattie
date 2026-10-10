import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAnalysisRuns } from '../../hooks/useAnalysisRuns';
import RunsTable from './RunsTable';
import RunsCardList from './RunsCardList';
import DashboardShell from './DashboardShell';
import Callout from '../ui/Callout';

/** Column skeleton. Reserving the populated table's height is what stops the
 *  page jumping ~300px when data lands (an audit finding). */
function TableSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-line bg-surface"
      aria-hidden="true"
    >
      <div className="bg-surface-muted px-4 py-3 grid grid-cols-[38fr_20fr_17fr_13fr_12fr] gap-4">
        {['w-20', 'w-14', 'w-16', 'w-20', 'w-12'].map((w) => (
          <div key={w} className={`skeleton h-3 ${w}`} />
        ))}
      </div>
      <div className="divide-y divide-line">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="px-4 py-3.5 grid grid-cols-[38fr_20fr_17fr_13fr_12fr] gap-4 items-center">
            <div className="skeleton h-4 w-3/5" />
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-4 w-4/5" />
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-4 w-full justify-self-end" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const {
    runs, count, loading, error, hasNext, hasPrev,
    nextPage, prevPage, offset, limit, loadRuns,
  } = useAnalysisRuns({ limit: 10 });

  const pageLabel = useMemo(() => {
    if (!count) return '0 od 0';
    const start = offset + 1;
    const end = Math.min(offset + limit, count);
    return `${start}–${end} od ${count}`;
  }, [count, limit, offset]);

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Povijest analiza</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {count ? `${count} analiza` : 'Pregled svih pokrenutih analiza.'}
            </p>
          </div>
          {/* One primary action. The previous page had a second "+ Nova analiza"
              at a different size, competing with the header's. */}
          <button
            type="button"
            onClick={() => navigate('/dashboard?new=1')}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Nova analiza
          </button>
        </div>

        {error ? (
          <Callout
            tone="danger"
            glyph="!"
            alert
            title="Analize se nije uspjelo učitati"
            action={(
              <button
                type="button"
                onClick={() => loadRuns(offset)}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Pokušaj ponovno
              </button>
            )}
          >
            {error} Vaše prethodne analize nisu izgubljene.
          </Callout>
        ) : null}

        {loading && runs.length === 0 ? (
          <div aria-busy="true" aria-label="Učitavanje analiza">
            <TableSkeleton />
          </div>
        ) : null}

        {!loading && runs.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center">
            <div className="mx-auto max-w-sm">
              <h2 className="text-lg font-medium text-ink">Još nema nijedne analize</h2>
              <p className="mt-2 text-sm text-ink-muted">
                Unesite OIB, broj predmeta ili opis predmeta, a mi ćemo pronaći objave
                na sudskom portalu i analizirati ih.
              </p>
              {/* The old empty state told the user to click a button in the
                  header, which may have been scrolled out of view. */}
              <button
                type="button"
                onClick={() => navigate('/dashboard?new=1')}
                className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Pokreni prvu analizu
              </button>
              <p className="mt-3 text-xs text-ink-muted">Oko 2–5 minuta po predmetu.</p>
            </div>
          </div>
        ) : null}

        {runs.length > 0 ? (
          <>
            <div className="hidden md:block">
              <RunsTable runs={runs} onOpenRun={(id) => navigate(`/dashboard/runs/${id}`)} />
            </div>
            <div className="md:hidden">
              <RunsCardList runs={runs} />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm tabular-nums text-ink-muted">{pageLabel}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={prevPage}
                  disabled={!hasPrev}
                  aria-describedby="runs-prev-reason"
                  className="rounded-md border border-line-control px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  Prethodna
                </button>
                {/* A disabled button that only dims gives the user no reason. */}
                <span id="runs-prev-reason" className="sr-only">
                  {hasPrev
                    ? 'Idi na prethodnu stranicu rezultata.'
                    : 'Ne postoji prethodna stranica. Ovo je prva stranica rezultata.'}
                </span>
                <button
                  type="button"
                  onClick={nextPage}
                  disabled={!hasNext}
                  aria-describedby="runs-next-reason"
                  className="rounded-md border border-line-control px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  Sljedeća
                </button>
                <span id="runs-next-reason" className="sr-only">
                  {hasNext
                    ? 'Idi na sljedeću stranicu rezultata.'
                    : 'Ne postoji sljedeća stranica. Ovo je posljednja stranica rezultata.'}
                </span>
              </div>
            </div>
          </>
        ) : null}
      </main>
    </DashboardShell>
  );
}
