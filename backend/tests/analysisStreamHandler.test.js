const EventEmitter = require('events');
const { createAnalysisRunStreamHandler } = require('../helpers/analysisStreamHandler');

describe('analysisStreamHandler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('does not start timers if client disconnects during snapshot emit', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const handler = createAnalysisRunStreamHandler({
      getAnalysisRunFull: jest.fn().mockResolvedValue({
        run: { id: 'r1', status: 'running' },
        events: [],
      }),
      buildSseEvent: jest.fn(() => 'event: snapshot\ndata: {}\n\n'),
      isTerminalStatus: jest.fn(() => false),
      buildCursor: jest.fn(() => null),
      didRunChange: jest.fn(() => false),
      getNewEvents: jest.fn(() => []),
      shouldStartStreamTimers: jest.fn(({ snapshotSent, closed, writableEnded }) => (
        Boolean(snapshotSent) && !closed && !writableEnded
      )),
      streamPollMs: 10,
      heartbeatMs: 10,
    });

    const req = new EventEmitter();
    req.params = { id: 'r1' };
    req.supabase = {};

    const res = {
      writableEnded: false,
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(() => {
        req.emit('close');
        return true;
      }),
      end: jest.fn(() => {
        res.writableEnded = true;
      }),
      status: jest.fn(() => ({ json: jest.fn() })),
    };

    await handler(req, res);

    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
