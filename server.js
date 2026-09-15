/**
 * my-auto-platform - Express application entry point.
 *
 * Boot order: configuration -> middleware -> plugins -> app:boot -> HTTP server.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const eventBus = require('./core/eventBus');
const database = require('./core/database');
const pluginLoader = require('./core/loader');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';

app.disable('x-powered-by');

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((value) => value.trim()) : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => console.log(
    `[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`
  ));
  next();
});

eventBus.onError((error, context) => {
  console.error('[Plugin Error]', {
    plugin: context.pluginName,
    hook: context.name,
    type: context.type,
    message: error.message
  });
});

app.get('/health', async (req, res) => {
  const pluginStats = pluginLoader.getStats();
  const dbConfigured = database.isConfigured();
  const healthy = pluginStats.failed === 0 && dbConfigured;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    database: { configured: dbConfigured },
    plugins: pluginStats,
    eventBus: eventBus.getHooks()
  });
});

app.get('/status', (req, res) => {
  res.json({ status: 'ok', service: 'my-auto-platform', version: '1.0.0' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

app.use((error, req, res, next) => {
  console.error('[HTTP Error]', error);
  if (res.headersSent) return next(error);
  res.status(error.statusCode || 500).json({
    error: 'Internal Server Error',
    ...(NODE_ENV !== 'production' && { message: error.message })
  });
});

let server;

async function startServer() {
  const pluginResult = await pluginLoader.loadAllPlugins();
  await eventBus.executeAction('app:boot', {
    environment: NODE_ENV,
    port: PORT,
    plugins: pluginResult
  });

  server = app.listen(PORT, () => {
    console.log(`[Server] my-auto-platform listening on :${PORT} (${NODE_ENV})`);
  });
}

async function shutdown(signal) {
  console.log(`[Server] ${signal} received; shutting down gracefully...`);
  if (!server) return process.exit(0);
  await Promise.all([...pluginLoader.plugins.keys()].map((name) => pluginLoader.unloadPlugin(name)));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('[Process] Unhandled rejection:', reason));
process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught exception:', error);
  process.exit(1);
});

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[Server] Startup failed:', error);
    process.exit(1);
  });
}

module.exports = { app, startServer };
