/**
 * Collapse consecutive value-change stages into events, WITHOUT losing records.
 *
 * WHY. A `valueChanges[].stages[]` array is one row per *extracted record*, not
 * per legal event. On the real run `2084d894`, one chain of 49 stages holds
 * roughly 10 real events — the 2019-09-27 assignment of
 * Zagrebačka banka → DDM INVEST III AG appears 15 times, 11 of those extracted
 * from a single PDF (`Podnesak.pdf` produced 57 of the run's 99 entries). A
 * single document cannot contain fifteen assignments of one claim on one date,
 * so these are extraction duplication, not fifteen transfers.
 *
 * RENDERING THEM AT FULL SIZE asserts fifteen transfers occurred. That is a
 * material misstatement in a bankruptcy record, and it is the reason this module
 * exists.
 *
 * WHAT IT DOES NOT DO. It never drops, merges or re-aggregates a stage. Each
 * group keeps every original stage in `records`, so expanding a row reveals the
 * exact rows the pipeline produced, and `totalRecords` reports the true count.
 * Collapsing is presentation only.
 *
 * GROUPING KEY — date + amount + eventType, matched over CONSECUTIVE stages.
 *
 * Parties are deliberately excluded: within one repeated event the extracted
 * party strings vary cosmetically ("CO AST d.o.o." / "Coast d.o.o." / "COAST
 * d.o.o.", and "Zdenko Banić" at three verbosity levels), which would fragment
 * one event into many rows. Date is normalised because the same day arrives
 * both as ISO ("2019-09-27") and Croatian ("27.09.2019.").
 *
 * Including parties would be wrong here; excluding them from *identity* matching
 * elsewhere would not be. This is a display grouping, not a reconciliation.
 */

/** ISO date-only → "YYYY-MM-DD"; "27.09.2019." → "2019-09-27"; else trimmed. */
export function normalizeEventDate(raw) {
  if (raw == null) return '';
  const value = String(raw).trim();
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const cro = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (cro) return `${cro[3]}-${cro[2].padStart(2, '0')}-${cro[1].padStart(2, '0')}`;
  return value;
}

const keyOf = (stage) =>
  [normalizeEventDate(stage?.date), stage?.value ?? '', stage?.eventType ?? ''].join('|');

/**
 * @param {object[]} stages raw `valueChanges[].stages`
 * @returns {Array<{key:string, stage:object, records:object[], recordCount:number,
 *                  dateVariants:string[], partyVariants:number,
 *                  amountChanged:boolean}>}
 */
export function collapseStageRuns(stages) {
  const list = Array.isArray(stages) ? stages : [];
  const groups = [];

  list.forEach((stage) => {
    const key = keyOf(stage);
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.records.push(stage);
      // Accumulate the variance INSIDE the run too. Seeding these only at group
      // creation made every run report exactly one date and one party spelling,
      // which is precisely the information the row needs in order to disclose
      // that the same event was extracted several ways.
      current.dateVariants.add(stage?.date);
      current.partyVariants.add(`${stage?.transferor ?? ''}|${stage?.transferee ?? ''}`);
      return;
    }
    groups.push({
      key,
      stage,
      records: [stage],
      dateVariants: new Set([stage?.date]),
      partyVariants: new Set([`${stage?.transferor ?? ''}|${stage?.transferee ?? ''}`]),
    });
  });

  return groups.map((group, index) => {
    const previous = groups[index - 1];
    const value = group.stage?.value;
    const previousValue = previous?.stage?.value;
    group.dateVariants = [...group.dateVariants];
    group.partyVariants = group.partyVariants.size;
    return {
      ...group,
      recordCount: group.records.length,
      // Whether there was an earlier event to compare this amount against. The
      // "amount did not change" note needs this; it is NOT the same question as
      // amountChanged, which is false both when nothing changed and when there
      // was simply nothing before it.
      comparedToPrevious: index > 0,
      // "no amount recorded" must not read as "amount changed to nothing"
      amountChanged: index > 0 && value != null && previousValue != null && value !== previousValue,
    };
  });
}

/**
 * Section-level duplication summary for the "49 zapisa → 10 događaja" line.
 * @returns {{totalRecords:number, eventCount:number, repeatedRecords:number}|null}
 */
export function duplicationSummary(stages) {
  const list = Array.isArray(stages) ? stages : [];
  if (list.length === 0) return null;
  const groups = collapseStageRuns(list);
  const eventCount = groups.length;
  return {
    totalRecords: list.length,
    eventCount,
    repeatedRecords: list.length - eventCount,
  };
}

/**
 * Money-flow rows grouped for a ledger. Grouping is by `direction` because it is
 * the only identity field populated on effectively every row (272 of 273 on the
 * real run) and because the observed spread is what makes the section an
 * assertion ledger rather than a flow: 225 of 273 rows are obligations or ruling
 * outcomes, not payments.
 *
 * Ruling outcomes are folded into one "odluke suda" group, since
 * awarded/rejected/netted are three faces of one thing — a court's decision —
 * and splitting them triples the group count without adding meaning.
 */
const DIRECTION_GROUPS = [
  { key: 'obveza', label: 'Obveze', directions: ['obveza'] },
  { key: 'potrazivanje', label: 'Potraživanja', directions: ['potraživanje'] },
  { key: 'odluka', label: 'Odluke suda', directions: ['awarded', 'rejected', 'netted'] },
];

export function groupMoneyEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const groups = DIRECTION_GROUPS.map((group) => ({
    ...group,
    entries: list.filter((entry) => group.directions.includes(entry?.direction)),
  }));
  const claimed = new Set(DIRECTION_GROUPS.flatMap((g) => g.directions));
  const other = list.filter((entry) => !claimed.has(entry?.direction));
  if (other.length > 0) {
    groups.push({ key: 'ostalo', label: 'Bez smjera', directions: [], entries: other });
  }
  return groups.filter((group) => group.entries.length > 0);
}

/** Rows whose extraction was not confirmed in the source document. */
export function moneyQualityCounts(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    ungrounded: list.filter((entry) => entry?.grounded === false).length,
    converted: list.filter((entry) => entry?.amountEurSource === 'converted').length,
    hrk: list.filter((entry) => entry?.currency && entry.currency !== 'EUR').length,
  };
}