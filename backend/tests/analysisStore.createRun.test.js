const { createAnalysisRun } = require('../services/analysisStore');

function createInsertChain(result) {
  return {
    select: jest.fn(() => ({
      single: jest.fn(async () => result),
    })),
  };
}

describe('analysisStore.createAnalysisRun', () => {
  test('persists typed query fields when available', async () => {
    const insert = jest.fn(() => createInsertChain({ data: { id: 'r1' }, error: null }));
    const supabase = {
      from: jest.fn(() => ({
        insert,
      })),
    };

    await createAnalysisRun({
      supabase,
      userId: 'u1',
      oib: '66124057408',
      queryType: 'oib',
      queryValue: '66124057408',
      status: 'running',
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'u1',
      oib: '66124057408',
      query_type: 'oib',
      query_value: '66124057408',
      status: 'running',
    }));
  });

  test('falls back to legacy insert when typed columns are unavailable', async () => {
    const insert = jest
      .fn()
      .mockImplementationOnce(() => createInsertChain({
        data: null,
        error: { message: 'column "query_type" does not exist' },
      }))
      .mockImplementationOnce(() => createInsertChain({
        data: { id: 'r2' },
        error: null,
      }));

    const supabase = {
      from: jest.fn(() => ({
        insert,
      })),
    };

    const result = await createAnalysisRun({
      supabase,
      userId: 'u1',
      oib: 'St-357/2013',
      queryType: 'case_number',
      queryValue: 'St-357/2013',
      status: 'running',
    });

    expect(result).toEqual({ id: 'r2' });
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toEqual(expect.objectContaining({
      query_type: 'case_number',
      query_value: 'St-357/2013',
    }));
    expect(insert.mock.calls[1][0]).toEqual(expect.not.objectContaining({
      query_type: expect.anything(),
      query_value: expect.anything(),
    }));
  });
});
