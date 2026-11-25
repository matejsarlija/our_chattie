import { resolveRunStatus } from '../ui/StatusBadge';

export default function RunStatusBadge({ status }) {
  const mapped = resolveRunStatus(status);
  const toneVar = {
    success: 'var(--success)',
    danger: 'var(--danger)',
    warning: 'var(--warning)',
    info: 'var(--accent)',
    neutral: 'var(--text-muted)',
    unknown: 'var(--text-muted)',
  }[mapped.tone];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{
        color: toneVar,
        borderColor: toneVar,
        backgroundColor: 'var(--surface)',
      }}
    >
      <span aria-hidden="true">{mapped.glyph}</span>
      {mapped.label}
    </span>
  );
}
