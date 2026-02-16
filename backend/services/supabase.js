const { createClient } = require('@supabase/supabase-js');

let adminClient = null;
let anonClient = null;

function getPublishableKey() {
  return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
}

function getSecretKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function assertSupabaseConfig() {
  const missing = [];
  const publishableKey = getPublishableKey();
  const secretKey = getSecretKey();
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!publishableKey) missing.push('SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)');
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
  if (missing.length > 0) {
    throw new Error(`Missing Supabase env vars: ${missing.join(', ')}`);
  }
}

function getSupabaseAdminClient() {
  assertSupabaseConfig();
  if (!adminClient) {
    adminClient = createClient(
      process.env.SUPABASE_URL,
      getSecretKey(),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }
  return adminClient;
}

function getSupabaseAnonClient() {
  assertSupabaseConfig();
  if (!anonClient) {
    anonClient = createClient(
      process.env.SUPABASE_URL,
      getPublishableKey(),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }
  return anonClient;
}

function getSupabaseUserClient(jwt) {
  assertSupabaseConfig();
  return createClient(
    process.env.SUPABASE_URL,
    getPublishableKey(),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    },
  );
}

module.exports = {
  assertSupabaseConfig,
  getSupabaseAdminClient,
  getSupabaseAnonClient,
  getSupabaseUserClient,
};
