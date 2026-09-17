// court-analysis/utils/normalizeText.js
//
// Tiny dependency-free normalizer for metadata matching (lowercase +
// diacritic stripping). The reasoning `indexer.normalizeText` additionally
// tokenizes for retrieval; discovery-side keyword rules need only this.

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
}

module.exports = {
    normalizeText
};
