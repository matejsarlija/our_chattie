'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { persistVerifiedTranscript, runStageT } = require('../scripts/benchmark-pdf-engines');

test('an ineligible Stage T rerun preserves an existing verified canonical transcript', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-transcript-'));
    const fixturePath = path.join(root, 'scan.json');
    const verifiedFixture = {
        canonicalTranscript: { text: 'Verified prior text. '.repeat(10), verified: true },
        stageA: { status: 'ready', reason: null },
    };
    fs.writeFileSync(fixturePath, JSON.stringify(verifiedFixture));

    const failedRerun = {
        canonicalTranscript: { text: 'partial output', verified: false },
        parserRuns: { 'local-raster': { status: 'parser-failure', text: 'partial output' } },
        stageA: { status: 'aborted', reason: 'canonical-parser-text-under-100-characters' },
    };

    try {
        expect(persistVerifiedTranscript(fixturePath, failedRerun)).toBe(false);
        expect(JSON.parse(fs.readFileSync(fixturePath, 'utf8'))).toEqual(verifiedFixture);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a later parser cost abort preserves the prior fixture after canonical OCR succeeds', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-t-parser-abort-'));
    const transcriptRoot = path.join(root, 'transcripts');
    const outputDir = path.join(root, 'run');
    fs.mkdirSync(outputDir, { recursive: true });
    const docId = '6:Prilog St-2_2013-1208-1 - Račun Adria Rijeka 2-2025 (1).pdf';
    const prior = {
        canonicalTranscript: { sourceArm: 'local-raster', text: 'Prior verified transcript. '.repeat(8), verified: true },
        stageA: { status: 'ready', reason: null },
        marker: 'preserve-me',
    };
    const fixturePath = path.join(transcriptRoot, `${docId}.json`);
    fs.mkdirSync(transcriptRoot, { recursive: true });
    fs.writeFileSync(fixturePath, JSON.stringify(prior));
    const localRaster = jest.fn(async () => ({
        text: 'New canonical raster text. '.repeat(8),
        cost: 0,
        errors: [],
        pages: 1,
    }));
    const cloudflare = jest.fn(async () => ({
        text: '',
        cost: null,
        costIncomplete: true,
        errors: ['simulated body timeout'],
        pages: 1,
    }));
    const mistral = jest.fn();

    try {
        const report = await runStageT({
            args: { approved: true, 'max-cost': '0.50' },
            outputDir,
            transcriptRoot,
            registry: {
                'local-raster': localRaster,
                'local-text': jest.fn(),
                'or-cloudflare': cloudflare,
                'or-mistral-ocr': mistral,
            },
        });

        expect(localRaster).toHaveBeenCalledTimes(1);
        expect(cloudflare).toHaveBeenCalledTimes(1);
        expect(mistral).not.toHaveBeenCalled();
        expect(report.aborted).toMatchObject({ reason: 'cost-unknown' });
        expect(report.documents[0]).toMatchObject({ stageA: 'aborted', fixtureWritten: false });
        expect(report.documents[0].parserRuns['or-cloudflare'].errors).toContain('simulated body timeout');
        expect(JSON.parse(fs.readFileSync(fixturePath, 'utf8'))).toEqual(prior);
        const savedReport = JSON.parse(fs.readFileSync(path.join(outputDir, 'stage-t-report.json'), 'utf8'));
        expect(savedReport.documents[0].parserRuns['or-cloudflare'].errors).toContain('simulated body timeout');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Stage T supports --canonical-only and --skip-existing for targeted corpus expansion', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-t-canonical-only-'));
    const transcriptRoot = path.join(root, 'transcripts');
    const outputDir = path.join(root, 'run');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(transcriptRoot, { recursive: true });
    const cachedDocId = '1:Podnesak.pdf';
    const freshDocId = '10:Troškovnik.pdf';
    fs.writeFileSync(path.join(transcriptRoot, `${cachedDocId}.json`), JSON.stringify({
        canonicalTranscript: { sourceArm: 'local-text', text: 'Already verified local transcript. '.repeat(6), charCount: 210, verified: true },
        stageA: { status: 'ready', reason: null },
    }));
    const localText = jest.fn(async () => ({
        text: 'Freshly extracted local text. '.repeat(8),
        cost: 0,
        errors: [],
        pages: 2,
    }));
    const cloudflare = jest.fn();
    const mistral = jest.fn();

    try {
        const report = await runStageT({
            args: {
                approved: true,
                'max-cost': '0',
                'doc-id': [cachedDocId, freshDocId],
                'skip-existing': true,
                'canonical-only': true,
            },
            outputDir,
            transcriptRoot,
            registry: {
                'local-text': localText,
                'local-raster': jest.fn(),
                'or-cloudflare': cloudflare,
                'or-mistral-ocr': mistral,
            },
        });

        expect(localText).toHaveBeenCalledTimes(1);
        expect(cloudflare).not.toHaveBeenCalled();
        expect(mistral).not.toHaveBeenCalled();
        expect(report.documents).toEqual([
            expect.objectContaining({ docId: cachedDocId, status: 'cached', stageA: 'ready', fixtureWritten: false }),
            expect.objectContaining({ docId: freshDocId, canonicalArm: 'local-text', stageA: 'ready', fixtureWritten: true }),
        ]);
        expect(fs.existsSync(path.join(transcriptRoot, `${freshDocId}.json`))).toBe(true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
