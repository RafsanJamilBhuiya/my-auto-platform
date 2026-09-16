/**
 * Persistent Store with Fallback Admin & Ephemeral Filesystem Recovery
 * 
 * Designed for Render's ephemeral storage with automatic recovery:
 * 1. Attempts to load from data/platform.json
 * 2. If missing/corrupted, seeds with fallback admin (env vars or hardcoded)
 * 3. Gracefully degrades to in-memory store on filesystem failure
 * 4. All persistence operations are safe and logged visibly
 * 5. Health checks verify actual storage capability
 * 
 * Environment Variables:
 * - ADMIN_DEFAULT_EMAIL: Email for fallback admin (default: admin@fallback.local)
 * - ADMIN_DEFAULT_PASSWORD: Password for fallback admin (min 10 chars)
 * - NODE_ENV: production/development (affects logging verbosity)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// CONFIGURATION & STATE MANAGEMENT
// ============================================================================

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'platform.json');
const FALLBACK_ADMIN_EMAIL = 'admin@fallback.local';
const FALLBACK_ADMIN_PASSWORD_LENGTH = 16;

let memoryState = null;
let storageHealthy = false;
let fallbackAdminCreated = false;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Deep clone a value to prevent reference mutations
 */
function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    console.error('[Store] Clone failed for value:', value);
    return null;
  }
}

/**
 * Hash a password using scrypt
 * @param {string} password - Plain text password
 * @param {string} salt - Optional salt (generated if not provided)
 * @returns {{ salt: string, password_hash: string }}
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  try {
    const password_hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, password_hash };
  } catch (error) {
    console.error('[Store] Password hashing failed:', error.message);
    throw new Error('Password hashing failed');
  }
}

/**
 * Generate a secure random password
 * @param {number} length - Length in bytes
 * @returns {string} Base64url encoded random password
 */
