/**
 * OmniFlow Core - Main Server Entry Point
 * 
 * A production-grade Express server with:
 * - Plugin system initialization
 * - Middleware configuration
 * - Health check endpoints
 * - Comprehensive error handling
 * - Request logging and monitoring
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

// Import OmniFlow modules
const eventBus = require('./core/eventBus');
const database = require('./core/database');
const pluginLoader = require('./core/loader');

// Create Express app
const app = express();

// Configuration
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// ============================================================================
// MIDDLEWARE SETUP
// ============================================================================

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    if (LOG_LEVEL === 'info' || logLevel === 'warn') {
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.path} ` +
        `${res.statusCode} ${duration}ms`
      );
    }
  });
  
  next();
});

// ============================================================================
// MIDDLEWARE ERROR HANDLERS
// ============================================================================

// Global error event handler from event bus
eventBus.onError((error, errorData) => {
  console.error('[EventBus Error]', {
    type: errorData.type,
    hook: errorData.hookName,
    plugin: errorData.pluginName,
    message: error.message
  });
});

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * Health Check Endpoint
 * Verifies core system and plugin health
 * 
 * GET /health
 * Returns: { status, timestamp, core, plugins, database }
 */
app.get('/health', async (req, res) => {
  try {
    // Check database health
    const dbHealth = await database.healthCheck();

    // Get plugin information
    const plugins = pluginLoader.getPlugins();
    const pluginStats = pluginLoader.getStats();

    // Get event bus hooks
    const eventBusHooks = eventBus.getHooks();

    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: NODE_ENV,
      uptime: process.uptime(),
      core: {
        version: '1.0.0',
        name: 'OmniFlow Core',
        eventBusActive: true,
        eventBusHooks: Object.keys(eventBusHooks.actions).length + 
                       Object.keys(eventBusHooks.filters).length
      },
      database: {
        status: dbHealth.status,
        healthy: dbHealth.healthy,
        connectedAt: dbHealth.connectedAt
      },
      plugins: {
        loaded: pluginStats.totalLoaded,
        failed: pluginStats.totalFailed,
        active: pluginStats.activePlugins,
        list: plugins,
        errors: pluginStats.errors.length > 0 ? pluginStats.errors : []
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
        }
      }
    };

    // Determine overall health status
    if (!dbHealth.healthy || pluginStats.totalFailed > 0) {
      healthData.status = 'degraded';
    }

    res.status(healthData.status === 'healthy' ? 200 : 503).json(healthData);
  } catch (error) {
    console.error('[Health Check] Error:', error.message);
    
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * System Info Endpoint
 * Returns detailed system information
 * 
 * GET /info
 */
app.get('/info', (req, res) => {
  const pluginStats = pluginLoader.getStats();
  const eventBusHooks = eventBus.getHooks();

  res.json({
    application: {
      name: 'OmniFlow Core',
      version: '1.0.0',
      description: 'Enterprise-grade Node.js backend with dynamic plugin system',
      environment: NODE_ENV
    },
    plugins: {
      loaded: pluginStats.totalLoaded,
      failed: pluginStats.totalFailed,
      list: pluginStats.plugins
    },
    eventBus: {
      totalHooks: Object.keys(eventBusHooks.actions).length + 
                  Object.keys(eventBusHooks.filters).length,
      actions: Object.keys(eventBusHooks.actions),
      filters: Object.keys(eventBusHooks.filters)
    },
    server: {
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
  });
});

/**
 * API Status Endpoint
 * Basic status check
 * 
 * GET /status
 */
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    message: 'OmniFlow Core is running',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// 404 HANDLER
// ============================================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `The endpoint ${req.method} ${req.path} does not exist`,
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((err, req, res, next) => {
  console.error('[Server Error]', {
    message: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
    ...(NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

/**
 * Start the server
 * Initializes plugins, database, and event bus before listening
 */
async function startServer() {
  try {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║          🚀 OmniFlow Core - Server Start            ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    // Initialize Database
    console.log('[Server] Initializing database connection...');
    try {
      await database.initialize();
      console.log('[Server] ✓ Database initialized\n');
    } catch (error) {
      console.warn(
        '[Server] ⚠ Database initialization skipped (optional):\n' +
        `  ${error.message}\n`
      );
    }

    // Load Plugins
    console.log('[Server] Loading plugin system...');
    const pluginResult = await pluginLoader.loadAllPlugins();
    console.log(`[Server] ✓ Plugin loading complete\n`);

    // Trigger app:boot event
    console.log('[Server] Triggering app:boot event...');
    await eventBus.executeAction('app:boot', {
      port: PORT,
      environment: NODE_ENV
    });
    console.log('[Server] ✓ Boot event completed\n');

    // Start listening
    app.listen(PORT, () => {
      console.log(`╔════════════════════════════════════════════════════╗`);
      console.log(`║  ✓ Server running on http://localhost:${PORT}`.padEnd(52) + '║');
      console.log(`║  ✓ Environment: ${NODE_ENV}`.padEnd(52) + '║');
      console.log(`║  ✓ Plugins loaded: ${pluginResult.loaded}/${pluginResult.loaded + pluginResult.failed}`.padEnd(52) + '║');
      console.log(`╚════════════════════════════════════════════════════╝\n`);
      
      console.log('📊 API Endpoints:');
      console.log(`  • GET  http://localhost:${PORT}/health   - Health check`);
      console.log(`  • GET  http://localhost:${PORT}/info     - System info`);
      console.log(`  • GET  http://localhost:${PORT}/status   - Status\n`);

      console.log('💡 Press Ctrl+C to stop the server\n');
    });

  } catch (error) {
    console.error('\n❌ Server initialization failed:');
    console.error(`  ${error.message}\n`);
    process.exit(1);
  }
}

// ============================================================================
// PROCESS ERROR HANDLERS
// ============================================================================

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', {
    reason: reason instanceof Error ? reason.message : reason,
    promise
  });
});

process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error.message);
  console.error(error.stack);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

// ============================================================================
// START SERVER
// ============================================================================

startServer();
