import { createClient } from '@supabase/supabase-js';
import { env } from './env';

const createTestClient = () => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signUp: async () => ({ error: null }),
    signInWithPassword: async () => ({ error: null }),
    signOut: async () => ({ error: null }),
  },
});

const isTest = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');
export const isSupabaseEnabled = Boolean(env.supabaseUrl && env.supabaseAnonKey);

const buildAuthConfigError = () => {
  const hasUrl = Boolean(env.supabaseUrl);
  const hasKey = Boolean(env.supabaseAnonKey);
  return new Error(
    `Authentication is not configured. Missing Supabase client config. ` +
    `Detected: supabaseUrl=${hasUrl ? 'set' : 'missing'}, supabaseKey=${hasKey ? 'set' : 'missing'}. ` +
    `Set VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (Vite) ` +
    `or REACT_APP_SUPABASE_URL + REACT_APP_SUPABASE_PUBLISHABLE_KEY (CRA), then restart the frontend server.`,
  );
};

const createDisabledClient = () => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signUp: async () => ({ error: buildAuthConfigError() }),
    signInWithPassword: async () => ({ error: buildAuthConfigError() }),
    signOut: async () => ({ error: null }),
  },
});

let client;
if (isTest) {
  client = createTestClient();
} else if (isSupabaseEnabled) {
  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
} else {
  // Keep this noisy in dev so config problems are visible immediately.
  if (typeof console !== 'undefined') {
    console.error('[Auth]', buildAuthConfigError().message);
  }
  client = createDisabledClient();
}

export const supabaseClient = client;
