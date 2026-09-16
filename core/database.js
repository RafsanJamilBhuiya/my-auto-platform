/**
 * Supabase database client for private backend persistence.
 * Backend writes require the service-role key; never expose it to the browser.
 */
const { createClient } = require('@supabase/supabase-js');
let client;
function getDatabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  return client;
}
function isConfigured() { return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }
module.exports = { get client() { return getDatabase(); }, getDatabase, isConfigured };
