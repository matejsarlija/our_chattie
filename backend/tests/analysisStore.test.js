const { getAnalysisRunFull } = require('../services/analysisStore');

function buildSupabaseStub({ run, events }) {
  return {
    from: jest.fn((table) => {
      if (table === 'analysis_runs') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(async () => ({ data: run, error: null })),
            })),
          })),
        };
      }

      if (table === 'analysis_events') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                order: jest.fn(async () => ({ data: events, error: null })),
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe('analysisStore.getAnalysisRunFull', () => {
  test('returns run and events payload', async () => {
    const supabase = buildSupabaseStub({
      run: { id: 'r1', status: 'running' },
      events: [{ id: 'e1', analysis_id: 'r1', event_type: 'starting' }],
    });

    const result = await getAnalysisRunFull({ supabase, id: 'r1' });

    expect(result).toEqual({
      run: { id: 'r1', status: 'running' },
      events: [{ id: 'e1', analysis_id: 'r1', event_type: 'starting' }],
    });
  });

  test('throws when run lookup fails', async () => {
    const supabase = {
      from: jest.fn((table) => {
        if (table === 'analysis_runs') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(async () => ({ data: null, error: { message: 'not found' } })),
              })),
            })),
          };
        }

        if (table === 'analysis_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({
                  order: jest.fn(async () => ({ data: [], error: null })),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(getAnalysisRunFull({ supabase, id: 'missing' })).rejects.toThrow('Analysis run not found');
  });
});
