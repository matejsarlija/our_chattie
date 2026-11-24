'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { normalizeGoldFacts, summarizeGold, factCount, resolveGoldTarget } = require('../scripts/lib/gold-editor');
const { createGoldSetId, extractDraftGoldFactsFromText, loadExistingGoldByDocId } = require('../scripts/build-gold-template');
const { selectCsvEntriesByRowNumbers } = require('../scripts/fetch-real-document-fixtures');

const valid = {
    amounts: [
        { rawValue: ' 1.234,56 ', currency: 'eur' },
        { rawValue: '99,00', currency: 'kn' },
        { rawValue: '', currency: '' },
    ],
    oibs: [
        { value: ' 12345678901 ', role: ' vjerovnik ' },
        { value: '98765432109', role: '' },
    ],
    dates: ['12.03.2024.', { value: ' 01.01.2025. ' }, ''],
    filingNumbers: ['St-2/2013', ' P-2/2020 '],
    decisionOutcome: ' odbija se ',
    tables: [{ description: ' troškovnik ', rowCount: '14' }],
};

test('gold facts are trimmed, canonicalized, and blank rows dropped', () => {
    const { facts, errors } = normalizeGoldFacts(valid);
    expect(errors).toEqual([]);
    expect(facts.amounts).toEqual([
        { rawValue: '1.234,56', currency: 'EUR' },
        { rawValue: '99,00', currency: 'HRK' },
    ]);
    expect(facts.oibs).toEqual([
        { value: '12345678901', role: 'vjerovnik' },
        { value: '98765432109' },
    ]);
    expect(facts.dates).toEqual(['12.03.2024.', '01.01.2025.']);
    expect(facts.filingNumbers).toEqual(['St-2/2013', 'P-2/2020']);
    expect(facts.decisionOutcome).toBe('odbija se');
    expect(facts.tables).toEqual([{ description: 'troškovnik', rowCount: 14 }]);
});

test('half-filled rows are reported instead of silently saved', () => {
    const { errors } = normalizeGoldFacts({
        amounts: [{ rawValue: '', currency: 'EUR' }, { rawValue: 'abc', currency: 'EUR' }, { rawValue: '10', currency: 'USD' }],
        oibs: [{ value: '123', role: 'dužnik' }],
        tables: [{ description: '', rowCount: 3 }, { description: 'popis', rowCount: '2,5' }],
    });
    expect(errors).toEqual([
        'Amount 2: the value needs at least one digit.',
        'Amount 3: currency must be EUR or HRK.',
        'OIB 1: needs exactly 11 digits.',
        'Table 1: describe which table this is.',
        'Table 2: row count must be a whole number.',
    ]);
    expect(normalizeGoldFacts({ tables: [{ description: 'troškovnik', rowCount: '' }] }).errors).toContain('Table 1: row count is required.');
});

test('all fact categories, including empty ones, must be reviewed before completion', () => {
    const { facts } = normalizeGoldFacts(valid);
    const categories = ['amounts', 'oibs', 'dates', 'filingNumbers', 'decisionOutcome', 'tables'];
    const draft = summarizeGold({ facts, factsComplete: false });
    const unreviewed = summarizeGold({ facts, factsComplete: true });
    const summary = summarizeGold({ facts, reviewedCategories: categories, factsComplete: true });
    expect(draft.complete).toBe(false);
    expect(unreviewed).toMatchObject({ complete: false, reviewedCount: 0, missingReviews: categories });
    expect(summary).toMatchObject({ complete: true, amounts: 2, oibs: 2, dates: 2, filingNumbers: 2, tables: 1, tableRows: 14, decisionOutcome: true });
    expect(factCount(summary)).toBe(10);
    expect(summarizeGold({ facts, reviewedCategories: categories, factsComplete: true }).complete).toBe(true);
    expect(factCount(summarizeGold({ facts: {} }))).toBe(0);
});

