const STATUS_TEXT = {
  complete: 'Dovršeno',
  partial: 'Djelomično',
  error: 'Greška',
  running: 'U tijeku',
};

const STATUS_STYLE = {
  complete: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  partial: 'border-amber-300 bg-amber-50 text-amber-800',
  error: 'border-rose-300 bg-rose-50 text-rose-800',
  running: 'border-sky-300 bg-sky-50 text-sky-800',
};

const STATUS_MARK = {
  complete: '✓',
  partial: '◐',
  error: '!',
  running: '…',
};

export default function LabStatusBadge({ status }) {
  const text = STATUS_TEXT[status] || status || 'Nepoznato';
  const style = STATUS_STYLE[status] || 'border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]';
  const mark = STATUS_MARK[status] || '?';

  return (
    <span
      aria-label={`Status eksperimenta: ${text}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      <span aria-hidden="true">{mark}</span>
      {text}
    </span>
  );
}
