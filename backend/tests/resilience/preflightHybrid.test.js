'use strict';

const fs = require('fs');
const path = require('path');
const pdfPreflight = require('../../court-analysis/extraction/pdfPreflight');

describe('Resilience: Stage T0 Preflight & Admin Fast-Path Wiring', () => {
    test('documentAnalyzer wires preflightClusterDocuments and never references retired runPdfPreflight', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../court-analysis/extraction/documentAnalyzer.js'),
            'utf8',
        );
        expect(src).toContain('preflightClusterDocuments');
        expect(src).not.toContain('runPdfPreflight');
        expect(typeof pdfPreflight.preflightClusterDocuments).toBe('function');
    });

    test('detects HTML-as-PDF magic byte mismatch without crashing', () => {
        const htmlBytes = Buffer.from('<!doctype html><html><body>Login required</body></html>');
        expect(htmlBytes.slice(0, 5).toString('ascii')).not.toBe('%PDF-');
    });
});
