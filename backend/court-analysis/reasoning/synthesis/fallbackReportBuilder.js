'use strict';

const { SCHEMA_VERSION } = require('../schema/schema');
const { buildTimeline } = require('./timelineBuilder');

const MAX_FALLBACK_FINDINGS = 12;

function buildFallbackNarrative(pkg, fallbackReason) {
    const caseNumber = pkg?.primaryCaseNumber || pkg?.clusterId || 'Nepoznat predmet';
    const analyzed = pkg?.coverage?.analyzed ?? 0;
    const total = pkg?.coverage?.total ?? 0;
    const flowCount = pkg?.flows?.count ?? (Array.isArray(pkg?.flows?.entries) ? pkg.flows.entries.length : 0);
    const conflictCount = Array.isArray(pkg?.reconciliation?.conflicts) ? pkg.reconciliation.conflicts.length : 0;
    const reasonText = fallbackReason === 'provider-credits-exhausted'
        ? 'AI sinteza nije dovršena zbog iscrpljenog OpenRouter kredita'
        : 'AI sinteza nije bila dostupna';

    return [
        `Deterministički rezervni izvještaj za predmet ${caseNumber} (${reasonText}).`,
        `Obrađeno je ${analyzed} od ${total} dokumenata, izdvojeno ${flowCount} financijskih/imovinskih zapisa`,
        conflictCount > 0 ? `te utvrđeno ${conflictCount} aritmetičkih ili imovinskih odstupanja.` : 'bez automatski utvrđenih odstupanja.',
        'Za potpunu AI sintezu nadopunite kredit i pokrenite ponovnu izradu izvještaja.',
    ].join(' ').slice(0, 1500);
}

function buildFallbackReport(evidencePackage, { fallbackReason = 'synthesis-failed', reasonDetail = null } = {}) {
    const pkg = evidencePackage && typeof evidencePackage === 'object' ? evidencePackage : {};
    const conflicts = Array.isArray(pkg?.reconciliation?.conflicts) ? [...pkg.reconciliation.conflicts] : [];
    const openQuestions = Array.isArray(pkg?.reconciliation?.openQuestions)
        ? pkg.reconciliation.openQuestions.map((q) => (typeof q === 'string' ? q : q?.text || '')).filter(Boolean)
        : [];
    const findings = [];

    for (const conflict of conflicts) {
        if (findings.length >= MAX_FALLBACK_FINDINGS) break;
        findings.push({
            id: `fallback-conflict-${findings.length + 1}`,
            text: conflict.finding || conflict.reason || 'Utvrđeno odstupanje u izdvajanju.',
            confidence: 'high',
            verificationStatus: 'verified_deterministic',
            verificationNote: 'Potvrđeno determinističkom provjerom usklađenosti.',
            citations: (Array.isArray(conflict.sources) ? conflict.sources : []).slice(0, 4).map((src) => ({
                source: src,
                text: conflict.reason || conflict.finding || '',
            })),
        });
    }

    for (const vc of Array.isArray(pkg?.reconciliation?.valueChanges) ? pkg.reconciliation.valueChanges : []) {
        if (findings.length >= MAX_FALLBACK_FINDINGS) break;
        findings.push({
            id: `fallback-vc-${findings.length + 1}`,
            text: vc.finding || `Vrijednosna promjena tražbine "${vc.description || ''}".`,
            confidence: 'medium',
            verificationStatus: 'verified_deterministic',
            verificationNote: 'Potvrđeno determinističkim lancem promjene vrijednosti.',
            citations: (Array.isArray(vc.stages) ? vc.stages : []).slice(0, 4).map((s) => ({
                source: s.sourceId || null,
                fileName: s.fileName || null,
                text: `${s.value ?? ''} ${s.currency || ''}`.trim(),
            })),
        });
    }

    for (const flow of Array.isArray(pkg?.flows?.entries) ? pkg.flows.entries : []) {
        if (findings.length >= MAX_FALLBACK_FINDINGS) break;
        const val = flow.valueEur ?? flow.value ?? flow.sourceAmount ?? '';
        const cur = Number.isFinite(flow.valueEur) ? 'EUR' : (flow.currency || flow.sourceCurrency || '');
        findings.push({
            id: `fallback-flow-${findings.length + 1}`,
            text: `${flow.description || 'Zapis'}: ${val} ${cur}`.trim(),
            confidence: flow.grounded ? 'high' : 'low',
            verificationStatus: flow.grounded ? 'verified_deterministic' : 'unverified',
            verificationNote: flow.grounded
                ? 'Potvrđeno u izvornom tekstu dokumenta.'
                : 'Nije potvrđeno doslovnim citatom u izvornom tekstu.',
            citations: [{
                ...(flow.docId ? { docId: flow.docId } : {}),
                ...(flow.sourceId ? { source: flow.sourceId } : {}),
                ...(flow.fileName ? { fileName: flow.fileName } : {}),
                ...(Array.isArray(flow.sourcePages) ? { sourcePages: flow.sourcePages } : {}),
                ...(flow.sourceChunkId ? { chunkId: flow.sourceChunkId } : {}),
                ...(Number.isInteger(flow.sourceEntryIndex) ? { sourceEntryIndex: flow.sourceEntryIndex } : {}),
                text: flow.quote || flow.description || '',
            }],
        });
    }

    const timeline = buildTimeline((pkg.entries || []).slice(0, 30).map((entry, index) => ({
        date: entry.date || null,
        description: `${entry.title || 'Objava'} (${entry.caseNumber || pkg.clusterId || ''})`.trim(),
        evidence: [{
            sourceId: entry.detailLink || `${pkg.clusterId || 'case'}:entry-${index + 1}`,
            text: entry.title || entry.detailLink || 'Objava bez naslova',
        }],
    }))).map((event) => ({
        date: event.date ?? null,
        description: event.description || 'Objava',
        citations: (event.evidence || []).map((e) => ({ source: e.sourceId, text: e.text })),
    }));

    const nextSteps = [];
    if (fallbackReason === 'provider-credits-exhausted') {
        nextSteps.push('Nadopunite OpenRouter kredit i kliknite "Ponovno izradi izvještaj" za potpunu AI sintezu.');
    } else {
        nextSteps.push('Pokrenite ponovnu izradu stručnog izvještaja za potpunu AI sintezu.');
    }
    if (conflicts.length > 0) {
        nextSteps.push('Provjerite identificirana aritmetička i imovinska odstupanja u izvornim dokumentima.');
    }

    return {
        schemaVersion: SCHEMA_VERSION,
        generationMode: 'deterministic_fallback',
        fallbackReason,
        narrative: buildFallbackNarrative(pkg, fallbackReason),
        claims: [],
        findings,
        openQuestions: openQuestions.slice(0, 8),
        nextSteps: nextSteps.slice(0, 8),
        conflicts,
        timeline,
        meta: {
            clusterId: pkg.clusterId || null,
            caseNumber: pkg.primaryCaseNumber || pkg.clusterId || null,
            coverage: pkg.coverage || null,
            fallbackReason,
            reasonDetail: reasonDetail || null,
            generatedAt: new Date().toISOString(),
        },
    };
}

module.exports = {
    buildFallbackReport,
};
