// backend/court-analysis/reasoning/moneyFlow.js
//
// Track 3c — money-flow reconstruction. Analyses that contain financial
// figures produce a structured `amounts` array (extracted by the analysis
// agent). This module normalizes those raw amounts into a deterministic,
// source-cited money-flow surface so the report meta and the "Tijek novca"
// visualizer subgraph can render real payments/claims instead of relying on
// free-text prose alone.

const {
    normalizeCurrency,
    parseAmount,
    parseDualFromQuote,
    normalizeDirection,
    normalizeOib,
    cleanText,
} = require('./flow');

// Local helper definitions moved to flow.js (flow-consolidation PR1);
// imported above and re-exported below.

/**
 * Legacy entry point (flow-consolidation PR2): thin wrapper over the unified
 * collector + money derived view. Output is byte-identical to the old
 * implementation for the same input (verified by the eval-fixture diff).
 * @param {Array<object>} analyses
 * @returns {{count: number, entries: Array<object>, currencyTotals: object, hasMoneyFlow: boolean}}
 */
function collectMoneyFlows(analyses) {
    const { collectFlows, deriveMoneyFlowView } = require('./flow');
    return deriveMoneyFlowView(collectFlows(analyses));
}

module.exports = {
    collectMoneyFlows,
    normalizeCurrency,
    parseAmount,
    parseDualFromQuote,
    normalizeDirection,
    normalizeOib,
    cleanText
};