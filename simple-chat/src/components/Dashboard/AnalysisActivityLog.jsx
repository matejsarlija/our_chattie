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
      <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
        <span aria-hidden className="select-none text-[var(--text-muted)]">·</span>
        <span className="font-mono">
          [{time}] još aktivan{counts ? ` — ${counts} analizirano` : ''}{item.currentFile ? ` (trenutno: ${item.currentFile})` : ''}
        </span>
      </div>
    );
  }

  const ok = item.status === 'ok';
  return (
    <div className="flex items-start gap-2 text-xs">
      <span aria-hidden className={`select-none font-mono ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>{ok ? '✓' : '✗'}</span>
      <span className="font-mono text-[var(--text-muted)]">
        [{time}]{' '}
        {item.retried && <span title="ponovljeni pokušaj" className="text-amber-600">↻ </span>}
        <span className={ok ? 'text-[var(--text)]' : 'text-[var(--text)]'}>{item.fileName || item.message}</span>
        {duration && <span> · {duration}</span>}
        {!ok && item.error && <span className="text-rose-600"> — {item.error}</span>}
      </span>
    </div>
  );
}

export default function AnalysisActivityLog({ activity = [], isRunning = false }) {
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

  return (
    <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="analysis-activity-log">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">Aktivnost obrade dokumenata</h3>
        <div className="flex items-center gap-2">
          {latestCounts.total != null && (
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 font-mono text-xs text-[var(--text-muted)]">
              {latestCounts.done ?? 0}/{latestCounts.total}
            </span>
          )}
          {isRunning && liveness && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs ${
                liveness.stalled
                  ? 'border border-amber-300 bg-amber-50 text-amber-700'
                  : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
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
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
            >
              {expanded ? 'Prikaži zadnje retke' : `Prikaži cijeli zapis (${activity.length})`}
            </button>
          )}
        </div>
      </div>
      <div className="space-y-1">
        {visible.map((item) => (
          <ActivityLine key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
