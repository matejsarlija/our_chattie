'use strict';

const metricsLib = require('../scripts/lib/metrics');
const groundingMetrics = require('../scripts/lib/grounding-metrics');
const grounding = require('../court-analysis/reasoning/ledger/grounding');
const runScorecard = require('../court-analysis/reasoning/ledger/runScorecard');
const extractionSchema = require('../court-analysis/reasoning/schema/extractionSchema');

/**
 * Score a candidate extraction output against frozen source text using the
 * shared production grounding + schema validation kernel (reference-free).
 */
function scoreReferenceFreeExtraction({ aiResult, sourceText = '' } = {}) {
    const validated = extractionSchema.validateExtraction(aiResult || {});
    const groundedResult = grounding.applyGroundingToAnalysis(validated.value || aiResult || {}, sourceText);
    const amounts = Array.isArray(groundedResult?.amounts) ? groundedResult.amounts : [];
    const flows = Array.isArray(groundedResult?.propertyFlow) ? groundedResult.propertyFlow : [];
    const parties = Array.isArray(groundedResult?.documentParties) ? groundedResult.documentParties : [];
    const events = Array.isArray(groundedResult?.proceduralEvents) ? groundedResult.proceduralEvents : [];
    const allClaims = [...amounts, ...flows, ...parties, ...events];
    const groundedClaims = allClaims.filter((item) => item?.grounded === true).length;
    const totalClaims = allClaims.length;
    return {
        validSchema: Boolean(validated?.valid),
        groundedClaims,
        totalClaims,
        groundingRate: totalClaims > 0 ? Number((groundedClaims / totalClaims).toFixed(4)) : 1,
        counts: {
            amounts: amounts.length,
            propertyFlow: flows.length,
            documentParties: parties.length,
            proceduralEvents: events.length,
        },
        gaps: Array.isArray(validated?.gaps) ? validated.gaps : [],
    };
}

module.exports = {
    ...metricsLib,
    ...groundingMetrics,
    ...grounding,
    ...runScorecard,
    scoreReferenceFreeExtraction,
};
