const { normalizeAnalysisProgressEvent } = require('../helpers/analysisStage');

describe('normalizeAnalysisProgressEvent', () => {
  test('maps legacy steps to canonical taxonomy', () => {
    const normalized = normalizeAnalysisProgressEvent({
      step: 'scraping',
      progress: 10,
      message: 'Pretraga',
    });

    expect(normalized.step).toBe('discovering');
    expect(normalized.metadata.originalStep).toBe('scraping');
  });

  test('keeps canonical steps unchanged', () => {
    const normalized = normalizeAnalysisProgressEvent({
      step: 'retrieving',
      progress: 50,
      message: 'Dohvat dokaza',
    });

    expect(normalized.step).toBe('retrieving');
    expect(normalized.metadata).toBeUndefined();
  });

  test('maps known reasoning-stage aliases', () => {
    const normalized = normalizeAnalysisProgressEvent({
      step: 'visualizing',
      progress: 95,
      message: 'Vizualizacija',
    });

    expect(normalized.step).toBe('reasoning');
    expect(normalized.metadata.originalStep).toBe('visualizing');
  });
});
