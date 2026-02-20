export default function RunProgressStepper({ stages, isErrored }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text)]">Napredak obrade</h3>
        {isErrored && <span className="text-xs font-medium text-[var(--danger)]">Detektirana greška</span>}
      </div>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((stage) => (
          <li key={stage.key} className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-2">
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${
                stage.completed || stage.active ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            />
            <span className={`text-xs ${stage.active ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-muted)]'}`}>
              {stage.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
