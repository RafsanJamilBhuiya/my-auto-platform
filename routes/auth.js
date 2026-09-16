const express = require('express');
const crypto = require('crypto');
const { signToken } = require('../middleware/auth');
const store = require('../core/store');

const router = express.Router();
const OAUTH_COOKIE = 'google_oauth_state';
const PKCE_COOKIE = 'google_oauth_verifier';

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, password_hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function safeUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role, provider: user.provider || 'local' }; }
function issue(res, user) {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ sub: user.id, email: user.email, name: user.name, role: user.role, iat: now, exp: now + 86400 });
  res.cookie('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 86400000, path: '/' });
}
function clearOAuthCookies(res) {
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
  res.clearCookie(OAUTH_COOKIE, opts); res.clearCookie(PKCE_COOKIE, opts);
}
function pkceChallenge(verifier) { return crypto.createHash('sha256').update(verifier).digest('base64url'); }

router.post('/register', express.json(), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim() || email.split('@')[0];
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) return res.status(400).json({ ok:false, error:'Valid email and password of at least 10 characters are required' });
    if (await store.findUserByEmail(email)) return res.status(409).json({ ok:false, error:'Account already exists' });
    const credentials = hash(password);
    const user = { id: crypto.randomUUID(), email, name, role: (await store.countUsers()) === 0 ? 'admin' : 'user', provider:'local', ...credentials };
    const created = await store.createUser(user);
    issue(res, created);
    res.status(201).json({ ok:true, user:safeUser(created) });
  } catch (error) { console.error('[Auth] register:', error); res.status(503).json({ ok:false, error:'Persistent authentication storage is unavailable' }); }
});

router.post('/login', express.json(), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await store.findUserByEmail(email);
    if (!user || !user.password_hash || !user.salt) return res.status(401).json({ ok:false, error:'Invalid credentials' });
    const candidate = Buffer.from(crypto.scryptSync(password, user.salt, 64).toString('hex'), 'hex');
    const expected = Buffer.from(user.password_hash, 'hex');
    if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return res.status(401).json({ ok:false, error:'Invalid credentials' });
    issue(res, user);
    res.json({ ok:true, user:safeUser(user) });
  } catch (error) { console.error('[Auth] login:', error); res.status(503).json({ ok:false, error:'Persistent authentication storage is unavailable' }); }
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'lax', path:'/' });
  res.json({ ok:true });
});

router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirect = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).json({ ok:false, error:'Google OAuth is not configured on Render.' });
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const opts = { httpOnly:true, secure:true, sameSite:'lax', maxAge:600000, path:'/api/auth/google' };
  res.cookie(OAUTH_COOKIE, state, opts); res.cookie(PKCE_COOKIE, verifier, opts);
  const params = new URLSearchParams({ client_id:clientId, redirect_uri:redirect, response_type:'code', scope:'openid email profile', access_type:'online', prompt:'select_account', state, code_challenge:pkceChallenge(verifier), code_challenge_method:'S256' });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send('Google OAuth is not configured.');
  if (!req.query.code || !req.query.state) return res.status(400).send('Missing OAuth response.');
  const stateCookie = req.cookies?.[OAUTH_COOKIE];
  const verifier = req.cookies?.[PKCE_COOKIE];
  if (!stateCookie || !verifier || stateCookie.length !== String(req.query.state).length || !crypto.timingSafeEqual(Buffer.from(stateCookie), Buffer.from(String(req.query.state)))) return res.status(400).send('Invalid OAuth state.');
  try {
    const redirect = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ code:req.query.code, client_id:process.env.GOOGLE_CLIENT_ID, client_secret:process.env.GOOGLE_CLIENT_SECRET, redirect_uri:redirect, grant_type:'authorization_code', code_verifier:verifier }) });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed');
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers:{ authorization:`Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) throw new Error('Google profile lookup failed');
    const profile = await profileResponse.json();
    const email = String(profile.email || '').trim().toLowerCase();
    if (!profile.email_verified || !email) return res.status(403).send('Google account email is not verified.');
    let user = await store.findUserByEmail(email);
    if (!user) user = await store.createUser({ id:crypto.randomUUID(), email, name:profile.name || email.split('@')[0], role:(await store.countUsers())===0?'admin':'user', provider:'google', salt:null, password_hash:null });
    issue(res, user); clearOAuthCookies(res); res.redirect('/dashboard?auth=success');
  } catch (error) { clearOAuthCookies(res); console.error('[Auth] Google OAuth:', error); res.status(502).send('Google OAuth failed.'); }
});

module.exports = router;
