'use strict';

const { createHash } = require('node:crypto');
const { normalizeFilingReference } = require('../utils/proceduralMetadata');

function normalizeReference(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return normalizeFilingReference(trimmed)?.toLocaleLowerCase('en-US') || trimmed.toLocaleLowerCase('en-US');
}

function stringsOf(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))];
}

function eventReference(event) {
    return normalizeReference(event?.filingReference);
}

function collectProceduralEvents(analyses, metadataEntries = []) {
    const sourceList = Array.isArray(analyses) ? analyses : [];
    const entries = Array.isArray(metadataEntries) ? metadataEntries : [];
    const analysisByEntry = new Map();
    for (const analysis of sourceList) {
        if (Number.isInteger(analysis?.sourceEntryIndex) && !analysisByEntry.has(analysis.sourceEntryIndex)) {
            analysisByEntry.set(analysis.sourceEntryIndex, analysis);
        }
    }
    const events = [];
    const metadataEvents = [];
    for (const entry of entries) {
        const sourceAnalysis = analysisByEntry.get(entry?.index);
        const sourceId = sourceAnalysis?.id || `entry-${entry?.index ?? events.length}`;
        for (const [position, stub] of (Array.isArray(entry?.proceduralEvents) ? entry.proceduralEvents : []).entries()) {
            if (!stub || typeof stub !== 'object') continue;
            metadataEvents.push({
                ...stub,
                id: `procedural-${encodeURIComponent(String(sourceId))}-metadata-${position + 1}`,
                analysisId: String(sourceId),
                sourceEntryIndex: entry?.index ?? null,
                fileName: sourceAnalysis?.fileName || null,
                filingReference: typeof stub.filingReference === 'string' ? stub.filingReference.trim() || null : null,
                outcome: stub.statedOutcome || 'unknown',
                grounded: false,
                source: 'metadata',
                citedFilingReferences: stringsOf(stub.referencedFilingReferences),
            });
        }
    }
    const usedMetadata = new Set();
    for (const analysis of sourceList) {
        const sourceId = analysis?.id || analysis?.fileName
            || `analysis-${createHash('sha256').update(JSON.stringify(analysis)).digest('hex').slice(0, 16)}`;
        const extracted = Array.isArray(analysis?.proceduralEvents) ? analysis.proceduralEvents : [];
        for (const [eventPosition, extractedEvent] of extracted.entries()) {
            if (!extractedEvent || typeof extractedEvent !== 'object' || Array.isArray(extractedEvent)) continue;
            const ref = eventReference(extractedEvent);
            const metadataIndex = metadataEvents.findIndex((stub, index) => (
                !usedMetadata.has(index) && ref && eventReference(stub) === ref
                && (!Number.isInteger(analysis?.sourceEntryIndex)
                    || stub.sourceEntryIndex === analysis.sourceEntryIndex)
                && (!extractedEvent.eventType || extractedEvent.eventType === stub.eventType)
            ));
            const metadataStub = metadataIndex >= 0 ? metadataEvents[metadataIndex] : null;
            if (metadataIndex >= 0) usedMetadata.add(metadataIndex);
            events.push({
                ...(metadataStub || {}),
                ...extractedEvent,
                id: metadataStub?.id || `procedural-${encodeURIComponent(String(sourceId))}-extracted-${eventPosition + 1}`,
                analysisId: String(sourceId),
                fileName: analysis?.fileName || metadataStub?.fileName || null,
                filingReference: typeof extractedEvent.filingReference === 'string'
                    ? extractedEvent.filingReference.trim() || metadataStub?.filingReference || null
                    : metadataStub?.filingReference || null,
                targetFilingReference: typeof extractedEvent.targetFilingReference === 'string'
                    ? extractedEvent.targetFilingReference.trim() || null
                    : null,
                outcome: extractedEvent.outcome && extractedEvent.outcome !== 'unknown'
                    ? extractedEvent.outcome
                    : metadataStub?.outcome || extractedEvent.outcome || 'unknown',
                finalityStated: extractedEvent.finalityStated && extractedEvent.finalityStated !== 'unknown'
                    ? extractedEvent.finalityStated
                    : metadataStub?.finalityStated || extractedEvent.finalityStated || 'unknown',
                grounded: extractedEvent.grounded === true,
                source: metadataStub ? 'metadata+extraction' : 'extraction',
                citedFilingReferences: [
                    ...new Set([
                        ...stringsOf(analysis?.citedFilingReferences),
                        ...stringsOf(extractedEvent.referencedFilingReferences),
                    ]),
                ],
            });
        }
    }
    events.push(...metadataEvents.filter((_, index) => !usedMetadata.has(index)));
    return {
        count: events.length,
        events,
        hasProceduralEvents: events.length > 0,
        metadataStubCount: metadataEvents.length,
        extractedEventCount: sourceList.reduce((total, analysis) => (
            total + (Array.isArray(analysis?.proceduralEvents) ? analysis.proceduralEvents.length : 0)
        ), 0),
    };
}

