/**
 * Sliding Window Counter Rate Limiter (Redis-backed)
 * 
 * Provides atomic execution via Redis Lua script:
 * 1. Atomically increments current minute counter
 * 2. Fetches previous minute counter
 * 3. Sets key expiration (120s TTL)
 * 4. Supports boundary transition reset (prevents "cliff effect" blackouts)
 * 5. Returns exact counts for floating point ceiling estimation
 */

// Atomic Redis Lua Script with Boundary Transition Support
const SLIDING_WINDOW_LUA_SCRIPT = `
  local curr_key = KEYS[1]
  local prev_key = KEYS[2]
  local increment = tonumber(ARGV[1])
  local ttl_seconds = tonumber(ARGV[2])
  local reset_prev = tonumber(ARGV[3]) -- 1 if transitioning from high -> low quota window

  -- Atomically increment current minute window
  local curr_count = redis.call('INCRBY', curr_key, increment)
  
  -- Ensure key expires after 120s
  if curr_count == increment then
    redis.call('EXPIRE', curr_key, ttl_seconds)
  end

  -- If boundary transition flag is set (e.g. 04:00:00 batch window end),
  -- zero out previous count to prevent past 1200 RPM volume from blocking 300 RPM baseline.
  local prev_count = 0
  if reset_prev ~= 1 then
    local prev_count_raw = redis.call('GET', prev_key)
    if prev_count_raw then
      prev_count = tonumber(prev_count_raw)
    end
  end

  return { curr_count, prev_count }
`;

/**
 * Calculates sliding window estimated request count.
 * 
 * Formula: Math.ceil(prevCount * (1 - secondsIntoMinute / 60) + currCount)
 */
function calculateSlidingWindowEstimate(currCount, prevCount, now) {
  const secondsIntoMinute = now.getUTCSeconds() + (now.getUTCMilliseconds() / 1000.0);
  const progress = secondsIntoMinute / 60.0;
  const weight = 1.0 - progress;

  const rawEstimate = (prevCount * weight) + currCount;
  return Math.ceil(rawEstimate);
}

/**
 * Checks rate limit for a customer against Redis state.
 * 
 * @param {object} redisClient - ioredis or compatible Redis instance
 * @param {string} customerId 
 * @param {number} effectiveRpm 
 * @param {boolean} [isBoundaryTransition=false] - True if transitioning from override to baseline
 * @param {Date} [now] 
 */
async function checkRateLimit(redisClient, customerId, effectiveRpm, isBoundaryTransition = false, now = new Date()) {
  const nowMs = now.getTime();
  const currentMinuteUnix = Math.floor(nowMs / 60000) * 60;
  const prevMinuteUnix = currentMinuteUnix - 60;

  const currKey = `ratelimit:${customerId}:${currentMinuteUnix}`;
  const prevKey = `ratelimit:${customerId}:${prevMinuteUnix}`;

  try {
    // Execute Atomic Redis Lua Script with reset_prev flag (1 or 0)
    const resetPrevFlag = isBoundaryTransition ? 1 : 0;
    const [currCount, prevCount] = await redisClient.eval(
      SLIDING_WINDOW_LUA_SCRIPT,
      2,                // Number of KEYS
      currKey,          // KEYS[1]
      prevKey,          // KEYS[2]
      1,                // ARGV[1]: increment by 1
      120,              // ARGV[2]: TTL seconds
      resetPrevFlag     // ARGV[3]: reset_prev flag
    );

    const estimatedCount = calculateSlidingWindowEstimate(currCount, prevCount, now);
    const allowed = estimatedCount <= effectiveRpm;
    const remainingSecondsInMinute = 60 - now.getUTCSeconds();

    return {
      allowed,
      estimatedCount,
      currentMinuteCount: currCount,
      previousMinuteCount: prevCount,
      isBoundaryTransition,
      effectiveRpm,
      retryAfterSeconds: allowed ? 0 : Math.max(1, remainingSecondsInMinute),
      failClosed: false
    };

  } catch (error) {
    // FAIL-CLOSED BEHAVIOR
    console.error('[FAIL-CLOSED] Redis error during rate limit check for %s:', customerId, error.message);

    return {
      allowed: false,
      estimatedCount: -1,
      currentMinuteCount: -1,
      previousMinuteCount: -1,
      effectiveRpm,
      retryAfterSeconds: 5,
      failClosed: true,
      error: error.message
    };
  }
}

module.exports = {
  SLIDING_WINDOW_LUA_SCRIPT,
  calculateSlidingWindowEstimate,
  checkRateLimit
};
