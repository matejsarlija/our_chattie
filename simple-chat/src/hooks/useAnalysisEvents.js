import { useMemo } from 'react';

const STEP_ORDER = [
  'queued',
  'starting',
  'fetching',
  'extracting',
  'analyzing',
  'comparing',
  'complete',
];

const STAGE_LABELS = {
  queued: 'Zaprimljeno',
  starting: 'Pokretanje',
  fetching: 'Preuzimanje',
  extracting: 'Obrada dokumenata',
  analyzing: 'AI analiza',
  comparing: 'Usporedba',
  complete: 'Završeno',
  error: 'Greška',
};

const normalizeEventType = (event) => {
  const eventType = String(event?.event_type || '').toLowerCase();
  if (STEP_ORDER.includes(eventType) || eventType === 'error') return eventType;

  const message = String(event?.message || '').toLowerCase();
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
