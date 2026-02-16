import RunStatusBadge from './RunStatusBadge';

const formatDate = (iso) => {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('hr-HR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
};

export default function RunsTable({ runs, onOpenRun }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <table className="min-w-full divide-y divide-[var(--border)]">
        <thead className="bg-[var(--surface-muted)]">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">OIB</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Kreirano</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {runs.map((run) => (
            <tr
              key={run.id}
              className="cursor-pointer hover:bg-[var(--surface-muted)]/60 transition-colors"
              onClick={() => onOpenRun(run.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenRun(run.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Otvori analizu za OIB ${run.oib}`}
            >
              <td className="px-4 py-3 text-sm font-medium text-[var(--text)]">{run.oib}</td>
              <td className="px-4 py-3 text-sm">
                <RunStatusBadge status={run.status} />
              </td>
              <td className="px-4 py-3 text-sm text-[var(--text-muted)]">{formatDate(run.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
