import { formatEur } from './format';

/**
 * The matter's headline figure — or nothing.
 *
 * Option B, chosen deliberately over the previous treatment: this column
 * returns a NUMBER or an em-dash, never an explanation. On the real data 9 of
 * 10 rows had no defensible figure, and the old copy filled that space with
 * justification text. A column that says "we don't know" ten times is noise
 * wearing a column's width.
 *
 * It also removes a false statement. The old cell rendered "nema iznosa u EUR"
 * for runs that actually held 20–96 moneyFlow entries — they lacked the derived
 * EUR field because they are older-shaped, not because the pipeline found no
 * money. Telling a lawyer "no amount in EUR" there was untrue.
 *
 * A total is shown ONLY when every entry points the same way. A stored run
 * (2084d894) mixes obveze, potraživanja, namirenja and rejected claims, and the
 * backend's sum of those is 1,685,587,973.69 EUR — arithmetically valid and
 * meaningless. Summing a rejected claim with money someone is owed is not an
 * amount in dispute.
 *
 * Consequence, accepted: a dash is ambiguous between "not computed",
 * "still running" and "no money in this matter". The detail view is where that
 * distinction gets made, in words.
 */
export default function AmountCell({ amounts, running = false, className = '' }) {
  const total = amounts?.singleDirection && typeof amounts.eurTotal === 'number'
    ? amounts.eurTotal
    : null;

  if (total === null) {
    return <span className={`text-base whitespace-nowrap text-ink-muted ${className}`}>—</span>;
  }

  return (
    <span className={`block text-base font-medium whitespace-nowrap tabular-nums text-ink ${className}`}>
      {formatEur(total)}
    </span>
  );
}
