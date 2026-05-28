const { completeAnalysisRun, getAnalysisRunFull } = require('../services/analysisStore');

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

describe('analysisStore.completeAnalysisRun', () => {
  function buildCompletionSupabaseStub(updateResults) {
    const update = jest.fn();
    const eq = jest.fn();

    updateResults.forEach((result) => {
      eq.mockResolvedValueOnce(result);
    });

    update.mockReturnValue({ eq });

    return {
      update,
      eq,
      supabase: {
        from: jest.fn((table) => {
          if (table !== 'analysis_runs') {
            throw new Error(`Unexpected table: ${table}`);
          }

          return { update };
        }),
      },
    };
  }

  test('persists markdown and structured result_json on completion', async () => {
    const resultJson = {
      comparativeAnalysis: 'Sažetak',
      discoverySummary: {
        reasoningScope: 'single-cluster',
        reasoningClusterId: 'ST-100/2023',
      },
      processedCases: [
        {
          groupMetadata: {
            clusterId: 'ST-100/2023',
            selectedForReasoning: true,
          },
        },
      ],
    };
    const { supabase, update, eq } = buildCompletionSupabaseStub([{ error: null }]);

    await completeAnalysisRun({
      supabase,
      analysisId: 'run-1',
      resultText: 'Sažetak',
      resultJson,
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'done',
      result_text: 'Sažetak',
      result_format: 'markdown',
      result_json: resultJson,
    }));
    expect(eq).toHaveBeenCalledWith('id', 'run-1');
  });

  test('falls back to markdown-only completion when result_json column is unavailable', async () => {
    const { supabase, update } = buildCompletionSupabaseStub([
      { error: { message: 'column "result_json" of relation "analysis_runs" does not exist' } },
      { error: null },
    ]);

    await completeAnalysisRun({
      supabase,
      analysisId: 'run-legacy',
      resultText: 'Sažetak',
      resultJson: { discoverySummary: { reasoningScope: 'single-cluster' } },
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      result_json: { discoverySummary: { reasoningScope: 'single-cluster' } },
    }));
    expect(update).toHaveBeenNthCalledWith(2, expect.not.objectContaining({
      result_json: expect.anything(),
    }));
  });
});
