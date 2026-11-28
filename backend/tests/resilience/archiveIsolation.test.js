'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { extractArchiveFiles, sanitizeEntryName } = require('../../court-analysis/acquisition/archiveExtractor');

describe('Resilience: Archive Extraction Isolation & Zip-Slip Guard', () => {
    test('extracts zip-slip and corrupt archives safely without escaping destination jail', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-iso-'));
        try {
            expect(sanitizeEntryName('../../evil.txt')).toBeNull();
            expect(sanitizeEntryName('Podnesak.pdf')).toBe('Podnesak.pdf');

            const slipZipPath = path.join(tmpDir, 'slip.zip');
            const zip = new AdmZip();
            zip.addFile('../../evil.txt', Buffer.from('pwned'));
            zip.addFile('Podnesak.pdf', Buffer.from('%PDF-1.4 valid'));
            zip.writeZip(slipZipPath);

            const outDir = path.join(tmpDir, 'extracted');
            fs.mkdirSync(outDir, { recursive: true });
            const res = await extractArchiveFiles({
                filePath: slipZipPath,
                destination: outDir,
                parentMeta: { sourceEntryIndex: 5, entryDate: '2025-02-10' },
            });
            expect(fs.existsSync(path.join(tmpDir, 'evil.txt'))).toBe(false);
            expect((res.extractedFiles || res.extracted || res.files || []).length).toBeGreaterThanOrEqual(1);

            const corruptPath = path.join(tmpDir, 'corrupt.zip');
            fs.writeFileSync(corruptPath, Buffer.from('not-a-zip-archive'));
            const corruptRes = await extractArchiveFiles({ filePath: corruptPath, destination: outDir }).catch(() => ({ status: 'error' }));
            expect(corruptRes.status).toBe('error');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
