// Run-list summary projection.
//
// The dashboard list is per-run. To answer "which case is this / can I trust it
// / how recent / how big" at a glance, the list needs four small facts that
// currently live inside the run's `result_json` (identity, coverage, money).
// Shipping `result_json` in the list response cost ~120KB per run and ~2.75MB
// for a 10-row page, so instead we project these once, at completion.
//
// Design constraints:
// - PURE. No I/O, no clock, no store access — trivially unit-testable.
// - NEVER THROWS. A projection runs inside run completion, so a crash here
//   would fail an otherwise-finished analysis. Every field degrades to null.
//   ("Never fail a run" is load-bearing project-wide, not per-call-site.)
// - NO CURRENCY ARITHMETIC. This module never sums or converts. It only reads
//   the EUR-consolidated `amountEur` that the backend already produced, because
//   summing raw mixed-currency values caused a real production bug once
//   (billion-scale nonsense totals). See AGENTS.md, "Currency conversion is a
//   fixed-rate deterministic computation, never a model-guessed one."
//
// It deliberately does NOT emit a matter-level money total. moneyFlow mixes
// potraživanja, obveze, namirenja and rejected claims; summing those is not
// "iznos u sporu". A real stored run sums 273 entries across five directions to
// 1.68 billion EUR — arithmetically valid, completely meaningless. We report
// the flow's SHAPE and leave the definition of "amount in dispute" to an
// explicit product decision over real figures.

