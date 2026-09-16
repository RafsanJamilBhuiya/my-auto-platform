const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const jsRoots = ['core', 'middleware', 'routes', 'plugins'];
const requiredModules = [
  './core/env',
  './core/store',
  './core/eventBus',
  './core/loader',
  './core/assistant',
  './middleware/auth',
  './routes/auth',
  './routes/admin',
  './routes/backup',
  './routes/integrations',
  './routes/plugins',
  './routes/devops-api',
  './routes/telegram',
  './routes/assistant'
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = jsRoots.flatMap((name) => {
  const dir = path.join(root, name);
  return fs.existsSync(dir) ? walk(dir) : [];
});

for (const file of [path.join(root, 'server.js'), ...files]) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

process.env.ADMIN_DEFAULT_EMAIL ||= 'verify@example.com';
process.env.ADMIN_DEFAULT_PASSWORD ||= 'verification-password-123';
process.env.AUTH_SECRET ||= 'verification-auth-secret-32-characters-minimum';

for (const modulePath of requiredModules) {
  const loaded = require(path.join(root, modulePath));
  if (!loaded || typeof loaded !== 'object') {
    throw new Error(`Invalid module export: ${modulePath}`);
  }
}

const { validateRuntimeEnv } = require(path.join(root, './core/env'));
validateRuntimeEnv();
console.log(`[Verify] Syntax OK: ${files.length + 1} JavaScript files`);
console.log(`[Verify] Required module exports loaded: ${requiredModules.length}`);
console.log('[Verify] Runtime environment validator: PASS');
