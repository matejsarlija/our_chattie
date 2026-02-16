// Vite 7 replaces import.meta.env.VITE_* references via static text
// replacement at compile time.  Dynamic key look-ups such as
// `import.meta.env[key]` are NOT replaced, so every variable must be
// accessed by its full, literal property path.
//
// For CRA compatibility we still fall back to process.env when present.

const readProcess = (key) => {
  try {
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch { /* process may not exist in browser */ }
  return undefined;
};

const first = (...values) => {
  for (const v of values) {
    if (v !== undefined && v !== '') return v;
  }
  return '';
};

export const env = {
  apiUrl: first(
    import.meta.env.VITE_API_URL,
    import.meta.env.REACT_APP_API_URL,
    readProcess('REACT_APP_API_URL'),
    '/api/chat',
  ),
  courtAnalysisUrl: first(
    import.meta.env.VITE_COURT_ANALYSIS_URL,
    import.meta.env.REACT_APP_COURT_ANALYSIS_URL,
    readProcess('REACT_APP_COURT_ANALYSIS_URL'),
    '/api/court-analysis',
  ),
  documentEditUrl: first(
    import.meta.env.VITE_DOCUMENT_EDIT_URL,
    import.meta.env.REACT_APP_DOCUMENT_EDIT_URL,
    readProcess('REACT_APP_DOCUMENT_EDIT_URL'),
    '/api/document-edit',
  ),
  entrySubscriptionUrl: first(
    import.meta.env.VITE_ENTRY_SUBSCRIPTION_URL,
    import.meta.env.REACT_APP_ENTRY_SUBSCRIPTION_URL,
    readProcess('REACT_APP_ENTRY_SUBSCRIPTION_URL'),
    '/api/subscribe',
  ),
  supabaseUrl: first(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.REACT_APP_SUPABASE_URL,
    readProcess('REACT_APP_SUPABASE_URL'),
  ),
  // Support both legacy anon key naming and the new publishable key naming.
  supabaseAnonKey: first(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    import.meta.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY,
    readProcess('REACT_APP_SUPABASE_PUBLISHABLE_KEY'),
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    import.meta.env.REACT_APP_SUPABASE_ANON_KEY,
    readProcess('REACT_APP_SUPABASE_ANON_KEY'),
  ),
};

export const requireEnv = (value, keyName) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${keyName}`);
  }

  return value;
};
