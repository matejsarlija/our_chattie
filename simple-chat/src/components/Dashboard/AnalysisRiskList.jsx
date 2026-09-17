import { useMemo, useState } from 'react';

const getText = (item, keys) => {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  for (const key of keys) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key];
  }
  return '';
};

const getConflictText = (item) => getText(item, ['description', 'text', 'summary', 'reason', 'finding']);
const getOpenQuestionText = (item) => getText(item, ['question', 'text', 'description']);

// TX-2 — heuristic significance badge. Rendered only when the report carries
// a model-assigned rank; the label states its heuristic nature.
const SIGNIFICANCE_LABELS = {
  high: 'Visok značaj',
  medium: 'Srednji značaj',
  low: 'Nizak značaj',
};

function SignificanceBadge({ rank }) {
  if (!rank || !SIGNIFICANCE_LABELS[rank.significance]) return null;
  const text = rank.rank ? `${SIGNIFICANCE_LABELS[rank.significance]} (#${rank.rank})` : SIGNIFICANCE_LABELS[rank.significance];
  return (
    <span title={rank.reason || 'Heuristička ocjena značaja'} className="ml-2 inline-block rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">
      {text} · heuristika
    </span>
  );
}

// TU-1 — one severity-ranked risk surface instead of two parallel lists.
// Conflicts and open questions are the same thing at different confidence,
// so they share one ordering: judged-high first, then unjudged (unknown
// importance needs human eyes precisely because it is unknown), then medium,
// then low. Low-tier items sit behind an expander; nothing is ever filtered
// silently.
const KIND_LABELS = {
  arithmetic: 'Aritmetika',
  property: 'Aritmetika',
  lifecycle: 'Životni ciklus',
  verification: 'Provjera',
  model: 'Provjera',
};

const TIER_OF = { high: 0, medium: 2, low: 3 };

function itemTier(wrapped) {
  const significance = wrapped.item?.heuristicRank?.significance;
  if (typeof significance === 'string' && significance in TIER_OF) return TIER_OF[significance];
  return 1;
}

function kindLabel(item) {
  if (item && typeof item === 'object' && typeof item.kind === 'string' && KIND_LABELS[item.kind]) {
    return KIND_LABELS[item.kind];
  }
  return 'Opažanje';
}

function judgeNote(judge) {
  if (!judge || typeof judge !== 'object') return null;
  if (judge.verdict === 'same') return 'procjena: ista tražbina';
  if (judge.verdict === 'different') return 'procjena: različite tražbine';
  return null;
}

function rankRiskItems(conflicts, openQuestions) {
  const wrapped = [
    ...(Array.isArray(conflicts) ? conflicts : []).map((item, index) => ({ item, list: 'conflict', index, text: getConflictText(item) })),
    ...(Array.isArray(openQuestions) ? openQuestions : []).map((item, index) => ({ item, list: 'question', index, text: getOpenQuestionText(item) })),
  ];
  return wrapped.sort((a, b) => (
    itemTier(a) - itemTier(b)
    || (a.list === 'conflict' ? 0 : 1) - (b.list === 'conflict' ? 0 : 1)
    || a.index - b.index
  ));
}

export default function AnalysisRiskList({ conflicts, openQuestions, hasStructuredReport = false }) {
  const [showLow, setShowLow] = useState(false);
  const ranked = useMemo(() => rankRiskItems(conflicts, openQuestions), [conflicts, openQuestions]);
  const lowCount = useMemo(() => ranked.filter((wrapped) => itemTier(wrapped) === TIER_OF.low).length, [ranked]);
  const visible = useMemo(() => (showLow ? ranked : ranked.filter((wrapped) => itemTier(wrapped) !== TIER_OF.low)), [ranked, showLow]);

  if (ranked.length === 0) {
    if (!hasStructuredReport) return null;
    return (
      <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="risk-list">
        <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Rizici i otvorena pitanja</h2>
        <p className="text-sm text-[var(--text-muted)]">Nema utvrđenih rizika ni otvorenih pitanja.</p>
      </section>
    );
  }

  return (
    <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="risk-list">
      <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Rizici i otvorena pitanja</h2>
      <ul className="space-y-2">
        {visible.map((wrapped, position) => {
          const note = judgeNote(wrapped.item?.claimJudge);
          return (
            <li key={`risk-${wrapped.list}-${wrapped.index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span className="mb-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                {kindLabel(wrapped.item)}
              </span>
              <span className="block">{wrapped.text || '-'}{note ? <span className="text-amber-700"> · {note}</span> : null}</span>
              <SignificanceBadge rank={wrapped.item?.heuristicRank} />
            </li>
          );
        })}
      </ul>
      {lowCount > 0 && (
        <button
          type="button"
          onClick={() => setShowLow((prev) => !prev)}
          aria-expanded={showLow}
          className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
        >
          {showLow ? 'Sakrij manje značajne' : `Prikaži manje značajne (${lowCount})`}
        </button>
      )}
    </section>
  );
}
