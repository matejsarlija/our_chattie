const { normalizeAnalysisProgressEvent } = require('../http/analysisStage');

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
      step: 'comparing',
      progress: 95,
      message: 'Usporedba',
    });

    expect(normalized.step).toBe('reasoning');
    expect(normalized.metadata.originalStep).toBe('comparing');
  });

  test('recognizes preflight and OCR lanes', () => {
    expect(normalizeAnalysisProgressEvent({ step: 'preflight' }).step).toBe('preflight');
    const ocr = normalizeAnalysisProgressEvent({ step: 'ocr_retry' });
    expect(ocr.step).toBe('ocr');
    expect(ocr.metadata.originalStep).toBe('ocr_retry');
  });
});
