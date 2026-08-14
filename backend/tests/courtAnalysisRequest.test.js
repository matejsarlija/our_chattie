const { parseCourtAnalysisRequest } = require('../helpers/courtAnalysisRequest');

describe('parseCourtAnalysisRequest', () => {
  test('accepts explicit typed query and options.caseLimit', () => {
    const parsed = parseCourtAnalysisRequest({
      query: { type: 'case_number', value: 'St-357/2013' },
      options: { caseLimit: 3 },
    });

    expect(parsed.query).toEqual({ type: 'case_number', value: 'St-357/2013' });
    expect(parsed.options.caseLimit).toBe(3);
    expect(parsed.searchTerm).toBe('St-357/2013');
  });

  test('maps legacy searchTerm to typed query via classifier', () => {
    const parsed = parseCourtAnalysisRequest({ searchTerm: '66124057408' });

    expect(parsed.query).toEqual({ type: 'oib', value: '66124057408' });
    expect(parsed.options.caseLimit).toBe(5);
  });

  test('rejects invalid query.type with 400 metadata', () => {
    expect(() =>
      parseCourtAnalysisRequest({
        query: { type: 'unknown_type', value: '66124057408' },
      }),
    ).toThrow('Invalid query.type');

    try {
      parseCourtAnalysisRequest({
        query: { type: 'unknown_type', value: '66124057408' },
      });
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });

  test('throws 400 when neither query.value nor searchTerm is present', () => {
    try {
      parseCourtAnalysisRequest({});
      throw new Error('Expected parseCourtAnalysisRequest to throw');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/required/i);
    }
  });

  test('clamps caseLimit into supported bounds', () => {
    const low = parseCourtAnalysisRequest({
      searchTerm: '66124057408',
      options: { caseLimit: 0 },
    });
    const high = parseCourtAnalysisRequest({
      searchTerm: '66124057408',
      options: { caseLimit: 99 },
    });

    expect(low.options.caseLimit).toBe(1);
    expect(high.options.caseLimit).toBe(10);
  });

  test('defaults clusterExpansion to null when absent', () => {
    const parsed = parseCourtAnalysisRequest({ searchTerm: '66124057408' });
    expect(parsed.options.clusterExpansion).toBeNull();
  });

  test('coerces options.clusterExpansion booleans and integers', () => {
    const enabled = parseCourtAnalysisRequest({
      searchTerm: '66124057408',
      options: { clusterExpansion: true },
    });
    const explicit = parseCourtAnalysisRequest({
      searchTerm: '66124057408',
      options: { clusterExpansion: { maxPasses: 2 } },
    });
    const numeric = parseCourtAnalysisRequest({
      searchTerm: '66124057408',
      options: { clusterExpansion: 1 },
    });

    expect(enabled.options.clusterExpansion).toEqual({ maxPasses: 2 });
    expect(explicit.options.clusterExpansion).toEqual({ maxPasses: 2 });
    expect(numeric.options.clusterExpansion).toEqual({ maxPasses: 1 });
  });

  test('clamps options.clusterExpansion.maxPasses into supported bounds', () => {
    const zero = parseCourtAnalysisRequest({
      searchTerm: '66124057408',
      options: { clusterExpansion: { maxPasses: 0 } },
    });
    const over = parseCourtAnalysisRequest({
      searchTerm: '66124057408',
      options: { clusterExpansion: { maxPasses: 99 } },
    });

    expect(zero.options.clusterExpansion).toEqual({ maxPasses: 0 });
    expect(over.options.clusterExpansion).toEqual({ maxPasses: 2 });
  });

  test('rejects invalid options.clusterExpansion.maxPasses with 400', () => {
    try {
      parseCourtAnalysisRequest({
        searchTerm: '66124057408',
        options: { clusterExpansion: { maxPasses: 'abc' } },
      });
      throw new Error('Expected parseCourtAnalysisRequest to throw');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/clusterExpansion/);
    }
  });

  test('treats explicit false clusterExpansion as disabled', () => {
    const parsed = parseCourtAnalysisRequest({
      searchTerm: '66124057408',
      options: { clusterExpansion: false },
    });
    expect(parsed.options.clusterExpansion).toBeNull();
  });
});
