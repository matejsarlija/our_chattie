import Badge from './Badge';

/**
 * The single Croatian run-status vocabulary.
 *
 * The audit found SIX status implementations with FOUR different Croatian label
 * vocabularies — "Završeno" on the dashboard and "Dovršeno" in the Lab for the
 * same backend value. This mapping is the only one; every consumer imports it,
 * so a value can never render two ways.
 *
 * Status is carried by GLYPH + LABEL + COLOUR. That third element is not
 * decoration: computing the §3.4 palette showed the pairwise luminance ratio
 * between these foregrounds is 1.03–1.51 (success vs warning = 1.07, i.e.
 * effectively identical), so lightness cannot separate them and a glyph (or an
 * equivalent shape) is mandatory under WCAG 1.4.1.
 *
 * The frame is uniform for every tone — the colour sits on the glyph, never on
 * the pill — so nothing shouts, which was an explicit requirement.
 */
const STATUS_MAP = {
  done: { label: 'Završeno', tone: 'success', glyph: '✓' },
  completed: { label: 'Završeno', tone: 'success', glyph: '✓' },
  running: { label: 'U tijeku', tone: 'info', glyph: '◐' },
  queued: { label: 'U redu čekanja', tone: 'neutral', glyph: '…' },
  canceled: { label: 'Otkazano', tone: 'neutral', glyph: '—' },
  cancelled: { label: 'Otkazano', tone: 'neutral', glyph: '—' },
  error: { label: 'Greška', tone: 'danger', glyph: '!' },
  failed: { label: 'Greška', tone: 'danger', glyph: '!' },
};

/** Colour for the glyph only. The frame is tone-independent on purpose. */
const GLYPH_CLASS = {
  success: 'text-success',
  info: 'text-info',
  neutral: 'text-ink-muted',
  danger: 'text-danger',
  unknown: 'text-ink-muted',
};

/**
 * Resolve a raw backend status.
 *
 * Unlike the implementation this replaces, an UNRECOGNISED status does not fall
 * through to "U tijeku". Rendering a failed run as in-progress is the worst
 * failure mode this app has, so unknown values fail loud and neutral.
 */
export function resolveRunStatus(status) {
  const key = String(status ?? '').toLowerCase();
  const found = STATUS_MAP[key];
  if (found) return found;
  return { label: 'Nepoznat status', tone: 'unknown', glyph: '?' };
}

export default function StatusBadge({ status, className }) {
  const { label, tone, glyph } = resolveRunStatus(status);
  return (
    <Badge tone={tone} className={className}>
      <span className={GLYPH_CLASS[tone]} aria-hidden="true">{glyph}</span>
      {label}
    </Badge>
  );
}

export { STATUS_MAP };
