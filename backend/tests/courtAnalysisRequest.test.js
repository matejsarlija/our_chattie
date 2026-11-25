const { parseCourtAnalysisRequest } = require('../http/courtAnalysisRequest');

describe('parseCourtAnalysisRequest', () => {
  test('accepts explicit typed query and scan options', () => {
    const parsed = parseCourtAnalysisRequest({
      query: { type: 'case_number', value: 'St-357/2013' },
      options: { scanDepth: 'full', caseLimit: 3, clusterExpansion: true },
    });

    expect(parsed.query).toEqual({ type: 'case_number', value: 'St-357/2013' });
    expect(parsed.options.scanDepth).toBe('full');
    expect(parsed.options).not.toHaveProperty('caseLimit');
    expect(parsed.options).not.toHaveProperty('clusterExpansion');
    expect(parsed.searchTerm).toBe('St-357/2013');
  });

  test('maps legacy searchTerm to typed query via classifier', () => {
    const parsed = parseCourtAnalysisRequest({ searchTerm: '66124057408' });

    expect(parsed.query).toEqual({ type: 'oib', value: '66124057408' });
    expect(parsed.options).not.toHaveProperty('caseLimit');
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


  test('defaults scanDepth to balanced when absent', () => {
    const parsed = parseCourtAnalysisRequest({ searchTerm: '66124057408' });
    expect(parsed.options.scanDepth).toBe('balanced');
  });

  test('accepts balanced and full scanDepth values', () => {
    expect(parseCourtAnalysisRequest({ searchTerm: 'x', options: { scanDepth: 'balanced' } }).options.scanDepth).toBe('balanced');
    expect(parseCourtAnalysisRequest({ searchTerm: 'x', options: { scanDepth: 'full' } }).options.scanDepth).toBe('full');
    expect(parseCourtAnalysisRequest({ searchTerm: 'x', options: { scanDepth: 'FULL' } }).options.scanDepth).toBe('full');
  });

  test('rejects invalid options.scanDepth with 400', () => {
    for (const scanDepth of ['standard', 'deep']) {
      try {
        parseCourtAnalysisRequest({ searchTerm: '66124057408', options: { scanDepth } });
        throw new Error('Expected parseCourtAnalysisRequest to throw');
      } catch (err) {
        expect(err.statusCode).toBe(400);
        expect(err.message).toMatch(/scanDepth/);
      }
    }
  });
});
