const { buildStageCounterEvent } = require('../helpers/analysisStage');

describe('buildStageCounterEvent', () => {
  test('builds a discovering announcement with zero progress', () => {
    const event = buildStageCounterEvent({
      stage: 'discovering',
      done: 0,
      total: 41,
      unit: 'objava',
    });

    expect(event).toEqual(expect.objectContaining({
      step: 'discovering',
      kind: 'stage-counter',
    }));
    expect(event.metadata).toEqual({
      kind: 'stage-counter',
      stage: 'discovering',
      done: 0,
      failed: 0,
      total: 41,
      unit: 'objava',
    });
  });

  test('carries download progress with units intact', () => {
    const event = buildStageCounterEvent({
      stage: 'downloading',
      done: 3,
      failed: 1,
      total: 7,
      unit: 'datoteka',
    });

    expect(event.metadata).toEqual(expect.objectContaining({
      done: 3,
      failed: 1,
      total: 7,
      unit: 'datoteka',
    }));
  });

  test('defaults failed to zero when absent', () => {
    const event = buildStageCounterEvent({
      stage: 'reasoning',
      done: 11,
      total: 23,
      unit: 'dokument',
    });

    expect(event.metadata.failed).toBe(0);
  });

  test('passes null total through as the explicit unknown signal', () => {
    const event = buildStageCounterEvent({
      stage: 'extracting',
      done: 2,
      total: null,
      unit: 'datoteka',
    });

    expect(event.metadata.total).toBeNull();
    expect(event.metadata.done).toBe(2);
  });
});
