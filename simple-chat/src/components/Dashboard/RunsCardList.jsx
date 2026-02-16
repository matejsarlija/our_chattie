import RunStatusBadge from './RunStatusBadge';

const formatDate = (iso) => {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('hr-HR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
};

export default function RunsCardList({ runs, onOpenRun }) {
  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          onClick={() => onOpenRun(run.id)}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left hover:bg-[var(--surface-muted)]/60 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-wide text-[var(--text-muted)]">OIB</p>
              <p className="text-base font-semibold text-[var(--text)]">{run.oib}</p>
            </div>
            <RunStatusBadge status={run.status} />
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)]">{formatDate(run.created_at)}</p>
        </button>
      ))}
    </div>
  );
}
