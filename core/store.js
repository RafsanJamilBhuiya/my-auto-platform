const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'platform.json');
const initialState = () => ({ version: 1, users: [], integrations: [] });
let memoryState = null;
let fileAvailable = true;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeState(value) {
  if (!value || typeof value !== 'object') return initialState();
  return {
    version: 1,
    users: Array.isArray(value.users) ? value.users : [],
    integrations: Array.isArray(value.integrations) ? value.integrations : []
  };
}
function ensureLoaded() {
  if (memoryState) return memoryState;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) memoryState = normalizeState(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    else memoryState = initialState();
    fileAvailable = true;
  } catch (error) {
    console.warn('[Store] JSON file unavailable; using in-memory fallback:', error.message);
    memoryState = initialState();
    fileAvailable = false;
  }
  return memoryState;
}
function persist() {
  const state = ensureLoaded();
  if (!fileAvailable) return;
  try {
    const temp = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, DATA_FILE);
  } catch (error) {
    fileAvailable = false;
    console.warn('[Store] JSON persistence failed; continuing in memory:', error.message);
  }
}
function isConfigured() { ensureLoaded(); return true; }

async function findUserByEmail(email) {
  const state = ensureLoaded();
  return clone(state.users.find(u => u.email === String(email).toLowerCase()) || null);
}
async function countUsers() { return ensureLoaded().users.length; }
async function createUser(user) {
  const state = ensureLoaded();
  if (state.users.some(u => u.email === user.email)) throw new Error('Account already exists');
  state.users.push(clone(user));
  persist();
  return clone(user);
}
async function upsertGoogleUser(user) {
  const state = ensureLoaded();
  const index = state.users.findIndex(u => u.email === user.email);
  if (index >= 0) state.users[index] = { ...state.users[index], ...clone(user) };
  else state.users.push(clone(user));
  persist();
  return clone(index >= 0 ? state.users[index] : user);
}
async function listIntegrations() { return clone(ensureLoaded().integrations).reverse(); }
async function createIntegration(item) {
  ensureLoaded().integrations.push(clone(item));
  persist();
  return clone(item);
}
async function updateIntegration(id, patch) {
  const state = ensureLoaded();
  const index = state.integrations.findIndex(i => i.id === id);
  if (index < 0) return null;
  state.integrations[index] = { ...state.integrations[index], ...clone(patch) };
  persist();
  return clone(state.integrations[index]);
}
async function deleteIntegration(id) {
  const state = ensureLoaded();
  const before = state.integrations.length;
  state.integrations = state.integrations.filter(i => i.id !== id);
  if (state.integrations.length !== before) persist();
  return state.integrations.length !== before;
}
async function exportData() {
  const state = ensureLoaded();
  return { version: 1, exportedAt: new Date().toISOString(), users: clone(state.users), integrations: clone(state.integrations) };
}
async function restoreData(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.users) || !Array.isArray(payload.integrations)) throw new Error('Invalid backup data format');
  if (payload.users.length > 10000 || payload.integrations.length > 10000) throw new Error('Backup exceeds record limits');
  const users = payload.users.map(u => ({ id: String(u.id || crypto.randomUUID()), email: String(u.email || '').trim().toLowerCase(), name: String(u.name || ''), role: u.role === 'admin' ? 'admin' : 'user', provider: u.provider === 'google' ? 'google' : 'local', salt: u.salt || null, password_hash: u.password_hash || null }));
  const integrations = payload.integrations.map(i => ({ id: String(i.id || crypto.randomUUID()), name: String(i.name || ''), type: String(i.type || 'webhook'), endpoint: String(i.endpoint || ''), enabled: i.enabled !== false, created_at: i.created_at || new Date().toISOString(), secret: String(i.secret || '') }));
  if (users.some(u => !/^\S+@\S+\.\S+$/.test(u.email))) throw new Error('Invalid user email in backup');
  if (integrations.some(i => !/^https?:\/\//i.test(i.endpoint))) throw new Error('Invalid integration endpoint in backup');
  const state = ensureLoaded();
  state.users = users;
  state.integrations = integrations;
  persist();
  return { users: users.length, integrations: integrations.length };
}

module.exports = { findUserByEmail, countUsers, createUser, upsertGoogleUser, listIntegrations, createIntegration, updateIntegration, deleteIntegration, exportData, restoreData, isConfigured };
