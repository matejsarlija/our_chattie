const { getSupabaseAnonClient, getSupabaseAdminClient, getSupabaseUserClient } = require('../services/supabase');

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (typeof header !== 'string') return null;
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
}

async function requireSupabaseAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing authorization token.' });
    }

    const supabaseAnon = getSupabaseAnonClient();
    const { data, error } = await supabaseAnon.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    req.user = data.user;
    req.auth = { token };
    req.supabase = getSupabaseUserClient(token);
    req.supabaseAdmin = getSupabaseAdminClient();

    return next();
  } catch (err) {
    console.error('[Auth] Supabase auth failed:', err.message || err);
    return res.status(500).json({ error: 'Auth validation failed.' });
  }
}

async function optionalSupabaseAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return next();
    }

    const supabaseAnon = getSupabaseAnonClient();
    const { data, error } = await supabaseAnon.auth.getUser(token);

    if (!error && data?.user) {
      req.user = data.user;
      req.auth = { token };
      req.supabase = getSupabaseUserClient(token);
      req.supabaseAdmin = getSupabaseAdminClient();
    } else {
      req.authError = error || new Error('Invalid or expired token.');
    }

    return next();
  } catch (err) {
    console.error('[Auth] Optional Supabase auth failed:', err.message || err);
    return next();
  }
}

module.exports = {
  requireSupabaseAuth,
  extractBearerToken,
  optionalSupabaseAuth,
};
