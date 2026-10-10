import { useMemo, useState } from 'react';
import { formatEur } from '../ui/format';

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

const SIGNIFICANCE_LABELS = {
  high: 'AI procjena · visok značaj',
  medium: 'AI procjena · srednji značaj',
  low: 'AI procjena · nizak značaj',
};

const KIND_LABELS = {
  arithmetic: 'Aritmetika',
  property: 'Imovina',
  lifecycle: 'Životni ciklus tražbine',
  verification: 'Provjera',
  model: 'Provjera',
};

const SOURCE_LABELS = {
  reconciliation: 'Determinističko usklađivanje',
  verification: 'AI provjera izvještaja',
  model: 'AI nalaz',
};

const TIER_OF = { high: 0, medium: 2, low: 3 };

/**
 * Severity is carried by ORDER and LABEL, not by colour.
 *
 * The §3.4 status palette has a 1.07:1 luminance ratio between success and
 * warning, so colour cannot separate the tiers. These three rails are
 * 17.76:1 / 7.56:1 / 4.83:1 — all clear of the 3:1 non-text threshold and
 * mutually distinct — but the label does the real work, and the ordering puts
 * what matters first. This replaces the old treatment where every item was an
 * amber-filled box, which made a high-severity conflict and a low-severity one
 * look identical.
 */
const TIER_RAIL = {
  high: 'border-l-2 border-ink',
  medium: 'border-l-2 border-ink-muted',
  low: 'border-l-2 border-line-control opacity-80',
  unjudged: 'border-l-2 border-line-control',
};

const TIER_LABEL = {
  high: SIGNIFICANCE_LABELS.high,
  medium: SIGNIFICANCE_LABELS.medium,
  low: SIGNIFICANCE_LABELS.low,
  unjudged: 'Bez procjene značaja',
};

function sourceLabel(item) {
  return SOURCE_LABELS[item?.source] || 'Izvor nije zabilježen';
}

function sourceIds(item) {
  return Array.isArray(item?.sources)
    ? [...new Set(item.sources.filter((id) => typeof id === 'string' && id))]
    : [];
}

function itemTier(item) {
  const significance = item?.heuristicRank?.significance;
  if (typeof significance === 'string' && significance in TIER_OF) return TIER_OF[significance];
  return 1;
}

