require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const app = express();
const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

app.set('trust proxy', 1);
const allowedOrigin = process.env.FRONTEND_ORIGIN;
app.use(cors({ origin: (origin, callback) => { if (!origin || !allowedOrigin || origin === allowedOrigin) return callback(null, true); return callback(new Error('CORS origin denied')); }, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Core modules load without swallowing application route failures.
require('./core/database');
require('./core/eventBus');
require('./core/loader');

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/plugins', require('./routes/plugins'));
app.use('/api/devops', require('./routes/devops-api'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/integrations', (req, res) => res.sendFile(path.join(__dirname, 'public', 'integrations.html')));

app.get('/health', (req, res) => res.status(200).json({ ok: true, service: 'my-auto-platform', deployment: 'Render Native', timestamp: new Date().toISOString() }));
app.get('/ready', (req, res) => res.status(200).json({ ok: true, ready: true, persistentStoreConfigured: require('./core/store').isConfigured(), timestamp: new Date().toISOString() }));
app.get('/status', (req, res) => res.json({ ok: true, service: 'my-auto-platform', architecture: 'GitHub → Render', environment: process.env.NODE_ENV || 'production' }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'API route not found' });
  res.status(404).send('<!doctype html><html><body style="font-family:system-ui;padding:2rem"><h1>404</h1><p>Page not found.</p><a href="/">Return home</a></body></html>');
});

function startServer() {
  const server = app.listen(PORT, HOST, () => console.log(`[Server] Render Native | ${HOST}:${PORT}`));
  const shutdown = signal => { console.log(`[Server] ${signal} received`); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
  process.once('SIGTERM', () => shutdown('SIGTERM')); process.once('SIGINT', () => shutdown('SIGINT'));
  return server;
}
if (require.main === module) startServer();
module.exports = { app, startServer };
