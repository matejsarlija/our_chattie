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
  'baseline-flat-v1': 'kontrolni profil',
  'context-tree-v1': 'DAG bez sažetaka',
  'context-tree-summarized-v1': 'DAG sa sažecima',
};

export const profileLabel = (profileId) => LAB_PROFILE_LABELS[profileId] || profileId;

export const shortHash = (hash) => {
  if (typeof hash !== 'string' || hash.length < 16) return hash || '-';
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
};

/**
 * Scorecard cells: 'n/a' (not applicable to the flat profile) renders as
 * N/P with an explanatory title; 'unknown' renders as '?' — never a silent
 * zero, never colour-only.
 */
export const formatScoreCell = (value) => {
  if (value === 'n/a') return { text: 'N/P', title: 'Nije primjenjivo na ravni profil' };
  if (value === 'unknown' || value === null || value === undefined) {
    return { text: '?', title: 'Nepoznato — podatak nedostaje' };
  }
  return { text: String(value), title: undefined };
};