test('gold paths are confined to the benchmark data folder', () => {
    const root = path.resolve('/tmp/pdf-bench-data');
    const target = resolveGoldTarget(root, '2026-10-20T17-05-58-490Z-84a089b2', 'abcdef0123456789.json');
    expect(target.filePath).toBe(path.join(root, '2026-10-20T17-05-58-490Z-84a089b2', 'gold', 'abcdef0123456789.json'));
    expect(() => resolveGoldTarget(root, '../etc', 'abcdef0123456789.json')).toThrow(/gold set/i);
    expect(() => resolveGoldTarget(root, '2026-10-20T17-05-58-490Z-84a089b2', '../../etc/passwd')).toThrow(/template file/i);
    expect(() => resolveGoldTarget(root, '2026-10-20T17-05-58-490Z-84a089b2', 'notahash.json')).toThrow(/template file/i);
});

test('gold template builder creates a goldSetId-shaped identifier', () => {
    expect(createGoldSetId()).toMatch(/^[0-9TZ-]+-[a-f0-9]{8}$/);
});

test('extractDraftGoldFactsFromText extracts normalized draft amounts, OIBs, dates, and filing numbers', () => {
    const sampleText = [
        'TRGOVAČKI SUD U SPLITU Poslovni broj: 4 Stpn-7/2017-16 i Pž-7788/2016.',
        'Stečajni dužnik KERUM d.o.o. OIB: 66124057408, vjerovnik OIB 89406825003.',
        'Dana 14.10.2025. i 22. travnja 2022. utvrđena je tražbina od 1.327.228,08 EUR (10.000.000,00 kn).',
    ].join('\n');
    const draft = extractDraftGoldFactsFromText(sampleText);
    expect(draft.amounts).toEqual([
        { rawValue: '1.327.228,08', currency: 'EUR' },
        { rawValue: '10.000.000,00', currency: 'HRK' },
    ]);
    expect(draft.oibs).toEqual([
        { value: '66124057408' },
        { value: '89406825003' },
    ]);
    expect(draft.dates).toEqual(expect.arrayContaining(['14.10.2025.', '22. travnja 2022.']));
    expect(draft.filingNumbers).toEqual(expect.arrayContaining(['4 Stpn-7/2017-16', 'Pž-7788/2016']));
});

test('selectCsvEntriesByRowNumbers maps 1-based data rows from oib-66124057408.csv', () => {
    const csvPath = path.resolve(__dirname, 'fixtures/csv-export/oib-66124057408.csv');
    const csvText = fs.readFileSync(csvPath, 'utf8');
    const rows = selectCsvEntriesByRowNumbers(csvText, [1, 19, 372, 379]);
    expect(rows.map((r) => r.index)).toEqual([1, 19, 372, 379]);
    expect(rows[0].caseNumber).toBe('St-2/2013');
    expect(rows[2].caseNumber).toBe('St-357/2013');
    expect(rows[3].caseNumber).toBe('Stpn-7/2017');
    expect(rows[3].documentDownloadLink).toContain('8f9e6070-21e4-4cff-ac63-ed012e89112c');
});

