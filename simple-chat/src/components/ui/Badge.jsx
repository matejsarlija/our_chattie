import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Badge — adapted from the shadcn/ui `badge` component (copied as owned source,
 * not a runtime dependency, per the project rule against heavy abstractions).
 *
 * Why this exists: the audit found a hand-rolled status pill implemented six
 * different ways across the app. Reaching for a real primitive — even one this
 * thin — is what stops the seventh from appearing.
 *
 * Two deliberate deviations from upstream shadcn:
 *
 * 1. RADIUS. Upstream is `rounded-md` (6px). Our token spec reserves
 *    `radius-full` for pills and nothing else, so the base is `rounded-full`.
 *    A caller can still override via `cn()`.
 *
 * 2. VARIANTS. Upstream ships default/secondary/destructive/outline keyed to
 *    shadcn's own primary/secondary/destructive tokens, which do not exist here.
 *    Rather than alias shadcn's vocabulary onto ours, this exposes OUR status
 *    set: one uniform neutral frame for every tone, with the colour living on
 *    the child, not the frame. That is deliberate — see StatusBadge, where
 *    "calm" was a user requirement, and a per-tone tinted frame would defeat it.
 *
 * 3. PADDING AND LABEL SIZE. Upstream is `px-2 py-0.5 text-xs`. An earlier
 *    adaptation here dropped the padding entirely, which left the pill as bare
 *    text inside a 1px border — too tight to read as a container. Restored, and
 *    widened to `px-2.5 py-1`: a pill has to have room around its label.
 *
 *    The label is `text-sm` (13px), not `text-xs` (11px). The token spec
 *    reserves 11px for uppercase tracked micro-labels and says 11px is never
 *    for content — and a status word is content. "U redu čekanja" is a phrase,
 *    not a label fragment.
 *
 * A pill is decoration around a label, so this renders a <span> and is not
 * focusable. Interactive status is a different component.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 w-fit whitespace-nowrap rounded-full border px-2.5 py-1 text-sm font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-muted text-ink-muted',
        info: 'border-line bg-surface-muted text-ink-muted',
        success: 'border-line bg-surface-muted text-ink-muted',
        warning: 'border-line bg-surface-muted text-ink-muted',
        danger: 'border-line bg-surface-muted text-ink-muted',
        unknown: 'border-line bg-surface-muted text-ink-muted',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

export default function Badge({ tone, className, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {children}
    </span>
  );
}

export { badgeVariants };