const CLAIM_DIRECTIONS = new Set(['potraživanje', 'awarded']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function firstString(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
}

function stringList(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
        : [];
}

/** The cluster the reasoning pass actually selected, else the first one. */
function selectCluster(resultJson) {
    const cases = Array.isArray(resultJson?.processedCases) ? resultJson.processedCases : [];
    if (!cases.length) return null;
    return cases.find((entry) => entry?.groupMetadata?.selectedForReasoning) || cases[0] || null;
}

function readPackage(resultJson) {
    return (resultJson?.clusterEvidencePackage && typeof resultJson.clusterEvidencePackage === 'object')
        ? resultJson.clusterEvidencePackage
        : null;
}

function deriveIdentity(resultJson, run) {
    const pkg = readPackage(resultJson);
    const cluster = selectCluster(resultJson);
    const caseResult = cluster?.caseResult || null;
    const groupMetadata = cluster?.groupMetadata || null;

    // Package identity is the richest source; legacy runs only have caseResult.
    const fromPackage = stringList(pkg?.identity?.participantNames);
    const legacyParticipants = Array.isArray(caseResult?.participants) ? caseResult.participants : [];
    const participantNames = fromPackage.length
        ? fromPackage
        : legacyParticipants.map((p) => p?.name).filter((n) => typeof n === 'string' && n.trim());

    const oibsFromPackage = stringList(pkg?.identity?.participantOibs);
    const participantOibs = oibsFromPackage.length
        ? oibsFromPackage
        : legacyParticipants.map((p) => p?.oib).filter((o) => typeof o === 'string' && o.trim());

    // Only fall back to query_value when it genuinely is a case number —
    // an OIB must never be presented as one.
    const queryCaseNumber = run?.query_type === 'case_number' ? run.query_value : null;

    return {
        caseNumber: firstString(
            pkg?.primaryCaseNumber,
            groupMetadata?.primaryCaseNumber,
            caseResult?.caseNumber,
            queryCaseNumber,
        ),
        court: firstString(caseResult?.court),
        participantNames,
        participantOibs,
    };
}

function deriveCoverage(resultJson) {
    const pkg = readPackage(resultJson);
    const cluster = selectCluster(resultJson);
    // Priority: package coverage (evidence-package level) → report meta →
    // per-cluster analysis coverage (older shape).
    const source = (pkg && pkg.coverage && typeof pkg.coverage === 'object') ? pkg.coverage
        : (resultJson?.report?.meta?.coverage && typeof resultJson.report.meta.coverage === 'object') ? resultJson.report.meta.coverage
            : (cluster?.analysis?.coverage && typeof cluster.analysis.coverage === 'object') ? cluster.analysis.coverage
                : null;
    if (!source) return null;

    const num = (value) => (isFiniteNumber(value) ? value : null);
    const coverage = {
        analyzed: num(source.analyzed),
        total: num(source.total),
        failed: num(source.failed),
        coverageRatio: num(source.coverageRatio),
        groundedClaims: num(source.groundedClaims),
        totalClaims: num(source.totalClaims),
    };
    // A projection of nothing is a projection of nothing.
    const hasAny = Object.values(coverage).some((v) => v !== null);
    return hasAny ? coverage : null;
}

function readMoneyFlow(resultJson) {
    const pkg = readPackage(resultJson);
    if (pkg && pkg.moneyFlow && typeof pkg.moneyFlow === 'object') return pkg.moneyFlow;
    const fromMeta = resultJson?.report?.meta?.moneyFlow;
    return fromMeta && typeof fromMeta === 'object' ? fromMeta : null;
}

function deriveAmounts(resultJson) {
    const moneyFlow = readMoneyFlow(resultJson);
    if (!moneyFlow) return null;
    const entries = Array.isArray(moneyFlow.entries) ? moneyFlow.entries : [];
    if (!entries.length && !isFiniteNumber(moneyFlow.eurTotal)) return null;

    // Resolve each entry's EUR figure.
    //
    // Preferred: `amountEur`, the backend's EUR-consolidated field. That is the
    // only field arithmetic is ever allowed to run on.
    //
    // Fallback: `amount` ONLY when the source currency is already EUR. An
    // EUR-stated amount needs no conversion and no arithmetic, so it is safe to
    // read directly. This is not laxness — it is what `amountEurSource:'as-is'`
    // means. (The frozen Lab fixture is exactly this shape: amount + EUR, no
    // amountEur.)
    //
    // A non-EUR `amount` is NEVER read. Converting or summing it here is the
    // billion-scale bug AGENTS.md warns about; conversion belongs in
    // currencyConversion.js, at a fixed legal rate.
    const eurFigureOf = (entry) => {
        if (isFiniteNumber(entry?.amountEur)) {
            return {
                amountEur: entry.amountEur,
                source: (typeof entry.amount === 'number' || typeof entry.amount === 'string') && entry.currency !== 'EUR'
                    ? { amount: entry.amount, currency: entry.currency ?? null }
                    : null,
            };
        }
        if (entry?.currency === 'EUR' && isFiniteNumber(entry?.amount)) {
            return { amountEur: entry.amount, source: null };
        }
        return null;
    };

    const eurEntries = entries
        .map((entry) => {
            const figure = eurFigureOf(entry);
            if (!figure) return null;
            return {
                amountEur: figure.amountEur,
                source: figure.source,
                direction: typeof entry.direction === 'string' ? entry.direction : null,
                dualCurrencyMismatch: entry?.currencyNote === 'dual-mismatch'
                    || (isFiniteNumber(entry?.dualCurrency?.deviationPct)
                        && Math.abs(entry.dualCurrency.deviationPct) > 0.01),
            };
        })
        .filter(Boolean);

    const claims = eurEntries.filter((e) => e.direction && CLAIM_DIRECTIONS.has(e.direction));
    const largest = claims.reduce(
        (best, entry) => (best === null || entry.amountEur > best.amountEur ? entry : best),
        null,
    );

    // A single moneyFlow normally mixes obveze, potraživanja, namirenja AND
    // rejected claims. Summing those is not "iznos u sporu" — a rejected claim
    // is not money anyone is owed, and a namirenje is a payment of a claim
    // already counted. A real run (2084d894) sums 273 entries across five
    // directions to 1,685,587,973.69 EUR, which is arithmetically valid and
    // completely meaningless.
    //
    // So we do NOT emit a headline total unless every entry points the same way.
    // A mixed flow reports its shape and nothing else, and the UI shows a
    // neutral marker instead of a number. Defining "iznos u sporu" properly is
    // a product decision over real data, not something to invent in a summary.
    const directionsPresent = [...new Set(eurEntries.map((e) => e.direction).filter(Boolean))];
    const singleDirection = directionsPresent.length === 1 ? directionsPresent[0] : null;

    return {
        entryCount: entries.length,
        directionsPresent,
        singleDirection,
        // Only meaningful when the flow is single-direction; still exposed so a
        // caller can see what the backend computed, with `mixedDirections` as
        // the caveat that makes it unsafe to present.
        eurTotal: isFiniteNumber(moneyFlow.eurTotal) ? moneyFlow.eurTotal : null,
        mixedDirections: singleDirection === null && directionsPresent.length > 1,
        // Largest single directional claim, for callers that want an individual
        // figure rather than a matter-level total.
        largestClaimEur: largest ? largest.amountEur : null,
        largestClaimSource: largest ? largest.source : null,
        dualCurrencyMismatch: eurEntries.some((e) => e.dualCurrencyMismatch),
    };
}

/**
 * Project the listable facts out of a completed run.
 *
 * @param {object}  options
 * @param {object}  options.run        the run record (query_type/query_value)
 * @param {object?} options.resultJson the run's parsed result, if any
 * @returns {{
 *   caseNumber: string|null,
 *   court: string|null,
 *   participantNames: string[],
 *   participantOibs: string[],
 *   queryType: string|null,
 *   queryValue: string|null,
 *   coverage: object|null,
 *   amounts: object|null,
 * }} never throws; every field degrades to null / []
 */
function buildRunSummary({ run, resultJson } = {}) {
    try {
        const safeRun = (run && typeof run === 'object') ? run : {};
        const safeResult = (resultJson && typeof resultJson === 'object') ? resultJson : null;

        const identity = deriveIdentity(safeResult, safeRun);

        return {
            caseNumber: identity.caseNumber,
            court: identity.court,
            participantNames: identity.participantNames,
            participantOibs: identity.participantOibs,
            queryType: typeof safeRun.query_type === 'string' ? safeRun.query_type : null,
            queryValue: typeof safeRun.query_value === 'string' ? safeRun.query_value : null,
            coverage: deriveCoverage(safeResult),
            amounts: deriveAmounts(safeResult),
        };
    } catch {
        // Belt and braces: the callers are inside run completion, and a
        // finished analysis must never be failed by its own summary.
        return {
            caseNumber: null,
            court: null,
            participantNames: [],
            participantOibs: [],
            queryType: null,
            queryValue: null,
            coverage: null,
            amounts: null,
        };
    }
}

/** The list-row projection: run identity + summary, without the heavy payload. */
function toRunListItem(run) {
    if (!run || typeof run !== 'object') return null;
    const { result_text: _text, result_json: _json, ...rest } = run;
    return { ...rest, summary: run.summary ?? buildRunSummary({ run, resultJson: run.result_json }) };
}

module.exports = {
    buildRunSummary,
    toRunListItem,
    CLAIM_DIRECTIONS,
};
