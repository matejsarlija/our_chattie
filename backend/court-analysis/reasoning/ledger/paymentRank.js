// backend/court-analysis/reasoning/paymentRank.js
//
// J-08 — payment-priority rank ("isplatni red") normalisation, for GROUPING.
//
// The raw field arrives from the extraction with 13 distinct surface forms for
// what the sources plainly mean as ~3 ranks. Measured on run 2084d894:
//
//   35  "drugi viši isplatni red"        35  "II. viši isplatni red"
//    8  "II. višeg isplatnog reda"         6  "prvi viši isplatni red"
//    5  "Drugi viši isplatni red"          4  "I viši isplatni red"
//    2  "drugog višeg isplatnog reda"      2  "drugoga višeg isplatnog reda"
//    2  "nižih isplatnih redova"           1  "Prvi viši isplatni red"
//    1  "II viši isplatni red"             1  "prvog isplatnog reda"
//    1  "Drugog višeg isplatnog reda"
//
// The variation is three independent things stacked: the ordinal is written as
// a Roman numeral or a Croatian word, it is capitalised inconsistently, and it
// is inflected (nominative "drugi ... red" vs genitive "drugoga ... reda").
//
// SCOPE — READ THIS BEFORE USING THE OUTPUT.
//
// `normalizePaymentRank` returns a GROUPING KEY. It does not rewrite, correct or
// canonicalise the legal value. The raw string is always preserved and is what
// any legal-facing surface must display. Per AGENTS.md ("Identifiers that look
// similar are not always the same identity"), conflating creditor classes is a
// material error, so:
//
//   * Values that do not unambiguously name a single ordinal rank return
//     `rank: null` and are left UNGROUPED rather than being forced into a class.
//     "nižih isplatnih redova" ("of the lower ranks") is a collective reference,
//     not a rank, and must not become "rank 1".
//   * A rank label is only produced when the ordinal AND the "isplatni red"
//     family term are both present, so a bare "prvi" or an unrelated ordinal
//     cannot be swept in.
//   * "prvog isplatnog reda" omits "viši". Whether that is an abbreviation of
//     "I. viši isplatni red" or a distinct concept is NOT decidable from saved
//     data alone. It is treated as rank 1 but flagged `inferred: true` so a
//     consumer can distinguish a confirmed match from an inferred one.

// Keys are ACCENT-FOLDED ("treći" -> "treci"), because the lookup below folds
// the input the same way before matching. Keeping the two in different
// normalisations is what previously made "treće" silently fail to match.
const ORDINAL_WORDS = {
  prvi: 1, prva: 1, prvo: 1, prvog: 1, prvoj: 1, prvom: 1, prvih: 1, prvima: 1,
  drugi: 2, druga: 2, drugo: 2, drugog: 2, drugoga: 2, drugom: 2, drugoj: 2,
  drugih: 2, drugima: 2, drugih_: 2,
  treci: 3, treca: 3, trece: 3, treceg: 3, trecem: 3, trece_: 3, trecih: 3,
  cetvrti: 4, cetvrta: 4, cetvrto: 4, cetvrtog: 4, cetvrtoga: 4, cetvrtom: 4,
  peti: 5, peta: 5, petog: 5,
};

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

// Every ordinal surface form, accent-folded, for one alternation.
const ORDINAL_RE = new RegExp(
  `^\\s*(?:(${Object.keys(ORDINAL_WORDS).join('|')})|(${Object.keys(ROMAN).join('|')}))\\b\\.?\\s`,
);

// "isplatni red" family — the term that makes the ordinal a payment rank.
const RANK_TERM_RE = /isplatn/i;
// A collective reference to several ranks at once. Never a single rank.
const COLLECTIVE_RE = /\bniž\w*|\bsvi\b|\bostali\b/i;

/**
 * @param {string} value raw `isplatniRed`
 * @returns {{key: string|null, rank: number|null, label: string|null,
 *            inferred: boolean, collective: boolean, raw: string}}
 *   `key` is a stable grouping key ("isplatni-red-2") or null when the value
 *   does not unambiguously name one rank. `raw` is always the input, trimmed.
 */
function normalizePaymentRank(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const none = { key: null, rank: null, label: null, inferred: false, collective: false, raw };
  if (!raw) return none;

  // A collective reference ("of the lower ranks", "all ranks") names no single
  // rank. Leave it ungrouped rather than inventing one.
  if (COLLECTIVE_RE.test(raw)) return { ...none, collective: true };

  // Must actually be a payment-rank term.
  if (!RANK_TERM_RE.test(raw)) return none;

  // Collapse accents so "treći"/"treci" and "četvrti"/"cetvrti" both match.
  const folded = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Ordinal: a leading Roman numeral ("II. viši ...", "I viši ...") or a
  // leading Croatian ordinal word ("drugi viši ...", "drugoga višeg ...").
  let rank = null;
  let inferred = false;

  const m = folded.match(ORDINAL_RE);
  if (!m) return none;
  const token = m[1] || m[2];
  rank = m[1] ? ORDINAL_WORDS[token] : ROMAN[token];
  if (!Number.isFinite(rank)) return none;

  // "prvog isplatnog reda" omits "viši" — the Croatian standard term is
  // "I. viši isplatni red", so this is probably an abbreviation, but it is not
  // provable from saved data. Flag it rather than asserting it silently.
  inferred = !/vis/i.test(folded);

  if (rank === null) return none;

  // "prvog isplatnog reda" omits "viši" — the Croatian standard term is
  // "I. viši isplatni red", so this is probably an abbreviation, but it is not
  // provable from saved data. Flag it rather than asserting it silently.
  inferred = !/\bvis/i.test(folded) && !/\bvis/i.test(raw);

  const romanLabel = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' }[rank];
  return {
    key: `isplatni-red-${rank}`,
    rank,
    label: `${romanLabel}. viši isplatni red`,
    inferred,
    collective: false,
    raw,
  };
}

module.exports = { normalizePaymentRank };