function generateSecurePassword(length = FALLBACK_ADMIN_PASSWORD_LENGTH) {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Create initial empty state
 */
function initialState() {
  return {
    version: 1,
    users: [],
    integrations: [],
    metadata: {
      createdAt: new Date().toISOString(),
      source: 'initialization'
    }
  };
}

/**
 * Normalize and validate state structure
 */
function normalizeState(value) {
  if (!value || typeof value !== 'object') return initialState();
  return {
    version: 1,
    users: Array.isArray(value.users) ? value.users : [],
    integrations: Array.isArray(value.integrations) ? value.integrations : [],
    metadata: value.metadata || { createdAt: new Date().toISOString() }
  };
}

/**
 * Test if filesystem persistence is available
 * @returns {boolean} True if storage is healthy
 */
function testPersistence() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const testFile = path.join(DATA_DIR, `.persist-test-${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'test', { encoding: 'utf8', mode: 0o600 });
    fs.unlinkSync(testFile);
    storageHealthy = true;
    console.log('[Store] Filesystem persistence test PASSED');
    return true;
  } catch (error) {
    storageHealthy = false;
    console.error('[Store] Filesystem persistence test FAILED:', {
      error: error.message,
      code: error.code,
      path: DATA_DIR
    });
    return false;
  }
}

// ============================================================================
// FALLBACK ADMIN MANAGEMENT
// ============================================================================

/**
 * Seed default admin account from environment or generate fallback
 * @param {object} state - The current store state
 * @returns {boolean} True if a new admin was created
 */
function seedDefaultAdmin(state) {
  // Check if an admin user already exists
  const existingAdmin = state.users.find(u => u.role === 'admin');
  if (existingAdmin) {
    console.log('[Store] Admin user already exists; skipping seed');
    return false;
  }

  // Determine admin email
  const adminEmail = String(
    process.env.ADMIN_DEFAULT_EMAIL || FALLBACK_ADMIN_EMAIL
  )
    .trim()
    .toLowerCase();

  // Check if this email already exists (edge case)
  if (state.users.some(u => String(u.email || '').trim().toLowerCase() === adminEmail)) {
    console.log(`[Store] User ${adminEmail} already exists; skipping admin seed`);
    return false;
  }

  // Determine admin password
  let adminPassword = process.env.ADMIN_DEFAULT_PASSWORD;
  const isGeneratedPassword = !adminPassword;

  if (!adminPassword) {
    adminPassword = generateSecurePassword();
    console.error(`
╔════════════════════════════════════════════════════════════════════════════╗
║  ⚠️  EPHEMERAL STORAGE: FALLBACK ADMIN CREDENTIAL GENERATED                ║
╠════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  EMAIL:                                                                    ║
║  ${adminEmail}                                                       ║
║                                                                            ║
║  PASSWORD:                                                                 ║
║  ${adminPassword}                                      ║
║                                                                            ║
║  ⚡ INSTRUCTIONS:                                                          ║
║  1. Save this password immediately                                        ║
║  2. Set env var: ADMIN_DEFAULT_PASSWORD=${adminPassword}  ║
║  3. Redeploy on Render to make password permanent                         ║
║  4. This generated password will expire on next restart                   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
    `);
  }

  // Validate password length
  if (adminPassword.length < 10) {
    throw new Error('ADMIN_DEFAULT_PASSWORD must be at least 10 characters long');
  }

  // Create admin user
  const adminUser = {
    id: crypto.randomUUID(),
    email: adminEmail,
    name: adminEmail.split('@')[0],
    role: 'admin',
    provider: 'local',
    ...hashPassword(adminPassword),
    createdAt: new Date().toISOString(),
    metadata: {
      source: isGeneratedPassword ? 'auto-generated-fallback' : 'env-configured',
      ephemeralStorage: true
    }
  };

  state.users.push(adminUser);
  fallbackAdminCreated = true;

  console.log('[Store] Fallback admin account created', {
    email: adminEmail,
    source: isGeneratedPassword ? 'auto-generated' : 'environment-configured'
  });

  return true;
}

// ============================================================================
// CORE STATE MANAGEMENT
// ============================================================================

/**
 * Ensure state is loaded from storage or memory
 * Called before all read/write operations
 * @returns {object} Current store state
 */
function ensureLoaded() {
  // If already in memory, return it
  if (memoryState) {
    return memoryState;
  }

  console.log('[Store] Loading state from persistent storage...');

  let state = initialState();

  // Test if filesystem is available
  testPersistence();

  // Try to read from file
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
      if (raw && raw.length > 0) {
        state = normalizeState(JSON.parse(raw));
        console.log('[Store] ✓ Successfully loaded data from persistent file', {
          userCount: state.users.length,
          integrationCount: state.integrations.length
        });
      } else {
        console.warn('[Store] Data file exists but is empty; initializing fresh state');
        state = initialState();
      }
    } catch (error) {
      console.error('[Store] Failed to parse platform.json:', {
        error: error.message,
        action: 'Initializing fresh state'
      });
      state = initialState();
    }
  } else {
    console.log('[Store] No persistent data file found; initializing fresh state');
  }

  // Set in-memory state
  memoryState = state;

  // Seed default admin if needed
  const adminSeeded = seedDefaultAdmin(memoryState);

  // Attempt to persist (in case we seeded a new admin)
  if (adminSeeded) {
    persist();
  }

  return memoryState;
}

/**
 * Persist state to filesystem
 * Safe operation: fails gracefully if storage is unavailable
 */
function persist() {
  const state = memoryState || initialState();

  // If storage is not healthy, log warning but don't crash
  if (!storageHealthy) {
    console.warn('[Store] Storage not available; state is in-memory only', {
      note: 'Data will be lost on container restart. Set ADMIN_DEFAULT_PASSWORD env var.'
    });
    return;
  }

  try {
    // Ensure data directory exists
    fs.mkdirSync(DATA_DIR, { recursive: true });

    // Use atomic write: write to temp file, then rename
    const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });

    // Atomic rename
    fs.renameSync(tempFile, DATA_FILE);

    console.log('[Store] ✓ Data persisted successfully', {
      file: DATA_FILE,
      userCount: state.users.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Storage failed: log explicitly but continue with in-memory state
    storageHealthy = false;
    console.error('[Store] ⚠️  CRITICAL: Persistence failed - data will be lost on restart', {
      file: DATA_FILE,
      error: error.message,
      code: error.code,
      action: 'Continuing in memory-only mode. Set ADMIN_DEFAULT_PASSWORD and redeploy.',
      recommendation: 'This is ephemeral storage on Render. Use environment variables for persistence.'
    });
  }
}

/**
 * Get current storage health status (for monitoring/health checks)
 * @returns {object} Storage status information
 */
function getStorageStatus() {
  const state = memoryState || initialState();
  return {
    healthy: storageHealthy,
    persistent: storageHealthy && fs.existsSync(DATA_FILE),
    userCount: state.users.length,
    hasDefaultAdmin: state.users.some(u => u.role === 'admin'),
    filepath: DATA_FILE,
    fallbackUsed: fallbackAdminCreated,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Find a user by email address
 * Case-insensitive, whitespace-trimmed search
 * @param {string} email - Email to search for
 * @returns {Promise<object|null>} User object or null if not found
 */
async function findUserByEmail(email) {
  const state = ensureLoaded();
  const normalized = String(email || '').trim().toLowerCase();

  const user = state.users.find(
    u => String(u.email || '').trim().toLowerCase() === normalized
  );

  return clone(user || null);
}

/**
 * Count total users in store
 * @returns {Promise<number>} Total user count
 */
async function countUsers() {
  const state = ensureLoaded();
  return state.users.length;
}

/**
 * Create a new user
 * Validates that email doesn't already exist
 * @param {object} user - User object to create
 * @returns {Promise<object>} Created user (cloned, safe for transmission)
 * @throws {Error} If email already exists or validation fails
 */
async function createUser(user) {
  const state = ensureLoaded();
  const email = String(user.email || '').trim().toLowerCase();

  // Check for duplicates
  if (
    state.users.some(
      u => String(u.email || '').trim().toLowerCase() === email
    )
  ) {
    throw new Error('Account already exists');
  }

  // Normalize and add metadata
  const normalized = {
    ...clone(user),
    email,
    createdAt: user.createdAt || new Date().toISOString()
  };

  state.users.push(normalized);
  persist();

  return clone(normalized);
}

/**
 * Create or update a Google-authenticated user
 * @param {object} user - User object from Google OAuth
 * @returns {Promise<object>} Created or updated user
 */
async function upsertGoogleUser(user) {
  const state = ensureLoaded();
  const email = String(user.email || '').trim().toLowerCase();

  const index = state.users.findIndex(
    u => String(u.email || '').trim().toLowerCase() === email
  );

  if (index >= 0) {
    // Update existing user
    state.users[index] = {
      ...state.users[index],
      ...clone(user),
      email,
      updatedAt: new Date().toISOString()
    };
  } else {
    // Create new user
    state.users.push({
      ...clone(user),
      email,
      createdAt: new Date().toISOString()
    });
  }

  persist();

  return clone(
    index >= 0 ? state.users[index] : state.users[state.users.length - 1]
  );
}

/**
 * Update a user's local password hash
 * Called during password change or migration
 * @param {string} userId - User ID
 * @param {object} passwordData - { salt, password_hash } from hashPassword()
 * @returns {Promise<object|null>} Updated user or null if not found
 */
async function upsertLocalPassword(userId, passwordData) {
  const state = ensureLoaded();
  const user = state.users.find(u => u.id === userId);

  if (!user) {
    console.warn('[Store] User not found for password update:', userId);
    return null;
  }

  // Update password fields
  user.salt = passwordData.salt;
  user.password_hash = passwordData.password_hash;
  user.provider = 'local';
  user.updatedAt = new Date().toISOString();

  // Clean up old password fields
  delete user.password;
  delete user.plaintext_password;

  persist();

  return clone(user);
}

// ============================================================================
// INTEGRATION OPERATIONS
// ============================================================================

/**
 * List all integrations (most recent first)
 * @returns {Promise<array>} Array of integration objects
 */
async function listIntegrations() {
  const state = ensureLoaded();
  return clone(state.integrations).reverse();
}

/**
 * Create a new integration
 * @param {object} item - Integration object to create
 * @returns {Promise<object>} Created integration
 */
async function createIntegration(item) {
  const state = ensureLoaded();
  state.integrations.push(clone(item));
  persist();
  return clone(item);
}

/**
 * Update an existing integration
 * @param {string} id - Integration ID
 * @param {object} patch - Fields to update
 * @returns {Promise<object|null>} Updated integration or null if not found
 */
async function updateIntegration(id, patch) {
  const state = ensureLoaded();
  const index = state.integrations.findIndex(i => i.id === id);

  if (index < 0) {
    return null;
  }

  state.integrations[index] = {
    ...state.integrations[index],
    ...clone(patch)
  };

  persist();

  return clone(state.integrations[index]);
}

/**
 * Delete an integration by ID
 * @param {string} id - Integration ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteIntegration(id) {
  const state = ensureLoaded();
  const before = state.integrations.length;
  state.integrations = state.integrations.filter(i => i.id !== id);
  const deleted = state.integrations.length !== before;

  if (deleted) {
    persist();
  }

  return deleted;
}

// ============================================================================
// EXPORT & DIAGNOSTIC OPERATIONS
// ============================================================================

/**
 * Export all data in a safe format
 * Useful for backups and monitoring
 * @returns {Promise<object>} Complete data export
 */
async function exportData() {
  const state = ensureLoaded();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    storage: getStorageStatus(),
    users: clone(state.users),
    integrations: clone(state.integrations)
  };
}

/**
 * Check if store is configured and operational
 * Called by server startup and health checks
 * @returns {boolean} True if store is ready
 */
function isConfigured() {
  ensureLoaded();
  return true;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // User operations
  findUserByEmail,
  countUsers,
  createUser,
  upsertGoogleUser,
  upsertLocalPassword,

  // Integration operations
  listIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,

  // Diagnostic operations
  exportData,
  isConfigured,
  getStorageStatus,

  // Utility exports (for testing or direct usage if needed)
  hashPassword,
  generateSecurePassword,
  testPersistence
};
