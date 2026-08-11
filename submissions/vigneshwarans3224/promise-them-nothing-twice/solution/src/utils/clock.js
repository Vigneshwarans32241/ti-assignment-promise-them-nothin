/**
 * Clock Provider Infrastructure
 * Implements Dependency Injection for system time retrieval.
 */

class SystemClock {
  /**
   * Returns current real system time.
   * Never reads client HTTP headers or transient request payloads.
   */
  now() {
    return new Date();
  }
}

class HarnessSimulatedClock {
  /**
   * Used exclusively during automated testing when ALLOW_SIMULATED_TIME=true.
   * Reads X-Simulated-Time header from harness request.
   */
  now(req) {
    if (req && req.get) {
      const headerVal = req.get('x-simulated-time');
      if (headerVal) {
        return new Date(headerVal);
      }
    }
    return new Date();
  }
}

/**
 * Creates the appropriate clock provider based on environment configuration.
 * Default in production is ALWAYS SystemClock.
 */
function createClockProvider() {
  if (process.env.ALLOW_SIMULATED_TIME === 'true') {
    console.log('[SECURITY NOTICE] Service started with ALLOW_SIMULATED_TIME=true (Harness Test Mode active)');
    return new HarnessSimulatedClock();
  }
  return new SystemClock();
}

module.exports = {
  SystemClock,
  HarnessSimulatedClock,
  createClockProvider
};
