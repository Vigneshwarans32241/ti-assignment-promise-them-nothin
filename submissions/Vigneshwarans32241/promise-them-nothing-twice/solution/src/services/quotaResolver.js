/**
 * QuotaResolver
 * Pure functional service to determine effective RPM for a customer at a specific timestamp.
 * Includes boundary transition detection to prevent cliff-effect blackouts.
 */

const { getCustomerConfig } = require('../config/customerQuotas');

/**
 * Helper to compute the minute string immediately following a HH:MM:SS time string.
 * e.g., '04:00:00' -> '04:01:00'
 */
function getNextMinuteString(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  const date = new Date(1970, 0, 1, h, m, s);
  date.setMinutes(date.getMinutes() + 1);
  return date.toTimeString().substring(0, 8);
}

/**
 * Resolves the effective RPM limit for a customer at a given date/time.
 * Uses half-open interval [start, end) for time windows.
 * Detects boundary transition minutes to prevent 429 cliff-effect blackouts.
 * 
 * @param {string} customerId 
 * @param {Date} [atTime] - Defaults to current UTC time
 * @returns {{ effectiveRpm: number, tier: string, activeOverrideId: string|null, isBoundaryTransition: boolean }}
 */
function resolveEffectiveQuota(customerId, atTime = new Date()) {
  const config = getCustomerConfig(customerId);

  if (!config) {
    return {
      effectiveRpm: 60,
      tier: 'Unknown',
      activeOverrideId: null,
      isBoundaryTransition: false
    };
  }

  const now = atTime instanceof Date ? atTime : new Date(atTime);
  const nowIsoString = now.toISOString();
  const currentTimeStr = nowIsoString.substring(11, 19); // "02:30:15"

  let activeOverrideId = null;
  let effectiveRpm = config.baseRpm;
  let isBoundaryTransition = false;

  for (const override of config.overrides || []) {
    if (!override.isActive) continue;

    if (override.expiresAt && new Date(override.expiresAt) <= now) {
      continue;
    }

    // 1. Check if currently inside active override window [start, end)
    if (currentTimeStr >= override.windowStartUTC && currentTimeStr < override.windowEndUTC) {
      effectiveRpm = override.overrideRpm;
      activeOverrideId = override.id;
      break;
    }

    // 2. Check if we are in the boundary transition minute immediately following override end
    // e.g. windowEnd = '04:00:00', transition minute = '04:00:00' to '04:01:00'
    const transitionEndStr = getNextMinuteString(override.windowEndUTC);
    if (currentTimeStr >= override.windowEndUTC && currentTimeStr < transitionEndStr) {
      isBoundaryTransition = true;
    }
  }

  return {
    effectiveRpm,
    tier: config.tier,
    activeOverrideId,
    isBoundaryTransition
  };
}

module.exports = {
  resolveEffectiveQuota
};
