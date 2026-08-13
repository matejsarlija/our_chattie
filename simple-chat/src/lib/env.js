// Vite 7 replaces import.meta.env.VITE_* references via static text
// replacement at compile time.  Dynamic key look-ups such as
// `import.meta.env[key]` are NOT replaced, so every variable must be
// accessed by its full, literal property path.
//
// For CRA compatibility we still fall back to process.env when present.

import {
  readProcess,
  first,
  readBool,
} from './envUtils';

export const env = {
  apiUrl: first(
    import.meta.env.VITE_API_URL,
    import.meta.env.REACT_APP_API_URL,
    readProcess('REACT_APP_API_URL'),
    '/api',
  ),
  courtAnalysisUrl: first(
    import.meta.env.VITE_COURT_ANALYSIS_URL,
    import.meta.env.REACT_APP_COURT_ANALYSIS_URL,
    readProcess('REACT_APP_COURT_ANALYSIS_URL'),
    '/api/court-analysis',
  ),
  analysisDetailSseEnabled: readBool(
    first(
      import.meta.env.VITE_ANALYSIS_DETAIL_SSE_ENABLED,
      import.meta.env.REACT_APP_ANALYSIS_DETAIL_SSE_ENABLED,
      readProcess('REACT_APP_ANALYSIS_DETAIL_SSE_ENABLED'),
    ),
    false,
  ),
};
