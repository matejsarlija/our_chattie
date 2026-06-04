function normalizeQueryType(type) {
    return ['oib', 'case_number', 'text'].includes(type) ? type : 'text';
}

function createRetrievalQueries({ query = null, clusterId = null, primaryCaseNumber = null, identity = {} } = {}) {
    const queryType = normalizeQueryType(query?.type);
    const queryValue = query?.value || '';
    const caseNumber = primaryCaseNumber || clusterId || '';
    const participantOibs = Array.isArray(identity.participantOibs) ? identity.participantOibs : [];
    const participantNames = Array.isArray(identity.participantNames) ? identity.participantNames : [];

    const anchors = [
        queryValue,
        caseNumber,
        ...participantOibs,
        ...participantNames
    ].filter(Boolean);

    return [
        {
            id: 'timeline',
            purpose: 'timeline',
            text: ['datumi ročište rješenje zaključak objava tijek predmeta', caseNumber].filter(Boolean).join(' '),
            anchors,
            queryType
        },
        {
            id: 'amounts',
            purpose: 'financial-amounts',
            text: ['iznos tražbina dug uplata kamata eur hrk trošak', caseNumber].filter(Boolean).join(' '),
            anchors,
            queryType
        },
        {
            id: 'procedural-status',
            purpose: 'procedural-status',
            text: ['status postupka stečaj obustava nastavak pravomoćnost odluka', caseNumber].filter(Boolean).join(' '),
            anchors,
            queryType
        },
        {
            id: 'party-roles',
            purpose: 'party-roles',
            text: ['dužnik vjerovnik stranka sudionik oib tvrtka osoba', ...participantNames].filter(Boolean).join(' '),
            anchors,
            queryType
        }
    ];
}

module.exports = {
    createRetrievalQueries
};
