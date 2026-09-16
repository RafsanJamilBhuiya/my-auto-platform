/**
 * my-auto-platform - Express application entry point
 * 
 * Optimized for standalone Render deployment
 * Boot order: configuration -> middleware -> plugins -> app:boot -> HTTP server
 * 
 * Features:
 * - Serves Dashboard UI from /public/dashboard.html
 * - Provides DevOps status API at /api/devops/status
 * - Full backend API support with plugin system
 * - Render-compatible: Binds to 0.0.0.0 and uses process.env.PORT
 */
require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const eventBus = require('./core/eventBus');
const database = require('./core/database');
const pluginLoader = require('./core/loader');
const devopsApi = require('./routes/devops-api');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

app.disable('x-powered-by');

/**
 * Middleware Configuration
 */
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((value) => value.trim()) : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/**
 * Static File Serving
 * Serves dashboard and other public assets directly from Express
 */
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: false,
  lastModified: true
}));

/**
 * Request Logging Middleware
 */
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => console.log(
    `[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`
  ));
  next();
});

/**
 * Error Handling for Plugin System
 */
eventBus.onError((error, context) => {
  console.error('[Plugin Error]', {
    plugin: context.pluginName,
    hook: context.name,
    type: context.type,
    message: error.message
  });
});

/**
 * Health & Status Endpoints
 * Used by Render for deployment monitoring and health checks
 */

// Liveness probe - verifies Node.js process is serving HTTP
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    service: 'my-auto-platform'
  });
});

// Readiness probe - checks application dependencies
app.get('/ready', (req, res) => {
  const pluginStats = pluginLoader.getStats();
  const dbConfigured = database.isConfigured();
  const ready = pluginStats.failed === 0 && dbConfigured;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    database: { configured: dbConfigured },
    plugins: pluginStats
  });
});

// Service status endpoint
app.get('/status', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'my-auto-platform',
    version: '1.0.0',
    environment: NODE_ENV,
    port: PORT,
    uptime: process.uptime()
  });
});

/**
 * DevOps API Endpoints
 * Provides infrastructure monitoring and deployment status
 */
app.use('/api', devopsApi);

/**
 * Dashboard Routes
 * Serve the DevOps dashboard UI
 */
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

/**
 * 404 Handler - Not Found
 */
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found', 
    path: req.originalUrl,
    message: 'The requested resource does not exist. Try /dashboard or /health',
    timestamp: new Date().toISOString()
  });
});

/**
 * Global Error Handler
 */
app.use((error, req, res, next) => {
  console.error('[HTTP Error]', error);
  if (res.headersSent) return next(error);
  res.status(error.statusCode || 500).json({
    error: 'Internal Server Error',
    ...(NODE_ENV !== 'production' && { message: error.message, stack: error.stack })
  });
});

/**
 * Server Lifecycle Management
 */
let server;

async function startServer() {
  try {
    // Load all plugins
    const pluginResult = await pluginLoader.loadAllPlugins();
    
    // Execute boot hooks
    await eventBus.executeAction('app:boot', {
      environment: NODE_ENV,
      port: PORT,
      plugins: pluginResult
    });

    // Start HTTP server
    server = app.listen(PORT, HOST, () => {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║                  🚀 SERVER STARTED                         ║
╠════════════════════════════════════════════════════════════╣
║ Service:      my-auto-platform                             ║
║ Environment:  ${NODE_ENV.padEnd(45)} ║
║ Host:         ${HOST.padEnd(45)} ║
║ Port:         ${PORT.toString().padEnd(45)} ║
║ Uptime:       ${process.uptime().toFixed(2)}s                              ║
╠════════════════════════════════════════════════════════════╣
║ Dashboard:    http://${HOST}:${PORT}/dashboard                     ║
║ Health:       http://${HOST}:${PORT}/health                        ║
║ API:          http://${HOST}:${PORT}/api/devops/status             ║
╠════════════════════════════════════════════════════════════╣
║ Deployment:   Render Native                                ║
║ Build:        Node.js ${process.version}                    ║
╚════════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('[Server] Startup failed:', error);
    process.exit(1);
  }
}

/**
 * Graceful Shutdown Handler
 */
async function shutdown(signal) {
  console.log(`\n[Server] ${signal} received; shutting down gracefully...`);
  if (!server) return process.exit(0);
  
  try {
    // Unload all plugins
    await Promise.all([...pluginLoader.plugins.keys()].map((name) => pluginLoader.unloadPlugin(name)));
    
    // Close server
    server.close(() => {
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('[Server] Forced shutdown - timeout reached');
      process.exit(1);
    }, 10_000).unref();
  } catch (error) {
    console.error('[Server] Shutdown error:', error);
    process.exit(1);
  }
}

/**
 * Process Signal Handlers
 */
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('[Process] Unhandled rejection:', reason));
process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught exception:', error);
  process.exit(1);
});

/**
 * Server Entry Point
 */
if (require.main === module) {
  startServer().catch((error) => {
    console.error('[Server] Startup failed:', error);
    process.exit(1);
  });
}

/**
 * Export for Testing & External Use
 */
module.exports = { app, startServer, shutdown };
