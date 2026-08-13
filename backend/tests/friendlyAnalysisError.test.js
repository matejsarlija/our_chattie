const {
  friendlyAnalysisErrorMessage,
  describeStage,
  STAGE_LABELS,
} = require('../helpers/friendlyAnalysisError');

describe('friendlyAnalysisErrorMessage', () => {
  test('defaults to a neutral stage message and keeps the raw reason when no pattern matches', () => {
    const message = friendlyAnalysisErrorMessage(new Error('boom'));
    expect(message).toContain('Analiza nije uspjela tijekom faze obrade zahtjeva.');
    expect(message).toContain('boom');
  });

  test('mentions the failing stage when provided', () => {
    const message = friendlyAnalysisErrorMessage(new Error('boom'), { stage: 'reasoning' });
    expect(message).toContain('tijekom faze analize i sintetiziranja izvješća');
  });

  test('uses a neutral stage label for unknown stages', () => {
    expect(friendlyAnalysisErrorMessage(new Error('x'), { stage: 'mystery' })).toContain('obrade zahtjeva');
  });

  test('detects no-results conditions with a plain message', () => {
    const message = friendlyAnalysisErrorMessage(new Error('No results with documents found for the query'));
    expect(message).toContain('Nije pronađen nijedan predmet s dostupnim dokumentima');
  });

  test('detects quota exhaustion', () => {
    const message = friendlyAnalysisErrorMessage(new Error('Resource has been exhausted (quota)'));
    expect(message).toContain('Dnevni limit AI analize je iscrpljen');
  });

  test('detects quota from 429-style errors', () => {
    const message = friendlyAnalysisErrorMessage(new Error('rate limit exceeded 429'));
    expect(message).toContain('Dnevni limit AI analize je iscrpljen');
  });

  test('detects timeout errors', () => {
    const message = friendlyAnalysisErrorMessage(new Error('DeadlineExceeded: timed out'));
    expect(message).toContain('premašio dopušteno vrijeme čekanja');
  });

  test('detects abort/timeout from the Gemini fail-fast guard and hints at the free-tier quota', () => {
    const message = friendlyAnalysisErrorMessage({
      name: 'AbortError',
      message: 'Gemini request timed out after 30000ms',
    });
    expect(message).toContain('premašio dopušteno vrijeme čekanja');
    expect(message).toContain('besplatnom AI planu');
  });

  test('appends the partial-results notice when hasPartial is true', () => {
    const message = friendlyAnalysisErrorMessage(new Error('boom'), { stage: 'reasoning', hasPartial: true });
    expect(message).toContain('Djelomični rezultati su sačuvani i prikazani su niže');
  });

  test('describeStage returns Croatian labels for known stages', () => {
    expect(STAGE_LABELS).toEqual(expect.objectContaining({
      discovering: expect.any(String),
      grouping: expect.any(String),
      downloading: expect.any(String),
      extracting: expect.any(String),
      reasoning: expect.any(String),
      verifying: expect.any(String),
    }));
    expect(describeStage('downloading')).toBe(STAGE_LABELS.downloading);
    expect(describeStage('nope')).toContain('obrade zahtjeva');
  });
});
