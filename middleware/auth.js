const crypto = require('crypto');

function getSecret() {
  return process.env.AUTH_SECRET || process.env.SESSION_SECRET;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signToken(payload) {
  const secret = getSecret();
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const secret = getSecret();
  if (!secret || !token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) { return null; }
}

function authRequired(req, res, next) {
  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const cookie = (req.get('cookie') || '').match(/(?:^|;\s*)auth_token=([^;]+)/);
  const user = verifyToken(bearer || (cookie && cookie[1]));
  if (!user) return res.status(401).json({ ok: false, error: 'Authentication required' });
  req.user = user;
  next();
}

function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin access required' });
  next();
}

module.exports = { signToken, verifyToken, authRequired, adminRequired };
