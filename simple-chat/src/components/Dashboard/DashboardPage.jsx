import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAnalysisRuns } from '../../hooks/useAnalysisRuns';
import RunsTable from './RunsTable';
import RunsCardList from './RunsCardList';
import DashboardShell from './DashboardShell';
import Callout from '../ui/Callout';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { cn } from '../../lib/utils';

const STATUS_FILTERS = [
  { key: 'all', label: 'Sve', match: () => true },
  { key: 'done', label: 'Završeno', match: (s) => ['done', 'completed', 'complete', 'success'].includes(s) },
  { key: 'running', label: 'U tijeku', match: (s) => ['running', 'queued'].includes(s) },
  { key: 'partial', label: 'Djelomično', match: (s) => s === 'partial' },
  { key: 'error', label: 'Greška / Prekinuto', match: (s) => ['error', 'failed', 'interrupted', 'aborted', 'canceled', 'cancelled'].includes(s) },
];

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
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const pageLabel = useMemo(() => {
    if (!count) return '0 od 0';
    const start = offset + 1;
    const end = Math.min(offset + limit, count);
    return `${start}–${end} od ${count}`;
  }, [count, limit, offset]);

  const filteredRuns = useMemo(() => {
    const activeFilter = STATUS_FILTERS.find((f) => f.key === statusFilter) || STATUS_FILTERS[0];
    const needle = searchQuery.trim().toLowerCase();
    return runs.filter((run) => {
      const normalizedStatus = String(run?.status || '').toLowerCase();
      if (!activeFilter.match(normalizedStatus)) return false;
      if (!needle) return true;
      const summary = run.summary || {};
      const haystack = [
        summary.caseNumber,
        run.oib,
        summary.queryValue,
        summary.court,
        ...(Array.isArray(summary.participantNames) ? summary.participantNames : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [runs, statusFilter, searchQuery]);

  const hasActiveFilter = statusFilter !== 'all' || searchQuery.trim() !== '';

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-5 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Povijest analiza</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {count ? `${count} analiza` : 'Pregled svih pokrenutih analiza.'}
          </p>
        </div>

        {error ? (
          <Callout
            tone="danger"
            glyph="!"
            alert
            title="Analize se nije uspjelo učitati"
            action={(
              <Button variant="primary" size="sm" onClick={() => loadRuns(offset)}>
                Pokušaj ponovno
              </Button>
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
              <Button
                variant="primary"
                className="mt-5"
                onClick={() => navigate('/dashboard?new=1')}
              >
                Pokreni prvu analizu
              </Button>
              <p className="mt-3 text-xs text-ink-muted">Oko 2–5 minuta po predmetu.</p>
            </div>
          </div>
        ) : null}

        {runs.length > 0 ? (
          <>
            <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtriraj po statusu">
                {STATUS_FILTERS.map((filter) => {
                  const active = statusFilter === filter.key;
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setStatusFilter(filter.key)}
                      className={cn(
                        'whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors sm:px-3',
                        active
                          ? 'border-accent bg-info-surface text-accent'
                          : 'border-line-control bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink',
                      )}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>

              <div className="w-full sm:w-72">
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pretraži predmet, OIB ili stranku…"
                  aria-label="Pretraži analize"
                />
              </div>
            </div>

            {filteredRuns.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface px-6 py-10 text-center">
                <p className="text-sm text-ink-muted">
                  Nema analiza koje odgovaraju odabranom filtru.
                </p>
                {hasActiveFilter ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setStatusFilter('all');
                      setSearchQuery('');
                    }}
                  >
                    Poništi filtar
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <RunsTable runs={filteredRuns} onOpenRun={(id) => navigate(`/dashboard/runs/${id}`)} />
                </div>
                <div className="md:hidden">
                  <RunsCardList runs={filteredRuns} />
                </div>
              </>
            )}

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm tabular-nums text-ink-muted">{pageLabel}</p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={prevPage}
                  disabled={!hasPrev}
                  aria-describedby="runs-prev-reason"
                >
                  Prethodna
                </Button>
                <span id="runs-prev-reason" className="sr-only">
                  {hasPrev
                    ? 'Idi na prethodnu stranicu rezultata.'
                    : 'Ne postoji prethodna stranica. Ovo je prva stranica rezultata.'}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={nextPage}
                  disabled={!hasNext}
                  aria-describedby="runs-next-reason"
                >
                  Sljedeća
                </Button>
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