// Exercise the page's actual async handlers without a browser or paid requests.
// Only form serialization/rendering and PDF image loading are substituted.
function createEditor() {
    class Element {
        constructor(tag = 'div') {
            this.tag = tag;
            this.children = [];
            this.style = {};
            this.value = '';
            this.hidden = false;
            this.disabled = false;
            this.listeners = {};
        }
        set textContent(value) { this.label = value; this.children = []; }
        get textContent() { return this.label || ''; }
        get options() { return this.children; }
        append(...items) { this.children.push(...items); }
        setAttribute(name, value) { this[name] = value; }
        addEventListener(name, handler) { this.listeners[name] = handler; }
    }
    const elements = new Map();
    const get = (id) => {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
    };
    const emptyFacts = () => ({ amounts: [], oibs: [], dates: [], filingNumbers: [], decisionOutcome: '', tables: [] });
    const ledger = { facts: emptyFacts(), reviewedCategories: [] };
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const requests = [];
    const unloadHandlers = {};
    const context = {
        document: { getElementById: get, createElement: (tag) => new Element(tag), querySelectorAll: () => [], querySelector: () => null },
        window: { addEventListener: (name, handler) => { unloadHandlers[name] = handler; } },
        location: { search: '' },
        URLSearchParams,
        confirm: jest.fn(() => true),
        ledger,
        clone,
        fetch: jest.fn((url, options) => new Promise((resolve, reject) => {
            requests.push({ url, body: options?.body ? JSON.parse(options.body) : null, resolve: (data) => resolve({ ok: true, json: async () => data }), reject });
        })),
    };
    const html = fs.readFileSync(path.join(__dirname, '../scripts/pdf-bench-gold.html'), 'utf8');
    const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nloadSets\(\);\s*$/, '');
    vm.runInNewContext(`${source}
        collect = () => clone(ledger.facts);
        collectReviewed = () => [...ledger.reviewedCategories];
        renderForm = (template) => {
            ledger.facts = clone(template.facts);
            ledger.reviewedCategories = [...(template.reviewedCategories || [])];
            updateCounts();
        };
        showPage = () => {};
        globalThis.editor = { state, save, loadTemplate, requestSuggestions, applySuggestions, markDirty, updateGoldProgress };
    `, context);
    const editor = context.editor;
    const template = (docId) => ({ document: { docId, pages: 1 }, facts: emptyFacts(), reviewedCategories: [], factsComplete: false });
    const summary = { complete: false, facts: 0 };
    editor.state.sets = [
        { setId: 'set-a', documents: [{ file: 'doc-a.json', summary: { ...summary } }, { file: 'doc-b.json', summary: { ...summary } }] },
        { setId: 'set-b', documents: [{ file: 'doc-a.json', summary: { ...summary } }] },
    ];
    Object.assign(editor.state, { setId: 'set-a', file: 'doc-a.json', template: template('doc-a'), summary: { ...summary } });
    get('doc').append(Object.assign(new Element('option'), { value: 'doc-a.json' }));
    return { ...editor, requests, get, ledger, unloadHandlers, template, summary, context };
}

function suggestionFor(outcome) {
    return { model: 'test/model', provider: 'Test', cost: null, pages: 1, facts: { amounts: [], oibs: [], dates: [], filingNumbers: [], decisionOutcome: outcome, tables: [] }, evidence: [], warnings: [] };
}

test.each([
    ['set-a', 'doc-b.json'],
    ['set-b', 'doc-a.json'],
])('late suggestions stay with their captured document when switching to %s/%s', async (setId, file) => {
    const editor = createEditor();
    const suggesting = editor.requestSuggestions();
    expect(editor.requests[0].body).toMatchObject({ set: 'set-a', file: 'doc-a.json' });
    const loading = editor.loadTemplate(setId, file);
    editor.requests[1].resolve({ template: editor.template('other'), summary: editor.summary });
    await loading;
    editor.ledger.facts.decisionOutcome = 'new document draft';
    editor.markDirty();
    const suggestion = suggestionFor('rejected');
    editor.requests[0].resolve(suggestion);
    await suggesting;
    expect(editor.state.suggestions.get('set-a/doc-a.json')).toEqual(suggestion);
    expect(editor.state.suggestions.has(`${setId}/${file}`)).toBe(false);
    expect(editor.state.suggestion).toBeNull();
    expect(editor.get('suggest-preview').hidden).toBe(true);
    editor.applySuggestions();
    expect(editor.ledger.facts.decisionOutcome).toBe('new document draft');
    expect(editor.state.dirty).toBe(true);

    const returning = editor.loadTemplate('set-a', 'doc-a.json');
    editor.requests[2].resolve({ template: editor.template('doc-a'), summary: editor.summary });
    await returning;
    expect(editor.state.suggestion).toEqual(suggestion);
    expect(editor.get('suggest-preview').hidden).toBe(false);
});

