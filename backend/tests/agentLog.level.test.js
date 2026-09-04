// agentLog level gating: LOG_LEVEL unset/info preserves today's behavior
// exactly; warn+ suppresses routine .log chatter while .warn/.error stay on.
describe('agentLog LOG_LEVEL gating', () => {
    const OLD_ENV = process.env.LOG_LEVEL;
    let agentLog;
    let logSpy;
    let warnSpy;
    let errorSpy;

    beforeEach(() => {
        jest.resetModules();
    });

    afterEach(() => {
        if (OLD_ENV === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = OLD_ENV;
        jest.restoreAllMocks();
    });

    function loadFresh() {
        agentLog = require('../helpers/agentLog');
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    }

    test('default (LOG_LEVEL unset) behaves identically to today: everything prints', () => {
        delete process.env.LOG_LEVEL;
        loadFresh();
        agentLog.log('routine trace');
        agentLog.warn('a warning');
        agentLog.error('an error');
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    test('LOG_LEVEL=info preserves current behavior', () => {
        process.env.LOG_LEVEL = 'info';
        loadFresh();
        agentLog.log('routine trace');
        expect(logSpy).toHaveBeenCalledTimes(1);
    });

    test('quieter level suppresses .log but .warn/.error still print', () => {
        process.env.LOG_LEVEL = 'warn';
        loadFresh();
        agentLog.log('routine trace');
        agentLog.warn('a warning');
        agentLog.error('an error');
        expect(logSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    test('LOG_LEVEL=error still never silences warn/error', () => {
        process.env.LOG_LEVEL = 'error';
        loadFresh();
        agentLog.log('routine trace');
        agentLog.warn('a warning');
        agentLog.error('an error');
        expect(logSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    test('LOG_LEVEL=debug keeps routine trace on', () => {
        process.env.LOG_LEVEL = 'debug';
        loadFresh();
        agentLog.log('routine trace');
        expect(logSpy).toHaveBeenCalledTimes(1);
    });
});
