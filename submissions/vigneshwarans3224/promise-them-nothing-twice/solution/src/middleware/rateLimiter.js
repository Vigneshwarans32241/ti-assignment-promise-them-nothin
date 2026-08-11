/**
 * Rate Limiter Middleware
 * Extracts X-Customer-Id, resolves effective quota, and enforces limits
 * using Redis-backed Sliding Window Counter with atomic Lua script.
 * Time retrieval is strictly injected via ClockProvider.
 */

const { resolveEffectiveQuota } = require('../services/quotaResolver');
const { checkRateLimit } = require('../services/slidingWindowLimiter');
const { SystemClock } = require('../utils/clock');

/**
 * Creates Express rate limiter middleware.
 * @param {object} redisClient - Redis instance
 * @param {object} [clockProvider] - Injected clock provider (defaults to SystemClock)
 */
function createRateLimiterMiddleware(redisClient, clockProvider = new SystemClock()) {
  return async function rateLimiter(req, res, next) {
    const customerId = req.get('x-customer-id');

    if (!customerId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required X-Customer-Id header'
      });
    }

    // Retrieve time strictly from injected clockProvider (SystemClock ignores request headers in prod)
    const now = clockProvider.now(req);

    // 1. Resolve Effective Quota & Boundary Transition State
    const quotaInfo = resolveEffectiveQuota(customerId, now);

    req.customerQuota = {
      customerId,
      effectiveRpm: quotaInfo.effectiveRpm,
      tier: quotaInfo.tier,
      activeOverrideId: quotaInfo.activeOverrideId,
      isBoundaryTransition: quotaInfo.isBoundaryTransition,
      resolvedAt: now.toISOString()
    };

    // 2. Check Atomic Redis Sliding Window Limiter
    const limitResult = await checkRateLimit(
      redisClient,
      customerId,
      quotaInfo.effectiveRpm,
      quotaInfo.isBoundaryTransition,
      now
    );

    // Set standard RateLimit headers
    res.setHeader('X-RateLimit-Limit', quotaInfo.effectiveRpm);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, quotaInfo.effectiveRpm - limitResult.estimatedCount));

    if (!limitResult.allowed) {
      res.setHeader('Retry-After', limitResult.retryAfterSeconds);

      return res.status(429).json({
        error: 'Too Many Requests',
        message: limitResult.failClosed
          ? 'Service temporarily unable to verify quota. Failing closed to protect SLA.'
          : `Rate limit of ${quotaInfo.effectiveRpm} RPM exceeded. Retry after ${limitResult.retryAfterSeconds} seconds.`,
        customerId,
        effectiveRpm: quotaInfo.effectiveRpm,
        estimatedCount: limitResult.estimatedCount,
        retryAfterSeconds: limitResult.retryAfterSeconds,
        failClosed: limitResult.failClosed
      });
    }

    // Allow request to proceed downstream
    next();
  };
}

module.exports = {
  createRateLimiterMiddleware
};
