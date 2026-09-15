/**
 * Supabase database client.
 *
 * Configuration is supplied exclusively through environment variables.
 * No credentials are stored in source control.
 */
const { createClient } = require('@supabase/supabase-js');

let client;

function getDatabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Supabase is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  }

  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  return client;
}

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
}

module.exports = {
  get client() { return getDatabase(); },
  getDatabase,
  isConfigured
};