test('suggestions that finish during a document load are restored only for their own document', async () => {
    const editor = createEditor();
    const suggesting = editor.requestSuggestions();
    const loading = editor.loadTemplate('set-a', 'doc-b.json');
    editor.requests[0].resolve(suggestionFor('rejected'));
    await suggesting;
    expect(editor.state.suggestion).toBeNull();
    editor.requests[1].resolve({ template: editor.template('doc-b'), summary: editor.summary });
    await loading;
    expect(editor.state.suggestion).toBeNull();
    expect(editor.get('suggest-status').textContent).toBe('');
});

test('edits made during save remain dirty and a second save is blocked until completion', async () => {
    const editor = createEditor();
    editor.ledger.facts.decisionOutcome = 'odbija se';
    editor.markDirty();
    const saving = editor.save(false);
    expect(editor.get('save').disabled).toBe(true);
    expect(editor.get('doc').disabled).toBe(true);
    expect(editor.get('set').disabled).toBe(true);
    await editor.loadTemplate('set-b', 'doc-a.json');
    expect(editor.requests).toHaveLength(1);
    editor.ledger.facts.decisionOutcome = 'potvrđuje se';
    editor.markDirty();
    await editor.save(false);
    expect(editor.requests).toHaveLength(1);
    expect(editor.requests[0].body.facts.decisionOutcome).toBe('odbija se');
    editor.requests[0].resolve({ summary: editor.summary });
    await saving;
    expect(editor.state.template.facts.decisionOutcome).toBe('odbija se');
    expect(editor.ledger.facts.decisionOutcome).toBe('potvrđuje se');
    expect(editor.state.dirty).toBe(true);
    expect(editor.state.drafts.get('set-a/doc-a.json').facts.decisionOutcome).toBe('potvrđuje se');
    expect(editor.get('state-chip').textContent).toBe('Unsaved changes');
    expect(editor.get('status').textContent).toContain('newer edits are still unsaved');
    expect(editor.get('save').disabled).toBe(false);
    expect(editor.get('doc').disabled).toBe(false);
});

test('save responses cannot replace the active document or its dirty state', async () => {
    const editor = createEditor();
    editor.ledger.facts.decisionOutcome = 'rejected';
    editor.markDirty();
    const saving = editor.save(false);
    const before = editor.state.template;
    Object.assign(editor.state, { setId: 'set-b', file: 'doc-a.json', template: editor.template('other'), summary: { complete: false, facts: 3 }, revision: 7 });
    editor.ledger.facts.decisionOutcome = 'other draft';
    editor.markDirty();
    editor.requests[0].resolve({ summary: { complete: true, facts: 1 } });
    await saving;
    expect(before.facts.decisionOutcome).toBe('rejected');
    expect(editor.state.template.document.docId).toBe('other');
    expect(editor.state.template.facts.decisionOutcome).toBe('');
    expect(editor.state.summary).toEqual({ complete: false, facts: 3 });
    expect(editor.ledger.facts.decisionOutcome).toBe('other draft');
    expect(editor.state.dirty).toBe(true);
    expect(editor.state.sets[0].documents[0].summary.complete).toBe(true);
    expect(editor.state.sets[1].documents[0].summary.complete).toBe(false);
});

test('a successful unchanged save clears dirty state and reports saved gold progress', async () => {
    const editor = createEditor();
    editor.ledger.reviewedCategories = ['amounts', 'oibs', 'dates', 'filingNumbers', 'decisionOutcome', 'tables'];
    editor.markDirty();
    const saving = editor.save(true);
    editor.requests[0].resolve({ summary: { complete: true, facts: 0 } });
    await saving;
    expect(editor.state.dirty).toBe(false);
    expect(editor.state.drafts.size).toBe(0);
    expect(editor.get('state-chip').textContent).toBe('Complete');
    expect(editor.get('gold-progress').textContent).toBe('1 / 2 documents complete');
});

