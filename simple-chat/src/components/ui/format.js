/**
 * Croatian formatting helpers shared by the list and detail views.
 *
 * These are pure presentation, deliberately kept out of components so the same
 * value never renders two ways. The audit found the dashboard table and the
 * run-detail event timeline formatting the same timestamp differently
 * (medium-date/short-time vs short-date/medium-time); a single module makes
 * that impossible.
 */

const eurFormatter = new Intl.NumberFormat('hr-HR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
});

const dateTimeFormatter = new Intl.DateTimeFormat('hr-HR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const dateFormatter = new Intl.DateTimeFormat('hr-HR', { dateStyle: 'medium' });

/** 23.520,87 € */
export function formatEur(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return eurFormatter.format(value);
}

/** A non-EUR source-stated figure, shown beside a converted headline. */
export function formatSourceAmount(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return null;
  const numeric = typeof amount === 'number'
    ? amount
    : Number(String(amount).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return String(amount);
  if (!currency || currency === 'EUR') return null;
  return `${new Intl.NumberFormat('hr-HR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric)} ${currency}`;
}

/** 13.09.2026. 15:40 */
export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

/** "prije 2 min" / "prije 3 h" / "prije 2 dana"; null when not parseable. */
export function formatRelative(iso, now = Date.now()) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) return null;
  if (seconds < 60) return 'upravo sada';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `prije ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `prije ${hours} h`;

  const days = Math.round(hours / 24);
  if (days < 7) return `prije ${days} ${days === 1 ? 'dan' : days < 5 ? 'dana' : 'dana'}`;
  if (days < 31) {
    const weeks = Math.round(days / 7);
    return `prije ${weeks} ${weeks === 1 ? 'tjedan' : 'tjedna'}`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `prije ${months} ${months === 1 ? 'mjesec' : 'mjeseci'}`;
  }
  const years = Math.round(days / 365);
  return `prije ${years} ${years === 1 ? 'godinu' : 'godina'}`;
}

/**
 * "57/63" — the two numbers a lawyer scans to judge trustworthiness.
 * Returns null when the run never produced coverage figures.
 */
export function formatCoverage(coverage) {
  if (!coverage) return null;
  const { analyzed, total } = coverage;
  if (typeof analyzed !== 'number' && typeof total !== 'number') return null;
  return `${analyzed ?? '—'}/${total ?? '—'}`;
}

/** "5/6" grounding ratio, or null when the run recorded no claims. */
export function formatGrounding(coverage) {
  if (!coverage) return null;
  const { groundedClaims, totalClaims } = coverage;
  if (typeof totalClaims !== 'number' || totalClaims <= 0) return null;
  if (typeof groundedClaims !== 'number') return null;
  return `${groundedClaims}/${totalClaims}`;
}

/** 0–1 ratio as a whole percentage string, or null. */
export function formatRatio(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return null;
  return `${Math.round(ratio * 100)}%`;
}
