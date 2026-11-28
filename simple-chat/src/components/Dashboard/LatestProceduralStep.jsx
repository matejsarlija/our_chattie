import { useMemo } from 'react';

const getTimelineText = (item) => {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  for (const key of ['event', 'description', 'title', 'text']) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim();
  }
  return '';
};

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
    <section className="card mb-5 p-4" data-testid="latest-step">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">Najnoviji postupovni korak</p>
      <p className="mt-1 text-sm font-medium text-ink">
        {String(latest.item.date)}{text ? ` — ${text}` : ''}
      </p>
    </section>
  );
}
