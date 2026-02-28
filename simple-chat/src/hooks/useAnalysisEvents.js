import { useMemo } from 'react';

const STEP_ORDER = [
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
];

const STAGE_LABELS = {
  queued: 'Zaprimljeno',
  starting: 'Pokretanje',
  discovering: 'Pronalaženje',
  grouping: 'Grupiranje',
  downloading: 'Preuzimanje',
  extracting: 'Obrada dokumenata',
  chunking: 'Segmentiranje',
  retrieving: 'Dohvat dokaza',
  reasoning: 'AI analiza',
  verifying: 'Provjera',
  complete: 'Završeno',
  error: 'Greška',
};

const LEGACY_TO_CANONICAL = {
  fetching: 'downloading',
  downloading: 'downloading',
  scraping: 'discovering',
  processing_setup: 'grouping',
  unzipping: 'extracting',
  analyzing: 'reasoning',
  comparing: 'reasoning',
  visualizing: 'reasoning',
};

const normalizeEventType = (event) => {
  const eventType = String(event?.event_type || '').toLowerCase();
  if (STEP_ORDER.includes(eventType) || eventType === 'error') return eventType;
  if (LEGACY_TO_CANONICAL[eventType]) return LEGACY_TO_CANONICAL[eventType];

  const message = String(event?.message || '').toLowerCase();
  if (message.includes('preuzim')) return 'downloading';
  if (message.includes('grup')) return 'grouping';
  if (message.includes('dokaz') || message.includes('retriev')) return 'retrieving';
  if (message.includes('provjer') || message.includes('verif')) return 'verifying';
  if (message.includes('analiz') || message.includes('uspored')) return 'reasoning';
  if (message.includes('završ')) return 'complete';
  if (message.includes('greš') || message.includes('error')) return 'error';

  return 'starting';
};

export function useAnalysisEvents(events) {
  return useMemo(() => {
    const normalized = (events || []).map((event) => {
      const stage = normalizeEventType(event);
      return {
        id: event.id,
        stage,
        stageLabel: STAGE_LABELS[stage] || stage,
        message: event.message || 'Sustav je obradio događaj.',
        createdAt: event.created_at,
        progress: event.metadata?.progress,
      };
    });

    const reachedStages = new Set(normalized.map((event) => event.stage));
    const current = normalized[normalized.length - 1]?.stage || 'queued';

    const stages = STEP_ORDER.map((key) => {
      const currentIndex = STEP_ORDER.indexOf(current);
      const stageIndex = STEP_ORDER.indexOf(key);
      const completed = reachedStages.has(key) || stageIndex < currentIndex;
      const active = key === current;

      return {
        key,
        label: STAGE_LABELS[key] || key,
        completed,
        active,
      };
    });

    return {
      timeline: normalized,
      stages,
      current,
      isErrored: normalized.some((event) => event.stage === 'error'),
    };
  }, [events]);
}