function appellateOutcome(event) {
    if (String(event?.eventType || '').toLowerCase() !== 'appellate-decision') return null;
    const outcome = String(event?.outcome || event?.statedOutcome || '').trim().toLowerCase();
    return ['upheld', 'overturned', 'modified', 'remanded'].includes(outcome) ? outcome : null;
}

function reconcileProceduralEvents(proceduralFlow, context = {}) {
    const events = (Array.isArray(proceduralFlow?.events) ? proceduralFlow.events : [])
        .filter((event) => event && typeof event === 'object' && !Array.isArray(event));
    const byReference = new Map();
    const byAnalysis = new Map();
    const byCaseNumber = new Map();
    events.forEach((event, index) => {
        const ref = eventReference(event);
        if (ref && !byReference.has(ref)) byReference.set(ref, index);
        for (const caseNumber of stringsOf(event.appellateCaseNumbers)) {
            const key = normalizeReference(caseNumber);
            if (!byCaseNumber.has(key)) byCaseNumber.set(key, []);
            byCaseNumber.get(key).push(index);
        }
        const analysisId = String(event.analysisId || '');
        if (!byAnalysis.has(analysisId)) byAnalysis.set(analysisId, []);
        byAnalysis.get(analysisId).push(index);
    });

    const edges = [];
    const unresolvedByIndex = events.map(() => []);
    const edgeKeys = new Set();
    const addLink = (fromIndex, toIndex, via, basis) => {
        if (fromIndex === toIndex) return;
        const key = `${fromIndex}:${toIndex}:${basis}:${normalizeReference(via)}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        edges.push({ from: events[fromIndex].id, to: events[toIndex].id, via: via || null, basis });
    };
    const linkByReference = (eventIndex, value, basis, unresolvedIfMissing = true) => {
        const key = normalizeReference(value);
        if (!key) return;
        const owner = byReference.get(key);
        if (owner === undefined) {
            if (unresolvedIfMissing) unresolvedByIndex[eventIndex].push(String(value).trim());
            return;
        }
        addLink(owner, eventIndex, String(value).trim(), basis);
    };

    events.forEach((event, index) => {
        linkByReference(index, event.targetFilingReference, 'targetFilingReference');
        for (const reference of stringsOf(event.referencedFilingReferences)) {
            linkByReference(index, reference, 'referencedFilingReferences');
        }
        for (const reference of stringsOf(event.citedFilingReferences)) {
            linkByReference(index, reference, 'citedFilingReferences');
        }
        for (const caseNumber of stringsOf(event.appellateCaseNumbers)) {
            const matches = byCaseNumber.get(normalizeReference(caseNumber)) || [];
            for (const match of matches) addLink(match, index, caseNumber, 'appellateCaseNumber');
        }
    });

    for (const analysis of Array.isArray(context?.analyses) ? context.analyses : []) {
        const analysisId = String(analysis?.id || analysis?.fileName || '');
        for (const eventIndex of byAnalysis.get(analysisId) || []) {
            for (const reference of stringsOf(analysis?.citedFilingReferences)) {
                linkByReference(eventIndex, reference, 'citedFilingReferences');
            }
        }
    }
    for (const graphEdge of Array.isArray(context?.citationGraph?.edges) ? context.citationGraph.edges : []) {
        const citingEvents = byAnalysis.get(String(graphEdge?.from || '')) || [];
        const citedEvents = byAnalysis.get(String(graphEdge?.to || '')) || [];
        if (!normalizeReference(graphEdge?.via) || citingEvents.length === 0) continue;
        if (citedEvents.length === 0) {
            for (const index of citingEvents) unresolvedByIndex[index].push(String(graphEdge.via).trim());
            continue;
        }
        for (const citedIndex of citedEvents) {
            for (const citingIndex of citingEvents) {
                addLink(citedIndex, citingIndex, String(graphEdge.via).trim(), 'citationGraph');
            }
        }
    }

    const parent = events.map((_, index) => index);
    const find = (index) => {
        let root = index;
        while (parent[root] !== root) root = parent[root];
        while (parent[index] !== index) {
            const next = parent[index];
            parent[index] = root;
            index = next;
        }
        return root;
    };
    for (const edge of edges) {
        const from = events.findIndex((event) => event.id === edge.from);
        const to = events.findIndex((event) => event.id === edge.to);
        if (from >= 0 && to >= 0) parent[find(to)] = find(from);
    }
    const groups = new Map();
    events.forEach((event, index) => {
        const root = find(index);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(index);
    });

    const statuses = {};
    const reconciledEvents = [];
    const chains = [];
    for (const indexes of groups.values()) {
        const members = indexes.map((index) => events[index]);
        const memberSet = new Set(members.map((event) => event.id));
        const chainEdges = edges.filter((edge) => memberSet.has(edge.from) && memberSet.has(edge.to));
        const unresolvedReferences = [...new Set(indexes.flatMap((index) => unresolvedByIndex[index]))];
        const outcomes = [...new Set(members.map(appellateOutcome).filter(Boolean))];
        const appeals = members.some((event) => String(event.eventType || '').toLowerCase() === 'appeal');
        const decisions = members.filter((event) => ['decision', 'appellate-decision'].includes(
            String(event.eventType || '').toLowerCase()
        ));
        const status = unresolvedReferences.length > 0 || outcomes.length > 1
            ? 'unresolved'
            : outcomes[0] || (appeals ? 'appealed-outcome-unknown' : decisions.length ? 'operative' : 'unresolved');
        for (const index of indexes) {
            statuses[events[index].id] = status;
            reconciledEvents.push({
                ...events[index],
                status,
                unresolvedReferences: [...new Set(unresolvedByIndex[index])],
            });
        }
        chains.push({
            id: `procedural-chain-${members[0].id}`,
            eventIds: members.map((event) => event.id),
            edges: chainEdges,
            status,
            finalityStated: members.some((event) => event.finalityStated === 'final') || outcomes[0] === 'upheld',
            unresolvedReferences,
            groundedEventIds: members.filter((event) => event.grounded).map((event) => event.id),
        });
    }

    return {
        events: reconciledEvents,
        chains,
        statuses,
        coverage: {
            eventCount: reconciledEvents.length,
            chainCount: chains.length,
            metadataStubCount: proceduralFlow?.metadataStubCount || 0,
            extractedEventCount: proceduralFlow?.extractedEventCount || 0,
            linkedEventCount: new Set(edges.flatMap((edge) => [edge.from, edge.to])).size,
            unresolvedEventCount: Object.values(statuses).filter((status) => status === 'unresolved').length,
            groundedEventCount: reconciledEvents.filter((event) => event.grounded).length,
        },
    };
}

module.exports = { collectProceduralEvents, reconcileProceduralEvents };
