/**
 * One callout geometry for every notice in the app.
 *
 * The audit found the amber/rose notice box rendered in EIGHT different shapes
 * across the codebase (varying radius, padding axis, border weight and hue),
 * using FIVE distinct reds and EIGHT distinct ambers. A notice system only
 * works if the reader recognises "this is a caveat" before reading it, so the
 * shape is fixed here and only the tone varies.
 *
 * Tones map to the §3.4 status palette, where fg-on-surface and fg-on-tint were
 * both verified ≥ 4.5:1.
 */

const TONE = {
  neutral: 'border-line bg-surface text-ink',
  info: 'border-line bg-info-surface text-ink',
  success: 'border-line bg-success-surface text-ink',
  warning: 'border-line bg-warning-surface text-ink',
  danger: 'border-line bg-danger-surface text-ink',
};

const GLYPH = {
  neutral: '·',
  info: 'i',
  success: '✓',
  warning: '⚠',
  danger: '!',
};

const GLYPH_CLASS = {
  neutral: 'text-ink-muted',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/**
 * @param {object}  props
 * @param {string}  props.tone      one of TONE; defaults to 'neutral'
 * @param {string}  props.title     optional bold line
 * @param {string}  props.glyph     override the tone's default glyph
 * @param {boolean} props.alert     announce via role="alert" (asynchronous failures)
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} props.action  trailing control(s)
 */
export default function Callout({
  tone = 'neutral',
  title,
  glyph,
  alert = false,
  className = '',
  children,
  action,
}) {
  const resolved = TONE[tone] ? tone : 'neutral';
  return (
    <div
      className={`mb-5 rounded-md border px-4 py-3.5 ${TONE[resolved]} ${className}`}
      role={alert ? 'alert' : undefined}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 text-sm font-semibold ${GLYPH_CLASS[resolved]}`} aria-hidden="true">
          {glyph ?? GLYPH[resolved]}
        </span>
        <div className="min-w-0 flex-1">
          {title ? <p className="text-base font-medium">{title}</p> : null}
          {children ? <div className={`text-sm text-ink-muted ${title ? 'mt-0.5' : ''}`}>{children}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
