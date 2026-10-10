import { render, screen } from '@testing-library/react';
import { normalizeEventDate, collapseStageRuns, duplicationSummary, groupMoneyEntries, moneyQualityCounts } from '../collapseRuns';

// The real chain from run 2084d894, after the registry fix: 49 stages, ~10 events.
const STAGE = (id, date, eventType, value, extra = {}) => ({
  id, date, eventType, value, currency: 'EUR', fileName: 'Podnesak.pdf', ...extra,
});

const CHAIN = [
  STAGE('s-0', '2019-05-03', 'prijava', 27888441.11, { transferee: 'Zagrebačka banka d.d.' }),
  // 15 records of one assignment, split across two date formats
  ...Array.from({ length: 8 }, (_, i) =>
    STAGE(`s-1-${i}`, '2019-09-27', 'ustup', 27888441.11, { transferor: 'Zagrebačka banka d.d.', transferee: 'DDM INVEST III AG' })),
  ...Array.from({ length: 7 }, (_, i) =>
    STAGE(`s-1b-${i}`, '27.09.2019.', 'ustup', 27888441.11, { transferor: 'Zagrebačka banka d.d.', transferee: 'DDM INVEST III AG' })),
  // amount changes here
  ...Array.from({ length: 12 }, (_, i) =>
    STAGE(`s-2-${i}`, '2021-07-27', 'ustup', 15522637.98, { transferor: 'DDM INVEST III AG', transferee: 'CO AST d.o.o.' })),
  STAGE('s-3', '2025-07-18', 'namirenje', null),
];

describe('normalizeEventDate', () => {
  test('folds the two date formats the sources use into one day', () => {
    expect(normalizeEventDate('2019-09-27')).toBe('2019-09-27');
    expect(normalizeEventDate('27.09.2019.')).toBe('2019-09-27');
    expect(normalizeEventDate('9.7.2025')).toBe('2025-07-09');
  });

  test('tolerates missing and junk input', () => {
    expect(normalizeEventDate(null)).toBe('');
    expect(normalizeEventDate('nedatum')).toBe('nedatum');
  });
});

describe('collapseStageRuns', () => {
  const groups = collapseStageRuns(CHAIN);

  test('collapses 28 stages into 4 events', () => {
    expect(CHAIN).toHaveLength(29);
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => g.recordCount)).toEqual([1, 15, 12, 1]);
  });

  // The whole point: collapsing must never lose a record.
  test('retains every original stage — collapsing is presentation only', () => {
    const kept = groups.reduce((sum, g) => sum + g.records.length, 0);
    expect(kept).toBe(CHAIN.length);
    const ids = new Set(groups.flatMap((g) => g.records.map((r) => r.id)));
    expect(ids.size).toBe(CHAIN.length);
  });

  // "×15 zapisa" must never be labelled "×15 transfers" — one transfer, fifteen
  // extractions.
  test('counts RECORDS, and says so', () => {
    expect(groups[1].recordCount).toBe(15);
    expect(groups[1].dateVariants.sort()).toEqual(['2019-09-27', '27.09.2019.']);
  });

  test('marks only the run where the amount actually moved', () => {
    expect(groups.map((g) => g.amountChanged)).toEqual([false, false, true, false]);
  });

  // A settlement row with no amount must not read as "amount dropped to zero".
  test('a null amount never counts as an amount change', () => {
    expect(groups[3].amountChanged).toBe(false);
  });

  // Party strings vary cosmetically inside one event and must not fragment it.
  test('party-name spelling variance does not fragment an event', () => {
    const noisy = [
      STAGE('p-1', '2025-07-09', 'ustup', 14759376.85, { transferor: 'CO AST d.o.o.', transferee: 'Zdenko Banić' }),
      STAGE('p-2', '2025-07-09', 'ustup', 14759376.85, { transferor: 'Coast d.o.o.', transferee: 'ZDENKO BANIĆ' }),
      STAGE('p-3', '09.07.2025.', 'ustup', 14759376.85, { transferor: 'COAST d.o.o.', transferee: 'Zdenko Banić' }),
    ];
    const g = collapseStageRuns(noisy);
    expect(g).toHaveLength(1);
    expect(g[0].recordCount).toBe(3);
  });

  // Same date and amount but a different event type is a different event.
  test('eventType separates otherwise identical rows', () => {
    const g = collapseStageRuns([
      STAGE('a', '2020-01-01', 'prijava', 100),
      STAGE('b', '2020-01-01', 'namirenje', 100),
    ]);
    expect(g).toHaveLength(2);
  });

  test('is non-consecutive: the same event later in the chain stays its own row', () => {
    const g = collapseStageRuns([
      STAGE('a', '2020-01-01', 'ustup', 100),
      STAGE('b', '2020-02-01', 'ustup', 50),
      STAGE('c', '2020-01-01', 'ustup', 100),
    ]);
    expect(g).toHaveLength(3);
  });

  test('tolerates empty, missing and malformed input', () => {
    expect(collapseStageRuns([])).toEqual([]);
    expect(collapseStageRuns(null)).toEqual([]);
    // null and {} are both "no data" and collapse into one row; that is
    // correct, not a lost record.
    const malformed = collapseStageRuns([null, {}, { date: 'x' }]);
    expect(malformed.reduce((n, g) => n + g.records.length, 0)).toBe(3);
  });
});

