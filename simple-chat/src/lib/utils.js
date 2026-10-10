import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class-name helper, following the shadcn/ui convention.
 *
 * `clsx` handles conditional composition; `tailwind-merge` resolves conflicting
 * Tailwind utilities so a caller's `className` reliably wins over a component's
 * defaults (e.g. `rounded-md` passed in beats the component's `rounded-full`).
 * Without the merge step, overriding a variant at the call site silently does
 * nothing whenever both classes end up in the string.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
