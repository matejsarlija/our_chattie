'use strict';

const { isQuoteGrounded } = require('../../court-analysis/reasoning/ledger/grounding');

function collectQuotes(extraction) {
    return ['amounts', 'propertyFlow', 'proceduralEvents'].flatMap((field) => (
        Array.isArray(extraction?.[field]) ? extraction[field].map((fact) => fact?.quote).filter((quote) => typeof quote === 'string' && quote.trim()) : []
    ));
}

function quoteGrounding(extraction, sourceText) {
    const quotes = collectQuotes(extraction);
    const grounded = quotes.filter((quote) => isQuoteGrounded(quote, sourceText)).length;
    return { grounded, total: quotes.length, rate: quotes.length ? grounded / quotes.length : null };
}

module.exports = { collectQuotes, quoteGrounding };
