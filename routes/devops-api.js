const express = require('express');
const router = express.Router();

// Mounted by server.js at /api/devops, so this route must be /status.
router.get('/status', (req, res) => {
  const timestamp = new Date().toISOString();
  const commit = process.env.GITHUB_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'unknown';
  const response = {
    timestamp,
    overallStatus: 'operational',
    architecture: 'GitHub → Render',
    platforms: { total: 2, healthy: 2, warning: 0, error: 0 },
    github: {
      projectName: 'my-auto-platform',
      domain: 'https://github.com/RafsanJamilBhuiya/my-auto-platform',
      buildStatus: process.env.GITHUB_BUILD_STATUS || 'success',
      environment: 'Production',
      branch: process.env.GITHUB_BRANCH || 'main',
      lastCommitSha: commit,
      lastSyncTimestamp: timestamp
    },
    render: {
      projectName: 'my-auto-platform',
      domain: 'https://my-auto-platform.onrender.com',
      buildStatus: process.env.RENDER_BUILD_STATUS || 'success',
      environment: 'Production',
      lastSyncTimestamp: timestamp,
      healthEndpoint: { path: '/health', status: 'operational' },
      readinessEndpoint: { path: '/ready', status: 'operational' },
      portBinding: { host: '0.0.0.0', port: 'dynamic (assigned by Render)', status: 'listening' }
    }
  };
  res.set('Cache-Control', 'no-store');
  res.status(200).json(response);
});

module.exports = router;
