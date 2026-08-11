/**
 * RelayAPI Node Server
 * Stateless application node exposing /api/v1/ping protected by RateLimiter middleware.
 */

const express = require('express');
const { createRateLimiterMiddleware } = require('./middleware/rateLimiter');
const { getRedisClient } = require('./redis/redisClient');
const { createClockProvider } = require('./utils/clock');

function createServer(port = 3000, nodeId = 'node-1', redisClient = null, clockProvider = null) {
  const app = express();
  const redis = redisClient || getRedisClient();
  const clock = clockProvider || createClockProvider();

  app.use(express.json());

  // Mount Rate Limiter Middleware with injected ClockProvider
  app.use('/api/', createRateLimiterMiddleware(redis, clock));

  // Endpoint: GET /api/v1/ping
  app.get('/api/v1/ping', (req, res) => {
    res.status(200).json({
      status: 'ok',
      message: 'pong',
      nodeId,
      timestamp: new Date().toISOString(),
      clientQuota: req.customerQuota
    });
  });

  // Health check endpoint (bypasses customer rate limiter)
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', nodeId });
  });

  const server = app.listen(port, () => {
    console.log(`[${nodeId}] RelayAPI node process running on port ${port} (PID: ${process.pid})`);
  });

  return { app, server, redis };
}

// Allow direct process execution (node src/server.js)
if (require.main === module) {
  const port = process.env.PORT || 3000;
  const nodeId = process.env.NODE_ID || 'node-1';
  createServer(port, nodeId);
}

module.exports = {
  createServer
};