describe('duplicationSummary', () => {
  test('reports 49 records -> 10 events for the real chain shape', () => {
    const s = duplicationSummary(CHAIN);
    expect(s).toEqual({ totalRecords: 29, eventCount: 4, repeatedRecords: 25 });
  });

  test('returns null for an empty chain so no summary line renders', () => {
    expect(duplicationSummary([])).toBeNull();
    expect(duplicationSummary(null)).toBeNull();
  });
});

describe('groupMoneyEntries', () => {
  const entries = [
    { id: 1, direction: 'obveza', amountEur: 100 },
    { id: 2, direction: 'potraživanje', amountEur: 200 },
    { id: 3, direction: 'awarded', amountEur: 300 },
    { id: 4, direction: 'rejected', amountEur: 400 },
    { id: 5, direction: 'netted', amountEur: 50 },
  ];

  test('folds the three ruling outcomes into one court-decision group', () => {
    const groups = groupMoneyEntries(entries);
    expect(groups.map((g) => g.label)).toEqual(['Obveze', 'Potraživanja', 'Odluke suda']);
    expect(groups[2].entries).toHaveLength(3);
  });

  test('keeps every entry, and never totals across directions', () => {
    const groups = groupMoneyEntries(entries);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(entries.length);
  });

  test('drops empty groups and handles unknown directions', () => {
    expect(groupMoneyEntries([{ id: 1, direction: 'obveza' }])).toHaveLength(1);
    const odd = groupMoneyEntries([{ id: 1, direction: 'nešto' }]);
    expect(odd).toHaveLength(1);
    expect(odd[0].label).toBe('Bez smjera');
  });

  test('returns nothing for an empty ledger', () => {
    expect(groupMoneyEntries([])).toEqual([]);
    expect(groupMoneyEntries(null)).toEqual([]);
  });
});

describe('moneyQualityCounts', () => {
  test('counts ungrounded, converted and non-EUR rows', () => {
    expect(moneyQualityCounts([
      { grounded: false }, { grounded: false },
      { amountEurSource: 'converted' },
      { currency: 'HRK' }, { currency: 'HRK' }, { currency: 'EUR' },
    ])).toEqual({ ungrounded: 2, converted: 1, hrk: 2 });
  });

  test('tolerates missing input', () => {
    expect(moneyQualityCounts(null)).toEqual({ ungrounded: 0, converted: 0, hrk: 0 });
  });
});

describe('LifecycleTimeline — collapsing on the real chain shape', () => {
  test('a 49-record chain collapses and states the reduction', () => {
    // 49 records, the real run's shape: 15 + 12 + 15 repeats plus singles.
    const many = (n, date, type, value) =>
      Array.from({ length: n }, (_, i) => STAGE(`${date}-${i}`, date, type, value));
    const chain = [
      STAGE('a', '2019-05-03', 'prijava', 27888441.11),
      ...many(15, '2019-09-27', 'ustup', 27888441.11),
      ...many(12, '2021-07-27', 'ustup', 15522637.98),
      ...many(15, '2025-07-09', 'ustup', 14759376.85),
      ...many(6, '2025-07-18', 'namirenje', null),
    ];
    expect(chain).toHaveLength(49);

    const summary = duplicationSummary(chain);
    expect(summary).toEqual({ totalRecords: 49, eventCount: 5, repeatedRecords: 44 });
  });
});
