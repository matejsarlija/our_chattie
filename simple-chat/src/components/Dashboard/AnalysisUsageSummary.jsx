const formatTokens = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return new Intl.NumberFormat('hr-HR').format(numeric);
};

export default function AnalysisUsageSummary({ usage, isRunning = false, model = null }) {
  if (!usage || typeof usage !== 'object') return null;

  const input = formatTokens(usage.inputTokens);
  const output = formatTokens(usage.outputTokens);
  const total = formatTokens(usage.totalTokens);

  const stats = [
    { label: 'Ulazni tokeni', value: input },
    { label: 'Izlazni tokeni', value: output },
    { label: 'Ukupno tokena', value: total },
  ];

  return (
    <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">Potrošnja tokena</h3>
        {isRunning && (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            ažurira se
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{stat.label}</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-[var(--text)]">
              {stat.value ?? '—'}
            </p>
          </div>
        ))}
      </div>
      {(Number.isFinite(Number(usage.calls)) || model) && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {Number.isFinite(Number(usage.calls)) ? `${new Intl.NumberFormat('hr-HR').format(usage.calls)} poziva` : ''}
          {Number.isFinite(Number(usage.calls)) && model ? ' · ' : ''}
          {model || ''}
        </p>
      )}
    </section>
  );
}
