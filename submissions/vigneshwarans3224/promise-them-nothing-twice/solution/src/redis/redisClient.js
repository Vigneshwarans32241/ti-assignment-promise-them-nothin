/**
 * Redis Client Factory
 * Connects directly over TCP to real production Redis (redis://127.0.0.1:6379 or process.env.REDIS_URL).
 * Absolutely no custom servers or in-memory mocks permitted.
 */

const Redis = require('ioredis');

/**
 * Creates a real TCP Redis connection.
 * @param {string} [customUrl]
 * @returns {Redis}
 */
function getRedisClient(customUrl) {
  const redisUrl = customUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) return null; // Fail fast for fail-closed behavior
      return 200;
    },
    connectTimeout: 2000
  });

  client.on('error', (err) => {
    // Log TCP connection error for fail-closed diagnosis
  });

  return client;
}

module.exports = {
  getRedisClient
};
