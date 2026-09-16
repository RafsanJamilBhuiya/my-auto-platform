const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { signToken, authRequired } = require('../middleware/auth');
const store = require('../core/store');
const router = express.Router();

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, password_hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function safeUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, provider: user.provider || 'local' };
}

function issue(res, user) {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ sub: user.id, email: user.email, name: user.name, role: user.role, iat: now, exp: now + 86400 });
  res.cookie('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 86400000, path: '/' });
}

function verifyScrypt(password, user) {
  if (!user.password_hash || !user.salt) return false;
  try {
    const candidate = crypto.scryptSync(password, user.salt, 64);
    const expected = Buffer.from(user.password_hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

async function verifyPassword(password, user) {
  if (user.password_hash && user.salt && verifyScrypt(password, user)) {
    return { valid: true, format: 'scrypt' };
  }

  const storedHash = String(user.password_hash || '');
  if (/^\$2[aby]\$\d{2}\$/.test(storedHash)) {
    try {
      return { valid: await bcrypt.compare(password, storedHash), format: 'bcrypt' };
    } catch {
      return { valid: false, format: 'bcrypt' };
    }
  }

  const legacy = user.password ?? user.plaintext_password;
  if (typeof legacy === 'string' && legacy.length > 0) {
    const a = Buffer.from(password);
    const b = Buffer.from(legacy);
    return { valid: a.length === b.length && crypto.timingSafeEqual(a, b), format: 'plaintext' };
  }

  return { valid: false, format: 'unknown' };
}

router.get('/profile', authRequired, (req, res) => res.json({ ok: true, user: safeUser(req.user) }));
router.get('/google/config', (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, clientId: process.env.GOOGLE_CLIENT_ID || null, enabled: Boolean(process.env.GOOGLE_CLIENT_ID) }));

router.post('/register', express.json(), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim() || email.split('@')[0];
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) return res.status(400).json({ ok: false, error: 'Valid email and password of at least 10 characters are required' });
    if (await store.findUserByEmail(email)) return res.status(409).json({ ok: false, error: 'Account already exists' });
    const user = { id: crypto.randomUUID(), email, name, role: (await store.countUsers()) === 0 ? 'admin' : 'user', provider: 'local', ...hash(password) };
    const created = await store.createUser(user);
    issue(res, created);
    res.status(201).json({ ok: true, user: safeUser(created) });
  } catch (error) {
    console.error('[Auth] register:', error);
    res.status(500).json({ ok: false, error: 'Registration failed' });
  }
});

router.post('/login', express.json(), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password are required' });

    const user = await store.findUserByEmail(email);
    if (!user) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

    const result = await verifyPassword(password, user);
    if (!result.valid) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

    if (result.format === 'bcrypt' || result.format === 'plaintext') {
      const migrated = hash(password);
      await store.upsertLocalPassword(user.id, migrated);
      user.salt = migrated.salt;
      user.password_hash = migrated.password_hash;
      user.provider = 'local';
      delete user.password;
      delete user.plaintext_password;
    }

    issue(res, user);
    res.json({ ok: true, user: safeUser(user) });
  } catch (error) {
    console.error('[Auth] login:', error);
    res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.json({ ok: true });
});

router.post('/google/credential', express.json(), async (req, res) => {
  try {
    const credential = String(req.body.credential || '').trim();
    if (!credential) return res.status(400).json({ ok: false, error: 'Google credential is required' });
    const verify = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!verify.ok) return res.status(401).json({ ok: false, error: 'Invalid Google credential' });
    const profile = await verify.json();
    if (process.env.GOOGLE_CLIENT_ID && profile.aud !== process.env.GOOGLE_CLIENT_ID) return res.status(401).json({ ok: false, error: 'Google credential audience mismatch' });
    const email = String(profile.email || '').trim().toLowerCase();
    if (!profile.email_verified || !/^\S+@\S+\.\S+$/.test(email)) return res.status(403).json({ ok: false, error: 'Verified Google email is required' });
    let user = await store.findUserByEmail(email);
    if (!user) user = await store.createUser({ id: crypto.randomUUID(), email, name: String(profile.name || email.split('@')[0]), role: (await store.countUsers()) === 0 ? 'admin' : 'user', provider: 'google', salt: null, password_hash: null });
    else if (user.provider !== 'google') { user = { ...user, provider: 'google' }; await store.upsertGoogleUser(user); }
    issue(res, user);
    res.json({ ok: true, user: safeUser(user) });
  } catch (error) {
    console.error('[Auth] Google credential:', error);
    res.status(502).json({ ok: false, error: 'Google sign-in verification failed' });
  }
});

router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) return res.status(404).json({ ok: false, error: 'Google Identity Services is required. Open the login page and use Continue with Google.' });
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const redirect = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  res.cookie('google_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600000, path: '/api/auth/google' });
  res.cookie('google_oauth_verifier', verifier, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600000, path: '/api/auth/google' });
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(404).send('Google OAuth is not enabled.');
  const stateCookie = req.cookies?.google_oauth_state;
  const verifier = req.cookies?.google_oauth_verifier;
  const received = String(req.query.state || '');
  if (!stateCookie || !verifier || !received || stateCookie.length !== received.length || !crypto.timingSafeEqual(Buffer.from(stateCookie), Buffer.from(received))) return res.status(400).send('Invalid OAuth state.');
  try {
    const redirect = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }) });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed');
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) throw new Error('Google profile lookup failed');
    const profile = await profileResponse.json();
    const email = String(profile.email || '').trim().toLowerCase();
    if (!profile.email_verified) throw new Error('Google email is not verified');
    let user = await store.findUserByEmail(email);
    if (!user) user = await store.createUser({ id: crypto.randomUUID(), email, name: profile.name || email.split('@')[0], role: (await store.countUsers()) === 0 ? 'admin' : 'user', provider: 'google', salt: null, password_hash: null });
    issue(res, user);
    res.clearCookie('google_oauth_state', { path: '/api/auth/google' });
    res.clearCookie('google_oauth_verifier', { path: '/api/auth/google' });
    res.redirect('/dashboard?auth=success');
  } catch (error) {
    console.error('[Auth] Google OAuth:', error);
    res.status(502).send('Google OAuth failed.');
  }
});

module.exports = router;
