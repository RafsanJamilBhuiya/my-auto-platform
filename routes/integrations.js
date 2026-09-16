const express = require('express');
const crypto = require('crypto');
const { authRequired, adminRequired } = require('../middleware/auth');
const store = require('../core/store');
const router = express.Router();

function safe(item) {
  const { secret, ...publicItem } = item;
  return publicItem;
}

function providerConfig(name, envKeys, extra = {}) {
  const configured = envKeys.some(key => Boolean(process.env[key]));
  return {
    name,
    configured,
    status: configured ? 'Configured' : 'Not Configured',
    mode: configured ? 'ready' : 'placeholder',
    ...extra
  };
}

router.get('/', authRequired, async (req, res) => {
  try {
    const integrations = await store.listIntegrations();
    res.json({ ok: true, integrations: integrations.map(safe) });
  } catch (error) {
    console.error('[Integrations] list:', error);
    res.status(500).json({ ok: false, error: 'Unable to load integrations' });
  }
});

router.get('/google', authRequired, (req, res) => {
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    providers: {
      drive: providerConfig('Google Drive', ['GOOGLE_DRIVE_ENABLED', 'GOOGLE_CLIENT_ID'], { scope: 'drive.file' }),
      sheets: providerConfig('Google Sheets', ['GOOGLE_SHEETS_ENABLED', 'GOOGLE_CLIENT_ID'], { scope: 'spreadsheets' }),
      maps: providerConfig('Google Maps', ['GOOGLE_MAPS_API_KEY'], { keyPresent: Boolean(process.env.GOOGLE_MAPS_API_KEY) })
    }
  });
});

router.get('/status', authRequired, (req, res) => {
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    providers: {
      googleDrive: providerConfig('Google Drive', ['GOOGLE_DRIVE_ENABLED', 'GOOGLE_CLIENT_ID']),
      googleSheets: providerConfig('Google Sheets', ['GOOGLE_SHEETS_ENABLED', 'GOOGLE_CLIENT_ID']),
      googleMaps: providerConfig('Google Maps', ['GOOGLE_MAPS_API_KEY']),
      telegram: providerConfig('Telegram', ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'])
    }
  });
});

router.post('/', authRequired, adminRequired, express.json(), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const type = String(req.body.type || 'webhook').trim();
    const endpoint = String(req.body.endpoint || '').trim();
    if (!name || !endpoint || !/^https?:\/\//i.test(endpoint)) return res.status(400).json({ ok: false, error: 'name and a valid HTTP(S) endpoint are required' });
    const item = { id: crypto.randomUUID(), name, type, endpoint, enabled: req.body.enabled !== false, created_at: new Date().toISOString(), secret: crypto.randomBytes(24).toString('hex') };
    const created = await store.createIntegration(item);
    res.status(201).json({ ok: true, integration: safe(created) });
  } catch (error) {
    console.error('[Integrations] create:', error);
    res.status(500).json({ ok: false, error: 'Unable to create integration' });
  }
});

router.patch('/:id', authRequired, adminRequired, express.json(), async (req, res) => {
  try {
    const patch = {};
    if (typeof req.body.enabled === 'boolean') patch.enabled = req.body.enabled;
    if (req.body.name) patch.name = String(req.body.name).trim();
    const item = await store.updateIntegration(req.params.id, patch);
    if (!item) return res.status(404).json({ ok: false, error: 'Integration not found' });
    res.json({ ok: true, integration: safe(item) });
  } catch (error) {
    console.error('[Integrations] update:', error);
    res.status(500).json({ ok: false, error: 'Unable to update integration' });
  }
});

router.delete('/:id', authRequired, adminRequired, async (req, res) => {
  try {
    if (await store.deleteIntegration(req.params.id)) return res.json({ ok: true });
    return res.status(404).json({ ok: false, error: 'Integration not found' });
  } catch (error) {
    console.error('[Integrations] delete:', error);
    res.status(500).json({ ok: false, error: 'Unable to delete integration' });
  }
});

module.exports = router;
