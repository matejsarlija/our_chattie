'use strict';

const { OIB_CASE_DOCS, SMOKE_DOC_IDS, FULL_PILOT_MIN, FULL_PILOT_MAX, assertRunScope } = require('../scripts/lib/lab-documents');

const byId = (id) => OIB_CASE_DOCS.find((doc) => doc.docId === id);
const smokeDocs = SMOKE_DOC_IDS.map(byId);

test('smoke trio is a real, small, mixed three-document subset of the local manifest', () => {
    expect(new Set(SMOKE_DOC_IDS).size).toBe(3);
    expect(smokeDocs.every(Boolean)).toBe(true);
    expect(smokeDocs.reduce((sum, doc) => sum + doc.pages, 0)).toBeLessThanOrEqual(6);
    expect(smokeDocs.some((doc) => doc.layer === 'image')).toBe(true);
    expect(smokeDocs.some((doc) => doc.layer === 'text')).toBe(true);
});

test('dry runs accept any non-empty selection, including a single document', () => {
    expect(() => assertRunScope({ docs: [byId('1:Podnesak.pdf')], smokeRun: false, dryRun: true })).not.toThrow();
    expect(() => assertRunScope({ docs: smokeDocs, smokeRun: true, dryRun: true })).not.toThrow();
    expect(() => assertRunScope({ docs: [], smokeRun: false, dryRun: true })).toThrow(/at least one/);
});

test('a live smoke run requires exactly the fixed trio', () => {
    expect(() => assertRunScope({ docs: smokeDocs, smokeRun: true, dryRun: false })).not.toThrow();
    const otherThree = ['1:Podnesak.pdf', '2:Žalba.pdf', '4:Rješenje - odbijen prigovor na diobeni popis.pdf'].map(byId);
    expect(() => assertRunScope({ docs: otherThree, smokeRun: true, dryRun: false })).toThrow(/fixed 3-document trio/);
    expect(() => assertRunScope({ docs: OIB_CASE_DOCS.slice(0, 12), smokeRun: true, dryRun: false })).toThrow(/fixed 3-document trio/);
});

test('a live benchmark keeps the configured pilot document range', () => {
    const rangeRe = new RegExp(`${FULL_PILOT_MIN}–${FULL_PILOT_MAX}`);
    expect(() => assertRunScope({ docs: smokeDocs, smokeRun: false, dryRun: false })).toThrow(rangeRe);
    expect(() => assertRunScope({ docs: OIB_CASE_DOCS.slice(0, FULL_PILOT_MIN - 1), smokeRun: false, dryRun: false })).toThrow(rangeRe);
    expect(() => assertRunScope({ docs: OIB_CASE_DOCS.slice(0, FULL_PILOT_MIN), smokeRun: false, dryRun: false })).not.toThrow();
    expect(() => assertRunScope({ docs: OIB_CASE_DOCS, smokeRun: false, dryRun: false })).not.toThrow();
});

const { resolveRunDocuments } = require('../scripts/benchmark-pdf-engines');

test('resolveRunDocuments defaults to the 25 curated documents for pilot', () => {
    const docs = resolveRunDocuments({}, 'pilot');
    expect(docs).toHaveLength(25);
    expect(docs.map((d) => d.docId)).toEqual(OIB_CASE_DOCS.map((d) => d.docId));
});

test('resolveRunDocuments defaults to the fixed 3-doc trio for smoke', () => {
    const docs = resolveRunDocuments({}, 'smoke');
    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.docId)).toEqual(SMOKE_DOC_IDS);
});

test('Stage A compares models on the canonical frozen text arm only', () => {
    const { analysisArmsForModel } = require('../scripts/lib/arms');
    const baselineModel = 'google/gemini-2.5-flash';
    const challengerModel = 'z-ai/glm-5.3-flash';
    const challengerArms = analysisArmsForModel(challengerModel, { baselineModel });
    const baselineArms = analysisArmsForModel(baselineModel, { baselineModel });
    expect(challengerArms.map((arm) => arm.id)).toEqual(['local-text']);
    expect(baselineArms.map((arm) => arm.id)).toEqual(['local-text']);
});

test('resolveRunDocuments preserves explicit doc-id selection', () => {
    const explicit = ['1:Podnesak.pdf', '2:Žalba.pdf'];
    const docs = resolveRunDocuments({ 'doc-id': explicit }, 'pilot');
    expect(docs.map((d) => d.docId)).toEqual(explicit);
});

test('resolveRunDocuments applies sample on curated corpus when no explicit selection', () => {
    const docs = resolveRunDocuments({ sample: '5', seed: '42' }, 'pilot');
    expect(docs).toHaveLength(5);
    const curatedSet = new Set(OIB_CASE_DOCS.map((d) => d.docId));
    expect(docs.every((d) => curatedSet.has(d.docId))).toBe(true);
});

