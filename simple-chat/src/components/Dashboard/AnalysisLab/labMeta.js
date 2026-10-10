export const LAB_PROFILE_ORDER = [
  'baseline-flat-v1',
  'context-tree-v1',
  'context-tree-summarized-v1',
];

export const LAB_PROFILE_LABELS = {
  'baseline-flat-v1': 'Ravni kontekst',
  'context-tree-v1': 'DAG · bez sažetaka',
  'context-tree-summarized-v1': 'DAG · sa sažecima',
};

export const LAB_PROFILE_TAGS = {
  'context-tree-v1': 'Grupe činjenica',
  'context-tree-summarized-v1': 'Grupe činjenica sa sažecima',
};

export const profileLabel = (profileId) => LAB_PROFILE_LABELS[profileId] || profileId;

export const shortHash = (hash) => {
  if (typeof hash !== 'string' || hash.length < 16) return hash || '-';
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
};

/**
 * Scorecard values: non-applicable metrics and missing values use words rather
 * than unexplained abbreviations or symbols.
 */
export const formatScoreCell = (value) => {
  if (value === 'n/a') return { text: 'Nije primjenjivo', title: 'Ova varijanta ne grupira činjenice po temama' };
  if (value === 'unknown' || value === null || value === undefined) {
    return { text: 'Nepoznato', title: 'Vrijednost nije zabilježena' };
  }
  return { text: String(value), title: undefined };
};

const DELTA_LABELS = {
  'report finding with valid citations': 'nalaza s navedenim izvorom',
  'report findings with valid citations': 'nalaza s navedenim izvorom',
  'unsupported or degraded finding': 'nalaza bez izvora ili s nepotpunom potporom',
  'unsupported or degraded findings': 'nalaza bez izvora ili s nepotpunom potporom',
  'reconciliation open question': 'otvorenih pitanja za provjeru',
  'reconciliation open questions': 'otvorenih pitanja za provjeru',
  'blocked conclusion': 'zaključaka koje analiza nije mogla izvesti',
  'blocked conclusions': 'zaključaka koje analiza nije mogla izvesti',
  'unresolved branch': 'činjenica koje nisu mogle biti povezane',
  'unresolved branches': 'činjenica koje nisu mogle biti povezane',
  'partial node': 'tema s nepotpunom provjerom',
  'partial nodes': 'tema s nepotpunom provjerom',
  'total token': 'obrađenih tokena',
  'total tokens': 'obrađenih tokena',
  'model call': 'poziva AI modelu',
  'model calls': 'poziva AI modelu',
};

export const translateLabDelta = (label) => {
  const match = String(label).match(/^(\d+) (?:(more|fewer) )?(.+)$/);
  if (!match) return label;
  const [, count, direction, term] = match;
  const translated = DELTA_LABELS[term];
  if (!translated) return label;
  if (term.startsWith('unresolved ')) {
    const amount = Number(count);
    return `${count} ${amount === 1 ? 'činjenica ostavljena odvojeno' : amount >= 2 && amount <= 4 ? 'činjenice ostavljene odvojeno' : 'činjenica ostavljenih odvojeno'}`;
  }
  if (term.startsWith('partial ')) {
    const amount = Number(count);
    return `${count} ${amount === 1 ? 'tema s nepotpunom provjerom' : amount >= 2 && amount <= 4 ? 'teme s nepotpunom provjerom' : 'tema s nepotpunom provjerom'}`;
  }
  if (!direction) return `${count} ${translated}`;
  return `${count} ${direction === 'more' ? 'više' : 'manje'} ${translated}`;
};

export const formatLabDeltas = (deltas, emptyText) => (
  Array.isArray(deltas) && deltas.length > 0
    ? deltas.map(translateLabDelta).join('; ')
    : emptyText
);
