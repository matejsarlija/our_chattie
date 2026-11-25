// The agent facade emits through the structured logger and shares its level threshold.
describe('logger agent facade', () => {
    const OLD_ENV = process.env.LOG_LEVEL;
    let logger;
    let stdout;
    let stderr;

    beforeEach(() => {
        jest.resetModules();
    });

    afterEach(() => {
        if (OLD_ENV === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = OLD_ENV;
        jest.restoreAllMocks();
    });

    function loadFresh() {
        logger = require('../services/logger');
        stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    }

    test('default level emits agent info, warnings, and errors as JSON lines', () => {
        delete process.env.LOG_LEVEL;
        loadFresh();
        logger.agent.log('[Analyzer] routine trace');
        logger.agent.warn('[Analyzer] a warning');
        logger.agent.error('[Analyzer] an error');
        expect(stdout).toHaveBeenCalledTimes(2);
        expect(stderr).toHaveBeenCalledTimes(1);
        expect(stdout.mock.calls[0][0]).toContain('"scope":"agent.analyzer"');
    });

    test('LOG_LEVEL=warn suppresses info but retains warnings and errors', () => {
        process.env.LOG_LEVEL = 'warn';
        loadFresh();
        logger.agent.log('routine trace');
        logger.agent.warn('a warning');
        logger.agent.error('an error');
        expect(stdout).toHaveBeenCalledTimes(1);
        expect(stderr).toHaveBeenCalledTimes(1);
    });

    test('LOG_LEVEL=error suppresses info and warnings', () => {
        process.env.LOG_LEVEL = 'error';
        loadFresh();
        logger.agent.log('routine trace');
        logger.agent.warn('a warning');
        logger.agent.error('an error');
        expect(stdout).not.toHaveBeenCalled();
        expect(stderr).toHaveBeenCalledTimes(1);
    });

    test('trace level can be enabled explicitly', () => {
        process.env.LOG_LEVEL = 'trace';
        loadFresh();
        logger.trace('test', 'trace line');
        expect(stdout).toHaveBeenCalledTimes(1);
    });
});
