const mapStatus = (status) => {
  const normalized = String(status || '').toLowerCase();

  if (['done', 'completed'].includes(normalized)) {
    return { label: 'Završeno', tone: 'success' };
  }

  if (['error', 'failed'].includes(normalized)) {
    return { label: 'Greška', tone: 'danger' };
  }

  if (['canceled', 'cancelled'].includes(normalized)) {
    return { label: 'Otkazano', tone: 'warning' };
  }

  if (['queued'].includes(normalized)) {
    return { label: 'U redu čekanja', tone: 'warning' };
  }

  return { label: 'U tijeku', tone: 'accent' };
};

export default function RunStatusBadge({ status }) {
  const mapped = mapStatus(status);
  const toneVar = {
    success: 'var(--success)',
    danger: 'var(--danger)',
    warning: 'var(--warning)',
    accent: 'var(--accent)',
  }[mapped.tone] || 'var(--accent)';

  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{
        color: toneVar,
        borderColor: toneVar,
        backgroundColor: 'var(--surface)',
      }}
    >
      {mapped.label}
    </span>
  );
}
