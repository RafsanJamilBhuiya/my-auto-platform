const crypto = require('crypto');
const { getDatabase, isConfigured } = require('./database');

function requireDb() {
  if (!isConfigured()) throw new Error('Persistent storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Render.');
  return getDatabase();
}

async function findUserByEmail(email) {
  const { data, error } = await requireDb().from('platform_users').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function countUsers() {
  const { count, error } = await requireDb().from('platform_users').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

async function createUser(user) {
  const { data, error } = await requireDb().from('platform_users').insert(user).select('*').single();
  if (error) throw error;
  return data;
}

async function upsertGoogleUser(user) {
  const { data, error } = await requireDb().from('platform_users').upsert(user, { onConflict: 'email' }).select('*').single();
  if (error) throw error;
  return data;
}

async function listIntegrations() {
  const { data, error } = await requireDb().from('platform_integrations').select('id,name,type,endpoint,enabled,created_at,secret').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createIntegration(item) {
  const { data, error } = await requireDb().from('platform_integrations').insert(item).select('*').single();
  if (error) throw error;
  return data;
}

async function updateIntegration(id, patch) {
  const { data, error } = await requireDb().from('platform_integrations').update(patch).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data || null;
}

async function deleteIntegration(id) {
  const { data, error } = await requireDb().from('platform_integrations').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function exportData() {
  const db = requireDb();
  const [users, integrations] = await Promise.all([
    db.from('platform_users').select('*'),
    db.from('platform_integrations').select('*')
  ]);
  if (users.error) throw users.error;
  if (integrations.error) throw integrations.error;
  return { version: 1, exportedAt: new Date().toISOString(), users: users.data || [], integrations: integrations.data || [] };
}

async function restoreData(payload) {
  const db = requireDb();
  if (!payload || payload.version !== 1 || !Array.isArray(payload.users) || !Array.isArray(payload.integrations)) throw new Error('Invalid backup data format');
  if (payload.users.length > 10000 || payload.integrations.length > 10000) throw new Error('Backup exceeds record limits');
  const users = payload.users.map(u => ({ id: String(u.id), email: String(u.email).toLowerCase(), name: String(u.name || ''), role: u.role === 'admin' ? 'admin' : 'user', provider: u.provider === 'google' ? 'google' : 'local', salt: u.salt || null, password_hash: u.password_hash || null }));
  const integrations = payload.integrations.map(i => ({ id: String(i.id || crypto.randomUUID()), name: String(i.name || ''), type: String(i.type || 'webhook'), endpoint: String(i.endpoint || ''), enabled: i.enabled !== false, created_at: i.created_at || new Date().toISOString(), secret: String(i.secret || '') }));
  if (users.some(u => !u.email || !/^\S+@\S+\.\S+$/.test(u.email))) throw new Error('Invalid user email in backup');
  if (integrations.some(i => !/^https?:\/\//i.test(i.endpoint))) throw new Error('Invalid integration endpoint in backup');
  const u = await db.from('platform_users').upsert(users, { onConflict: 'id' });
  if (u.error) throw u.error;
  const i = await db.from('platform_integrations').upsert(integrations, { onConflict: 'id' });
  if (i.error) throw i.error;
  return { users: users.length, integrations: integrations.length };
}

module.exports = { findUserByEmail, countUsers, createUser, upsertGoogleUser, listIntegrations, createIntegration, updateIntegration, deleteIntegration, exportData, restoreData, isConfigured };