test('switching documents preserves the unsaved draft and category reviews for the session', async () => {
    const editor = createEditor();
    editor.ledger.facts.decisionOutcome = 'odbija se';
    editor.ledger.reviewedCategories = ['decisionOutcome'];
    editor.markDirty();
    const leaving = editor.loadTemplate('set-a', 'doc-b.json');
    editor.requests[0].resolve({ template: editor.template('doc-b'), summary: editor.summary });
    await leaving;
    expect(editor.state.dirty).toBe(false);
    const event = { preventDefault: jest.fn() };
    editor.unloadHandlers.beforeunload(event);
    expect(event.preventDefault).toHaveBeenCalled();
    const returning = editor.loadTemplate('set-a', 'doc-a.json');
    editor.requests[1].resolve({ template: editor.template('doc-a'), summary: editor.summary });
    await returning;
    expect(editor.ledger.facts.decisionOutcome).toBe('odbija se');
    expect(editor.ledger.reviewedCategories).toEqual(['decisionOutcome']);
    expect(editor.state.dirty).toBe(true);
    expect(editor.get('status').textContent).toContain('Unsaved draft restored');
});

test('out-of-order template loads cannot replace the latest chosen document', async () => {
    const editor = createEditor();
    const first = editor.loadTemplate('set-a', 'doc-b.json');
    const second = editor.loadTemplate('set-b', 'doc-a.json');
    editor.requests[1].resolve({ template: editor.template('newest'), summary: editor.summary });
    await second;
    editor.requests[0].resolve({ template: editor.template('stale'), summary: editor.summary });
    await first;
    expect(editor.state.setId).toBe('set-b');
    expect(editor.state.template.document.docId).toBe('newest');
    expect(editor.state.loading).toBe(false);
    expect(editor.get('back-to-lab').href).toBe('/?goldSet=set-b');
});

test('failed saves keep the draft and release busy controls', async () => {
    const editor = createEditor();
    editor.ledger.facts.decisionOutcome = 'odbija se';
    editor.markDirty();
    const saving = editor.save(false);
    editor.requests[0].reject(new Error('Disk full'));
    await saving;
    expect(editor.state.dirty).toBe(true);
    expect(editor.state.drafts.get('set-a/doc-a.json').facts.decisionOutcome).toBe('odbija se');
    expect(editor.get('save').disabled).toBe(false);
    expect(editor.get('set').disabled).toBe(false);
    expect(editor.get('status').textContent).toContain('your draft is still unsaved');
});

test('a suggestion failure from an inactive document does not replace the current status or errors', async () => {
    const editor = createEditor();
    const suggesting = editor.requestSuggestions();
    const loading = editor.loadTemplate('set-a', 'doc-b.json');
    editor.requests[1].resolve({ template: editor.template('doc-b'), summary: editor.summary });
    await loading;
    editor.requests[0].reject(new Error('Old request failed'));
    await suggesting;
    expect(editor.get('suggest-status').textContent).toBe('');
    expect(editor.get('errors').hidden).toBe(true);
    expect(editor.get('status').textContent).toBe('Editing doc-b');
    expect(editor.get('suggest').disabled).toBe(false);
});

test('a replacement suggestion arriving off-screen is not marked as already applied', async () => {
    const editor = createEditor();
    const original = suggestionFor('rejected');
    Object.assign(editor.state, { suggestion: original, suggestionKey: 'set-a/doc-a.json' });
    editor.state.suggestions.set('set-a/doc-a.json', original);
    editor.applySuggestions();
    expect(editor.state.suggestionApplied).toBe(true);
    const suggesting = editor.requestSuggestions();
    const leaving = editor.loadTemplate('set-a', 'doc-b.json');
    editor.requests[1].resolve({ template: editor.template('doc-b'), summary: editor.summary });
    await leaving;
    editor.requests[0].resolve(suggestionFor('upheld'));
    await suggesting;
    const returning = editor.loadTemplate('set-a', 'doc-a.json');
    editor.requests[2].resolve({ template: editor.template('doc-a'), summary: editor.summary });
    await returning;
    expect(editor.ledger.facts.decisionOutcome).toBe('rejected');
    expect(editor.state.suggestion.facts.decisionOutcome).toBe('upheld');
    expect(editor.state.suggestionApplied).toBe(false);
    expect(editor.get('apply-suggestions').disabled).toBe(false);
});
