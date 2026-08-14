const {
  friendlyAnalysisErrorMessage,
  describeStage,
  STAGE_LABELS,
} = require('../helpers/friendlyAnalysisError');

jest.mock('../helpers/geminiPlan', () => ({ resolveGeminiPlan: () => 'free' }));

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

  test('detects quota exhaustion (daily limit)', () => {
    const message = friendlyAnalysisErrorMessage(new Error('Resource has been exhausted (quota)'));
    expect(message).toContain('Dnevni limit AI analize je iscrpljen');
  });

  test('detects per-day quota exhaustion as daily limit', () => {
    const message = friendlyAnalysisErrorMessage(new Error('429 Quota exceeded for quota metric requests_per_day'));
    expect(message).toContain('Dnevni limit AI analize je iscrpljen');
  });

  test('presents a transient rate-limit burst as the daily limit on the free tier', () => {
    const message = friendlyAnalysisErrorMessage(new Error('429 rate limit exceeded, retry later'));
    expect(message).toContain('Dnevni limit AI analize je iscrpljen');
  });

  test('presents a transient rate-limit burst as a retryable overload on a paid key', () => {
    const message = friendlyAnalysisErrorMessage(new Error('429 rate limit exceeded, retry later'), { plan: 'paid' });
    expect(message).toContain('preopterećen (privremeno ograničenje učestalosti zahtjeva)');
    expect(message).not.toContain('Dnevni limit AI analize je iscrpljen');
  });

  test('treats a bare 429 as a transient burst on a paid key, not daily quota', () => {
    const message = friendlyAnalysisErrorMessage(new Error('429 Too Many Requests'), { plan: 'paid' });
    expect(message).toContain('preopterećen');
    expect(message).not.toContain('Dnevni limit');
  });

  test('does not claim the daily limit for a timeout on a paid key', () => {
    const message = friendlyAnalysisErrorMessage(new Error('DeadlineExceeded: timed out'), { plan: 'paid' });
    expect(message).toContain('premašio dopušteno vrijeme čekanja');
    expect(message).not.toContain('Dnevni limit AI analize je iscrpljen');
  });

  test('presents the Gemini fail-fast timeout as the daily limit on the free tier', () => {
    const message = friendlyAnalysisErrorMessage({
      name: 'AbortError',
      message: 'Gemini request timed out after 30000ms',
    });
    expect(message).toContain('Dnevni limit AI analize je iscrpljen');
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
