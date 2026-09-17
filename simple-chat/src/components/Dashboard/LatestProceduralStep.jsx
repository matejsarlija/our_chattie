import { useMemo } from 'react';

const getTimelineText = (item) => {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  for (const key of ['event', 'description', 'title', 'text']) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim();
  }
  return '';
};

// TU-1 — latest procedural step: the max-date timeline entry. Dates come
// from the deterministic timeline builder (ISO calendar days); unparseable
// or missing dates are skipped, never guessed. Null when nothing orderable
// exists — the timeline section below remains the full record.
export default function LatestProceduralStep({ timeline }) {
  const latest = useMemo(() => {
    let best = null;
    for (const item of Array.isArray(timeline) ? timeline : []) {
      const timestamp = Date.parse(item?.date);
      if (!Number.isFinite(timestamp)) continue;
      if (!best || timestamp > best.timestamp) best = { timestamp, item };
    }
    return best;
  }, [timeline]);

  if (!latest) return null;

  const text = getTimelineText(latest.item);
  return (
    <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="latest-step">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Najnoviji postupovni korak</p>
      <p className="mt-1 text-sm font-medium text-[var(--text)]">
        {String(latest.item.date)}{text ? ` — ${text}` : ''}
      </p>
    </section>
  );
}
