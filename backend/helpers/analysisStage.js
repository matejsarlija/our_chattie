const CANONICAL_STAGES = new Set([
  'queued',
  'starting',
  'discovering',
  'grouping',
  'downloading',
  'extracting',
  'chunking',
  'retrieving',
  'reasoning',
  'verifying',
  'complete',
  'error',
]);

const LEGACY_TO_CANONICAL = {
  scraping: 'discovering',
  processing_setup: 'grouping',
  processing_case: 'grouping',
  enriching: 'grouping',
  downloading: 'downloading',
  unzipping: 'extracting',
  fetching: 'downloading',
  analyzing: 'reasoning',
  comparing: 'reasoning',
  visualizing: 'reasoning',
};

function normalizeAnalysisProgressEvent(event) {
  const payload = event && typeof event === 'object' ? event : {};
  const rawStep = String(payload.step || '').toLowerCase().trim();

  if (!rawStep) return { ...payload };
  if (CANONICAL_STAGES.has(rawStep)) {
    return { ...payload, step: rawStep };
  }

  const mappedStep = LEGACY_TO_CANONICAL[rawStep] || rawStep;
  if (!CANONICAL_STAGES.has(mappedStep)) {
    return { ...payload, step: rawStep };
  }

  return {
    ...payload,
    step: mappedStep,
    metadata: {
      ...(payload.metadata || {}),
      originalStep: rawStep,
    },
  };
}

module.exports = {
  CANONICAL_STAGES,
  LEGACY_TO_CANONICAL,
  normalizeAnalysisProgressEvent,
};
