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
      <div className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
        {(loading || isRunning) && <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />}
        {isRunning ? 'Analiza je u tijeku. Događaji će biti prikazani čim stignu.' : 'Nema zabilježenih događaja za ovu analizu.'}
      </div>
    );

    if (embedded) return emptyContent;

    return (
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-ink">Događaji</h3>
        {emptyContent}
      </div>
    );
  }

  const timelineList = (
    <ol className={embedded ? 'space-y-3' : 'mt-4 space-y-3'}>
      {timeline.map((event) => (
        <li key={event.id} className="rounded-lg border border-line bg-surface-muted/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-ink">{event.stageLabel}</p>
            <time className="text-xs text-ink-muted">{formatDate(event.createdAt)}</time>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{event.message}</p>
        </li>
      ))}
    </ol>
  );

  if (embedded) return timelineList;

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-ink">Događaji</h3>
      {timelineList}
    </div>
  );
}
