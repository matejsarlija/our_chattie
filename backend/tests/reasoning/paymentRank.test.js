const { normalizePaymentRank } = require('../../court-analysis/reasoning/paymentRank');

// Every raw value observed on run 2084d894, with its true count.
const OBSERVED = [
  ['drugi viši isplatni red', 35],
  ['II. viši isplatni red', 35],
  ['II. višeg isplatnog reda', 8],
  ['prvi viši isplatni red', 6],
  ['Drugi viši isplatni red', 5],
  ['I viši isplatni red', 4],
  ['drugog višeg isplatnog reda', 2],
  ['drugoga višeg isplatnog reda', 2],
  ['nižih isplatnih redova', 2],
  ['Prvi viši isplatni red', 1],
  ['II viši isplatni red', 1],
  ['prvog isplatnog reda', 1],
  ['Drugog višeg isplatnog reda', 1],
];

describe('normalizePaymentRank', () => {
  test('collapses all 13 observed surface forms to their true rank', () => {
    const groups = new Map();
    for (const [raw, n] of OBSERVED) {
      const r = normalizePaymentRank(raw);
      if (!r.key) continue; // collective, deliberately ungrouped
      groups.set(r.key, (groups.get(r.key) || 0) + n);
    }

    // 13 forms + a collective -> 2 concrete ranks.
    expect([...groups.keys()].sort()).toEqual(['isplatni-red-1', 'isplatni-red-2']);
    // 103 observed rows total; the 2 "nižih isplatnih redova" rows stay
    // ungrouped, so 101 collapse into the 2 concrete ranks.
    const total = OBSERVED.reduce((sum, [, n]) => sum + n, 0);
    expect(total).toBe(103);
    expect([...groups.values()].reduce((a, b) => a + b, 0)).toBe(total - 2);
  });

  test('Roman numeral and Croatian word for the same rank share a key', () => {
    expect(normalizePaymentRank('II. viši isplatni red').key)
      .toBe(normalizePaymentRank('drugi viši isplatni red').key);
    expect(normalizePaymentRank('I viši isplatni red').key)
      .toBe(normalizePaymentRank('prvi viši isplatni red').key);
  });

  test('case, inflected forms and a missing dot after the numeral all reconcile', () => {
    const key = 'isplatni-red-2';
    ['II. viši isplatni red', 'II viši isplatni red', 'drugi viši isplatni red',
     'Drugi viši isplatni red', 'II. višeg isplatnog reda', 'drugog višeg isplatnog reda',
     'drugoga višeg isplatnog reda', 'Drugog višeg isplatnog reda'].forEach((raw) => {
      expect(normalizePaymentRank(raw).key).toBe(key);
    });
  });

  // Conflating creditor classes is a material legal error (AGENTS.md). A
  // collective reference names no single rank and must stay ungrouped.
  test('leaves a collective reference ungrouped rather than forcing a rank', () => {
    const r = normalizePaymentRank('nižih isplatnih redova');
    expect(r.key).toBeNull();
    expect(r.rank).toBeNull();
    expect(r.collective).toBe(true);
    expect(r.raw).toBe('nižih isplatnih redova');
  });

  test('requires the isplatni-red term, so a bare ordinal is not swept in', () => {
    expect(normalizePaymentRank('prvi').key).toBeNull();
    expect(normalizePaymentRank('prva faza').key).toBeNull();
    expect(normalizePaymentRank('II. viši stupanj').key).toBeNull();
  });

  // "prvog isplatnog reda" omits "viši". Probable abbreviation, not provable —
  // so it is flagged rather than asserted silently.
  test('flags the abbreviated form that omits "viši" as inferred', () => {
    const r = normalizePaymentRank('prvog isplatnog reda');
    expect(r.rank).toBe(1);
    expect(r.inferred).toBe(true);
    expect(normalizePaymentRank('prvi viši isplatni red').inferred).toBe(false);
  });

  test('always preserves the raw value — normalisation is for grouping only', () => {
    expect(normalizePaymentRank('  Drugoga višeg isplatnog reda ').raw)
      .toBe('Drugoga višeg isplatnog reda');
  });

  test('tolerates missing and non-string input', () => {
    for (const bad of [undefined, null, '', '   ', 42, {}]) {
      const r = normalizePaymentRank(bad);
      expect(r.key).toBeNull();
      expect(r.rank).toBeNull();
    }
  });

  test('produces a stable canonical Croatian label per rank', () => {
    expect(normalizePaymentRank('drugi viši isplatni red').label).toBe('II. viši isplatni red');
    expect(normalizePaymentRank('prvi viši isplatni red').label).toBe('I. viši isplatni red');
  });
});