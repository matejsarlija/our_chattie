const path = require('path');
const os = require('os');
const fs = require('fs');
const { createLocalStore } = require('../services/localStore');

describe('localStore lawyer preferences', () => {
    let dataDir;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-settings-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('does not expose retired reasoning switches from existing settings files', () => {
        fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
            reasoningRerankMode: 'force',
            reasoningPlanner: 'off',
            reasoningFollowUp: 'off',
            defaultScanDepth: 'full',
            uiPreferences: { compact: true },
        }));

        expect(createLocalStore({ dataDir }).getSettings()).toEqual({
            defaultScanDepth: 'full',
            uiPreferences: { compact: true },
        });
    });

    test('persists supported lawyer preferences and rejects invalid scan depths', async () => {
        const store = createLocalStore({ dataDir });
        await store.updateSettings({
            defaultScanDepth: 'full',
            uiPreferences: { compact: true },
        });

        expect(store.getSettings()).toEqual({
            defaultScanDepth: 'full',
            uiPreferences: { compact: true },
        });
        await expect(store.updateSettings({ defaultScanDepth: 'unbounded' }))
            .rejects.toThrow('Invalid defaultScanDepth');
    });
});
