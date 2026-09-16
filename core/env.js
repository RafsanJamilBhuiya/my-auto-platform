const REQUIRED = [
  'ADMIN_DEFAULT_EMAIL',
  'ADMIN_DEFAULT_PASSWORD',
  'AUTH_SECRET'
];

function validateRuntimeEnv() {
  const missing = REQUIRED.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const email = String(process.env.ADMIN_DEFAULT_EMAIL).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_DEFAULT_EMAIL must be a valid email address');
  }

  const password = String(process.env.ADMIN_DEFAULT_PASSWORD);
  if (password.length < 10) {
    throw new Error('ADMIN_DEFAULT_PASSWORD must be at least 10 characters long');
  }

  const secret = String(process.env.AUTH_SECRET);
  if (secret.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters long');
  }

  console.log('[Config] Required runtime environment validated:', REQUIRED.join(', '));
  return true;
}

module.exports = { validateRuntimeEnv, REQUIRED };
