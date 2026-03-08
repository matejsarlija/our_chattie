const { createAnalysisRun } = require('../services/analysisStore');

describe('createAnalysisRun', () => {
    let mockSupabase;

    beforeEach(() => {
        mockSupabase = {
            from: jest.fn().mockReturnThis(),
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn(),
        };
    });

    test('inserts typed query fields when available', async () => {
        // Setup happy path
        mockSupabase.single.mockResolvedValue({ data: { id: 1 }, error: null });

        await createAnalysisRun({
            supabase: mockSupabase,
            userId: 'user1',
            oib: '123',
            queryType: 'case_number',
            queryValue: 'ST-1/23',
            status: 'running',
        });

        expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
            query_type: 'case_number',
            query_value: 'ST-1/23',
            oib: '123'
        }));
    });

    test('falls back to legacy insert if typed columns missing', async () => {
        // First call fails with column error
        mockSupabase.single
            .mockResolvedValueOnce({ data: null, error: { message: 'column "query_type" of relation "analysis_runs" does not exist' } })
            .mockResolvedValueOnce({ data: { id: 1 }, error: null });

        await createAnalysisRun({
            supabase: mockSupabase,
            userId: 'user1',
            oib: '123',
            queryType: 'case_number',
            queryValue: 'ST-1/23',
        });

        // First attempt with typed fields
        expect(mockSupabase.insert).toHaveBeenNthCalledWith(1, expect.objectContaining({
            query_type: 'case_number',
            query_value: 'ST-1/23'
        }));

        // Second attempt without typed fields
        expect(mockSupabase.insert).toHaveBeenNthCalledWith(2, expect.objectContaining({
            oib: '123',
            // query_type/value should be absent
        }));
        
        // Check strict absence in second call
        const secondCallArg = mockSupabase.insert.mock.calls[1][0];
        expect(secondCallArg).not.toHaveProperty('query_type');
        expect(secondCallArg).not.toHaveProperty('query_value');
    });
});
