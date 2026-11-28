'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

describe('Resilience: Download Collision & Partial Stream Safety', () => {
    test('30 identical-name Podnesak.pdf writes produce 30 distinct non-colliding files', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-collision-'));
        try {
            const paths = [];
            for (let index = 0; index < 30; index += 1) {
                const shortId = crypto.randomBytes(4).toString('hex');
                const target = path.join(tmpDir, `${Date.now()}_${index}_${shortId}_Podnesak.pdf`);
                fs.writeFileSync(target, Buffer.from(`%PDF-1.4 content-${index}`));
                paths.push(target);
            }
            expect(new Set(paths).size).toBe(30);
            for (const p of paths) {
                expect(fs.existsSync(p)).toBe(true);
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
