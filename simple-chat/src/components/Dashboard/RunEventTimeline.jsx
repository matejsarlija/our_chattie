const formatDate = (iso) => {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('hr-HR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso));
};

export default function RunEventTimeline({ timeline, isRunning, loading, embedded = false }) {
  if (!timeline.length) {
    const emptyContent = (
      <div className="mt-1 flex items-center gap-2 text-sm text-[var(--text-muted)]">
        {(loading || isRunning) && <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />}
        {isRunning ? 'Analiza je u tijeku. Događaji će biti prikazani čim stignu.' : 'Nema zabilježenih događaja za ovu analizu.'}
      </div>
    );

    if (embedded) return emptyContent;

    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="text-sm font-semibold text-[var(--text)]">Događaji</h3>
        {emptyContent}
      </div>
    );
  }

  const timelineList = (
    <ol className={embedded ? 'space-y-3' : 'mt-4 space-y-3'}>
      {timeline.map((event) => (
        <li key={event.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-[var(--text)]">{event.stageLabel}</p>
            <time className="text-xs text-[var(--text-muted)]">{formatDate(event.createdAt)}</time>
          </div>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{event.message}</p>
        </li>
      ))}
    </ol>
  );

  if (embedded) return timelineList;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="text-sm font-semibold text-[var(--text)]">Događaji</h3>
      {timelineList}
    </div>
  );
}