function tierKey(item) {
  const significance = item?.heuristicRank?.significance;
  if (significance === 'high' || significance === 'medium' || significance === 'low') return significance;
  return 'unjudged';
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

/** `amounts` pairs appear on arithmetic conflicts; show both sides verbatim. */
function AmountChips({ item }) {
  const amounts = Array.isArray(item?.amounts) ? item.amounts : [];
  if (!amounts.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs tabular-nums">
      {amounts.map((entry, index) => (
        <span key={`amount-${index}`} className="rounded border border-line bg-surface px-2 py-1">
          {typeof entry?.value === 'number' && Number.isFinite(entry.value)
            ? (entry.currency === 'EUR'
              ? formatEur(entry.value)
              : `${entry.value.toLocaleString('hr-HR')} ${entry.currency ?? ''}`.trim())
            : '—'}
        </span>
      ))}
    </div>
  );
}

function rankRiskItems(conflicts, openQuestions) {
  const wrapped = [
    ...(Array.isArray(conflicts) ? conflicts : []).map((item, index) => ({ item, list: 'conflict', index, text: getConflictText(item) })),
    ...(Array.isArray(openQuestions) ? openQuestions : []).map((item, index) => ({ item, list: 'question', index, text: getOpenQuestionText(item) })),
  ];
  // judged-high, then unjudged (unknown importance needs eyes precisely because
  // it is unknown), then medium, then low.
  return wrapped.sort((a, b) => (
    itemTier(a.item) - itemTier(b.item)
    || (a.list === 'conflict' ? 0 : 1) - (b.list === 'conflict' ? 0 : 1)
    || a.index - b.index
  ));
}

export default function AnalysisRiskList({ conflicts, openQuestions, sourceDocuments = [], hasStructuredReport = false }) {
  const [showLow, setShowLow] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const ranked = useMemo(() => rankRiskItems(conflicts, openQuestions), [conflicts, openQuestions]);
  const sourceDocumentsById = useMemo(
    () => new Map((Array.isArray(sourceDocuments) ? sourceDocuments : []).map((document) => [document.id, document])),
    [sourceDocuments],
  );
  const lowCount = useMemo(() => ranked.filter((wrapped) => itemTier(wrapped.item) === TIER_OF.low).length, [ranked]);
  const eligible = useMemo(() => (showLow ? ranked : ranked.filter((wrapped) => itemTier(wrapped.item) !== TIER_OF.low)), [ranked, showLow]);
  const visible = eligible.slice(0, visibleCount);
  const remaining = eligible.length - visible.length;
  const nextCount = Math.min(10, remaining);
  const nextUnit = nextCount % 10 === 1 && nextCount % 100 !== 11
    ? 'stavku'
    : nextCount % 10 >= 2 && nextCount % 10 <= 4 && (nextCount % 100 < 12 || nextCount % 100 > 14)
      ? 'stavke'
      : 'stavki';

  if (ranked.length === 0) {
    if (!hasStructuredReport) return null;
    return (
      <section id="analysis-risks" className="card p-5 scroll-mt-20" aria-labelledby="risk-heading" data-testid="risk-list">
        <h2 id="risk-heading" className="sec-title">Konflikti i pitanja</h2>
        <p className="mt-1 text-sm text-ink-muted">Nema utvrđenih konflikata ni otvorenih pitanja.</p>
      </section>
    );
  }

  return (
    <section id="analysis-risks" className="card p-5 scroll-mt-20" aria-labelledby="risk-heading" data-testid="risk-list">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 id="risk-heading" className="sec-title">Konflikti i pitanja</h2>
          <p className="mt-1 text-xs text-ink-muted">
            AI procjena, kada postoji, grupira stavke po značaju; ne potvrđuje njihovu istinitost.
          </p>
        </div>
        <span className="text-sm text-ink-muted">
          {ranked.length} {ranked.length === 1 ? 'stavka' : 'stavki'} · {ranked.some((wrapped) => tierKey(wrapped.item) !== 'unjudged') ? 'grupirano po procjeni značaja' : 'redoslijed izvještaja'}
        </span>
      </div>

      <ol className="mt-4 space-y-2">
        {visible.map((wrapped) => {
          const note = judgeNote(wrapped.item?.claimJudge);
          const tier = tierKey(wrapped.item);
          const rank = wrapped.item?.heuristicRank;
          const ids = sourceIds(wrapped.item);
          const documents = ids.map((id) => sourceDocumentsById.get(id)).filter(Boolean);
          return (
            <li
              key={`risk-${wrapped.list}-${wrapped.index}`}
              className={`rounded-md bg-surface-muted p-3 ${TIER_RAIL[tier]}`}
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="eyebrow">
                  {TIER_LABEL[tier]}
                  {rank?.rank ? ` (#${rank.rank})` : ''}
                </span>
                <span className="text-xs text-ink-muted">{kindLabel(wrapped.item)}</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">
                {wrapped.text || '—'}
                {note ? <span className="text-ink-muted"> · {note}</span> : null}
              </p>
              <AmountChips item={wrapped.item} />
              <div className="mt-2 text-xs text-ink-muted">
                <p><span className="font-medium text-ink">Porijeklo u izvještaju:</span> {sourceLabel(wrapped.item)}</p>
                {ids.length === 0 ? (
                  <p className="mt-1">Poveznica na izvorni dokument nije spremljena uz ovu stavku.</p>
                ) : documents.length > 0 ? (
                  <div className="mt-1">
                    <span className="font-medium text-ink">Izvorni dokumenti:</span>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {documents.map((document) => (
                        <li key={document.id}>
                          {document.url ? (
                            <a href={document.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                              {document.fileName}
                            </a>
                          ) : document.fileName}
                        </li>
                      ))}
                    </ul>
                    {documents.length < ids.length ? (
                      <p>{ids.length - documents.length} referenca izvora nije dostupna u ovom paketu.</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1">Referenca izvora nije dostupna u ovom paketu dokaza.</p>
                )}
              </div>
              {rank?.reason ? (
                <p className="mt-1.5 text-xs text-ink-muted">Razlog AI procjene značaja: {rank.reason}</p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + nextCount)}
          className="mt-3 rounded-md border border-line-control px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted"
        >
          Prikaži još {nextCount} {nextUnit}
        </button>
      ) : null}

      {lowCount > 0 && (
        <button
          type="button"
          onClick={() => setShowLow((prev) => !prev)}
          aria-expanded={showLow}
          className="mt-3 rounded-md border border-line-control px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted"
        >
          {showLow ? 'Sakrij manje značajne' : `Prikaži manje značajne (${lowCount})`}
        </button>
      )}
    </section>
  );
}