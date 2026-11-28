import { useEffect, useMemo, useState } from 'react';

const formatClock = (iso) => {
  if (!iso) return '';
  return new Intl.DateTimeFormat('hr-HR', { timeStyle: 'medium' }).format(new Date(iso));
};

const formatDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs == null) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1).replace('.', ',')} s`;
};

const COLLAPSED_LINE_COUNT = 8;
const STALL_WARNING_MS = 90_000;

function ActivityLine({ item }) {
  const time = formatClock(item.createdAt);
  const duration = formatDuration(item.durationMs);

  if (item.kind === 'heartbeat') {
    const counts = [item.done, item.total].every((v) => v != null) ? `${item.done}/${item.total}` : null;
    return (
      <div className="flex items-start gap-2 text-xs text-ink-muted">
        <span aria-hidden className="select-none text-ink-muted">·</span>
        <span className="font-mono">
          [{time}] još aktivan{counts ? ` — ${counts} analizirano` : ''}{item.currentFile ? ` (trenutno: ${item.currentFile})` : ''}
        </span>
      </div>
    );
  }

  const ok = item.status === 'ok';
  return (
    <div className="flex items-start gap-2 text-xs">
      <span aria-hidden className={`select-none font-mono ${ok ? 'text-success' : 'text-danger'}`}>{ok ? '✓' : '✗'}</span>
      <span className="font-mono text-ink-muted">
        [{time}]{' '}
        {item.retried && <span title="ponovljeni pokušaj" className="text-warning">↻ </span>}
        <span className="text-ink">{item.fileName || item.message}</span>
        {duration && <span> · {duration}</span>}
        {!ok && (item.reason || item.error) && (
          <span className="text-danger"> — {item.reason || item.error}</span>
        )}
      </span>
    </div>
  );
}

export default function AnalysisActivityLog({ activity = [], isRunning = false, headerCounter = null, counterKnown = false }) {
  const [expanded, setExpanded] = useState(false);
  const [, setTick] = useState(0);

  const lastActivityAt = activity.length > 0 ? activity[activity.length - 1]?.createdAt : null;

  useEffect(() => {
    if (!isRunning) return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, [isRunning]);

  const liveness = useMemo(() => {
    if (!isRunning || !lastActivityAt) return null;
    const ageMs = Date.now() - new Date(lastActivityAt).getTime();
    if (!Number.isFinite(ageMs)) return null;
    const ageSeconds = Math.max(0, Math.round(ageMs / 1000));
    return {
      ageSeconds,
      stalled: ageMs > STALL_WARNING_MS,
    };
  }, [isRunning, lastActivityAt, activity.length]);

  if (!activity.length) return null;

  const latestCounts = [...activity].reverse().find((item) => item.total != null) || {};
  const visible = expanded ? activity : activity.slice(-COLLAPSED_LINE_COUNT);

  const showCounterHeader = headerCounter !== null && headerCounter !== undefined;
  const counterTotal = showCounterHeader ? headerCounter.total : null;
  const counterKnownValue = showCounterHeader && counterKnown && Number.isFinite(counterTotal);
  const counterPercent = counterKnownValue
    ? Math.min(100, Math.max(0, (headerCounter.done / Math.max(1, counterTotal)) * 100))
    : 0;
  const counterLine = showCounterHeader
    ? counterKnownValue
      ? `Obrađeno ${headerCounter.done} od ${counterTotal} ${headerCounter.unit}${headerCounter.failed > 0 ? `, ${headerCounter.failed} neuspjelo` : ''}`
      : 'Prikupljam popis…'
    : null;

  return (
    <section className="card mb-5 p-4" data-testid="analysis-activity-log">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Aktivnost obrade dokumenata</h3>
        <div className="flex items-center gap-2">
          {latestCounts.total != null && (
            <span className="rounded-full border border-line bg-surface-muted px-2.5 py-1 font-mono text-xs text-ink-muted">
              {latestCounts.done ?? 0}/{latestCounts.total}
            </span>
          )}
          {isRunning && liveness && (
            <span
              className={`rounded-full border px-2.5 py-1 text-xs ${
                liveness.stalled
                  ? 'border-line bg-warning-surface text-warning'
                  : 'border-line bg-success-surface text-success'
              }`}
            >
              {liveness.stalled
                ? `Nema aktivnosti ${liveness.ageSeconds} s — obrada je možda zapela`
                : `Aktivno · prije ${liveness.ageSeconds} s`}
            </span>
          )}
          {activity.length > COLLAPSED_LINE_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="rounded-md border border-line-control px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted"
            >
              {expanded ? 'Prikaži zadnje retke' : `Prikaži cijeli zapis (${activity.length})`}
            </button>
          )}
        </div>
      </div>
      {showCounterHeader && (
        <div className="mb-3">
          <p className="mb-1.5 text-sm font-medium text-ink">{counterLine}</p>
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-label="Napredak obrade"
            {...(counterKnownValue
              ? { 'aria-valuenow': headerCounter.done, 'aria-valuemin': 0, 'aria-valuemax': counterTotal }
              : {})}
          >
            <div
              className={`h-full rounded-full bg-accent ${counterKnownValue ? '' : 'activity-indeterminate-bar'}`}
              style={counterKnownValue ? { width: `${counterPercent}%` } : undefined}
            />
          </div>
        </div>
      )}
      <div className="space-y-1">
        {visible.map((item) => (
          <ActivityLine key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
