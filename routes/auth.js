const express = require('express');
const crypto = require('crypto');
const { signToken } = require('../middleware/auth');

const router = express.Router();
const users = new Map();

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function safeUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role, provider: user.provider || 'local' }; }
function issue(res, user) {
  const token = signToken({ sub: user.id, email: user.email, name: user.name, role: user.role, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+86400 });
  res.cookie('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 86400000, path: '/' });
  return token;
}

router.post('/register', express.json(), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim() || email.split('@')[0];
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10) return res.status(400).json({ ok:false, error:'Valid email and password of at least 10 characters are required' });
  if (users.has(email)) return res.status(409).json({ ok:false, error:'Account already exists' });
  const credentials = hash(password);
  const user = { id: crypto.randomUUID(), email, name, role: users.size ? 'user' : 'admin', ...credentials, provider:'local' };
  users.set(email, user);
  const token = issue(res, user);
  res.status(201).json({ ok:true, user:safeUser(user), token });
});

router.post('/login', express.json(), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = users.get(email);
  if (!user) return res.status(401).json({ ok:false, error:'Invalid credentials' });
  const candidate = crypto.scryptSync(password, user.salt, 64).toString('hex');
  if (!crypto.timingSafeEqual(Buffer.from(candidate,'hex'), Buffer.from(user.hash,'hex'))) return res.status(401).json({ ok:false, error:'Invalid credentials' });
  const token = issue(res, user);
  res.json({ ok:true, user:safeUser(user), token });
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'lax', path:'/' });
  res.json({ ok:true });
});

router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirect = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  if (!clientId) return res.status(503).json({ ok:false, error:'Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL on Render.' });
  const params = new URLSearchParams({ client_id:clientId, redirect_uri:redirect, response_type:'code', scope:'openid email profile', access_type:'online', prompt:'select_account' });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(503).send('Google OAuth is not configured.');
  if (!req.query.code) return res.status(400).send('Missing OAuth code.');
  try {
    const redirect = process.env.GOOGLE_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({code:req.query.code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirect,grant_type:'authorization_code'}) });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed');
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers:{ authorization:`Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) throw new Error('Google profile lookup failed');
    const profile = await profileResponse.json();
    const email = String(profile.email || '').toLowerCase();
    let user = users.get(email);
    if (!user) { user={id:crypto.randomUUID(),email,name:profile.name || email.split('@')[0],role:users.size?'user':'admin',provider:'google'}; users.set(email,user); }
    issue(res,user);
    res.redirect('/dashboard?auth=success');
  } catch (error) { res.status(502).send(`Google OAuth failed: ${error.message}`); }
});

module.exports = router;
