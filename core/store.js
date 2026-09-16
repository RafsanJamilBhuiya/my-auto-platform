const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'platform.json');
const DEFAULT_ADMIN_EMAIL = 'rafsanjamilbhuiya@gmail.com';

const initialState = () => ({ version: 1, users: [], integrations: [] });
let memoryState = null;
let fileAvailable = true;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, password_hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function seedDefaultAdmin(state) {
  const email = String(process.env.ADMIN_DEFAULT_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  if (state.users.some(u => String(u.email || '').trim().toLowerCase() === email)) return false;

  let password = process.env.ADMIN_DEFAULT_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(32).toString('base64url');
    console.warn(`[Store] ADMIN_DEFAULT_PASSWORD is not configured; generated a temporary admin credential for ${email}. Configure the Render environment variable.`);
  }
  if (password.length < 10) throw new Error('ADMIN_DEFAULT_PASSWORD must be at least 10 characters');

  state.users.push({
    id: crypto.randomUUID(),
    email,
    name: email.split('@')[0],
    role: 'admin',
    provider: 'local',
    ...hashPassword(password)
  });
  return true;
}

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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let state = initialState();

  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
      state = raw ? normalizeState(JSON.parse(raw)) : initialState();
    } catch (error) {
      console.warn('[Store] platform.json is missing, empty, or invalid; rebuilding native state:', error.message);
      state = initialState();
    }
  }

  memoryState = state;
  fileAvailable = true;
  if (seedDefaultAdmin(memoryState)) persist();
  return memoryState;
}

function persist() {
  const state = memoryState || initialState();
  if (!fileAvailable) return;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, DATA_FILE);
  } catch (error) {
    fileAvailable = false;
    console.warn('[Store] JSON persistence failed; continuing in memory:', error.message);
  }
}

function isConfigured() { ensureLoaded(); return true; }

async function findUserByEmail(email) {
  const state = ensureLoaded();
  const normalized = String(email || '').trim().toLowerCase();
  return clone(state.users.find(u => String(u.email || '').trim().toLowerCase() === normalized) || null);
}

async function countUsers() { return ensureLoaded().users.length; }

async function createUser(user) {
  const state = ensureLoaded();
  const email = String(user.email || '').trim().toLowerCase();
  if (state.users.some(u => String(u.email || '').trim().toLowerCase() === email)) throw new Error('Account already exists');
  const normalized = { ...clone(user), email };
  state.users.push(normalized);
  persist();
  return clone(normalized);
}

async function upsertGoogleUser(user) {
  const state = ensureLoaded();
  const email = String(user.email || '').trim().toLowerCase();
  const index = state.users.findIndex(u => String(u.email || '').trim().toLowerCase() === email);
  if (index >= 0) state.users[index] = { ...state.users[index], ...clone(user), email };
  else state.users.push({ ...clone(user), email });
  persist();
  return clone(index >= 0 ? state.users[index] : state.users[state.users.length - 1]);
}

async function upsertLocalPassword(userId, passwordData) {
  const state = ensureLoaded();
  const user = state.users.find(u => u.id === userId);
  if (!user) return null;
  user.salt = passwordData.salt;
  user.password_hash = passwordData.password_hash;
  user.provider = 'local';
  delete user.password;
  delete user.plaintext_password;
  persist();
  return clone(user);
}

async function listIntegrations() { return clone(ensureLoaded().integrations).reverse(); }
async function createIntegration(item) { ensureLoaded().integrations.push(clone(item)); persist(); return clone(item); }

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

module.exports = {
  findUserByEmail,
  countUsers,
  createUser,
  upsertGoogleUser,
  upsertLocalPassword,
  listIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  exportData,
  isConfigured
};
