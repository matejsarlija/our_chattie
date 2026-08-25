const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDataDir = () => {
    const dir = path.join(os.tmpdir(), `reasoning-settings-${process.pid}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};

describe('reasoningSettings resolvers', () => {
    let dataDir;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        dataDir = tmpDataDir();
        process.env.ANALYSIS_DATA_DIR = dataDir;
        delete process.env.REASONING_RERANK;
        delete process.env.REASONING_PLANNER;
        delete process.env.REASONING_FOLLOWUP;
    });

    afterEach(() => {
        process.env = originalEnv;
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function writeSettingsFile(content) {
        fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(content), 'utf8');
    }

    test('defaults when nothing persisted and no env', () => {
        const s = require('../helpers/reasoningSettings');
        expect(s.resolveReasoningRerankMode()).toBe('auto');
        expect(s.resolveReasoningPlanner()).toBe('on');
        expect(s.resolveReasoningFollowUp()).toBe('on');
    });

    test('persisted setting wins over env (dashboard is source of truth)', () => {
        writeSettingsFile({ reasoningRerankMode: 'force', reasoningPlanner: 'off' });
        process.env.REASONING_RERANK = 'off';
        process.env.REASONING_PLANNER = 'on';

        const s = require('../helpers/reasoningSettings');
        expect(s.resolveReasoningRerankMode()).toBe('force');
        expect(s.resolveReasoningPlanner()).toBe('off');
    });

    test('env is the fallback when nothing persisted', () => {
        process.env.REASONING_RERANK = 'off';
        process.env.REASONING_FOLLOWUP = 'off';
        const s = require('../helpers/reasoningSettings');
        expect(s.resolveReasoningRerankMode()).toBe('off');
        expect(s.resolveReasoningFollowUp()).toBe('off');
    });

    test('env force resolves to force for planner/follow-up', () => {
        process.env.REASONING_PLANNER = 'force';
        process.env.REASONING_FOLLOWUP = 'force';
        const s = require('../helpers/reasoningSettings');
        expect(s.resolveReasoningPlanner()).toBe('force');
        expect(s.resolveReasoningFollowUp()).toBe('force');
    });

    test('invalid persisted values fall through to env then defaults', () => {
        writeSettingsFile({ reasoningRerankMode: 'yolo', reasoningPlanner: 'maybe' });
        const s = require('../helpers/reasoningSettings');
        expect(s.resolveReasoningRerankMode()).toBe('auto');
        expect(s.resolveReasoningPlanner()).toBe('on');
    });

    test('missing/corrupt settings file behaves like defaults', () => {
        writeSettingsFile('not-json{');
        const s = require('../helpers/reasoningSettings');
        expect(s.resolveReasoningRerankMode()).toBe('auto');
    });
});

describe('localStore settings validation for reasoning switches', () => {
    const { createLocalStore } = require('../services/localStore');

    function freshStore() {
        const dir = tmpDataDir();
        const store = createLocalStore(dir);
        return { store, dir };
    }

    test('getSettings returns reasoning fields with defaults', async () => {
        const { store } = freshStore();
        const settings = await store.getSettings();
        expect(settings).toEqual(expect.objectContaining({
            reasoningRerankMode: 'auto',
            reasoningPlanner: 'on',
            reasoningFollowUp: 'on',
        }));
    });

    test('updateSettings persists valid reasoning values', async () => {
        const { store } = freshStore();
        await store.updateSettings({ reasoningRerankMode: 'force', reasoningPlanner: 'off', reasoningFollowUp: 'off' });
        expect(await store.getSettings()).toEqual(expect.objectContaining({
            reasoningRerankMode: 'force',
            reasoningPlanner: 'off',
            reasoningFollowUp: 'off',
        }));
    });

    test.each([
        ['reasoningRerankMode', 'always'],
        ['reasoningPlanner', 'maybe'],
        ['reasoningFollowUp', 'true'],
    ])('rejects invalid %s with 400', async (key, value) => {
        const { store } = freshStore();
        await expect(store.updateSettings({ [key]: value })).rejects.toMatchObject({ statusCode: 400 });
    });
});
