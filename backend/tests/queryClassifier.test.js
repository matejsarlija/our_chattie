const { classifyQueryType } = require('../court-analysis/utils/queryClassifier');

describe('queryClassifier', () => {
  test('classifies 11-digit value as oib', () => {
    expect(classifyQueryType('66124057408')).toBe('oib');
  });

  test('classifies Croatian case number as case_number', () => {
    expect(classifyQueryType('St-357/2013')).toBe('case_number');
    expect(classifyQueryType('st - 357 / 2013')).toBe('case_number');
  });

  test('defaults to text for non-oib non-case-number input', () => {
    expect(classifyQueryType('adriatic osiguranje')).toBe('text');
  });
});
