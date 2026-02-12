const { createClient } = require('@supabase/supabase-js');

let adminClient = null;
let anonClient = null;

function assertSupabaseConfig() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    throw new Error(`Missing Supabase env vars: ${missing.join(', ')}`);
  }
}

function getSupabaseAdminClient() {
  assertSupabaseConfig();
  if (!adminClient) {
    adminClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
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
      process.env.SUPABASE_ANON_KEY,
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
    process.env.SUPABASE_ANON_KEY,
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
