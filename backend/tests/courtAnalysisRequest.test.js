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
});
