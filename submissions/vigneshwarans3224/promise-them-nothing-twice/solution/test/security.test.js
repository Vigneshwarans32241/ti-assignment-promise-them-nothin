/**
 * Security Verification Test: Header Spoofing Protection
 * Verifies that clients CANNOT bypass rate limiting or alter quota windows by sending X-Simulated-Time headers.
 */

const assert = require('assert');
const { createServer } = require('../src/server');
const { getRedisClient } = require('../src/redis/redisClient');
const { SystemClock } = require('../src/utils/clock');

async function testHeaderSpoofProtection() {
  console.log('--- Running Security Verification Test: Header Spoof Protection ---');

  const redis = getRedisClient();
  // Server initialized explicitly with production SystemClock
  const instance = createServer(3097, 'sec-test-node', redis, new SystemClock());

  // Attempt to spoof Northwind's nightly batch window timestamp in HTTP request header
  const spoofHeader = '2026-03-14T02:30:00.000Z';
  const res = await fetch('http://localhost:3097/api/v1/ping', {
    headers: {
      'X-Customer-Id': 'northwind-logistics',
      'X-Simulated-Time': spoofHeader
    }
  });

  const body = await res.json();
  console.log('Production Node Response to Header Spoof Attempt:', body.clientQuota);

  // VERIFICATION 1: Effective RPM must NOT be 1200 (batch override), but baseline 300
  assert.strictEqual(
    body.clientQuota.effectiveRpm, 
    300, 
    'SECURITY VULNERABILITY: Client header successfully altered effective RPM!'
  );

  // VERIFICATION 2: Active override must be null
  assert.strictEqual(
    body.clientQuota.activeOverrideId, 
    null, 
    'SECURITY VULNERABILITY: Client header successfully activated scheduled override!'
  );

  console.log('✅ SECURITY PASSED: Production SystemClock completely ignored client header spoof attempt.');

  instance.server.close();
  instance.redis.disconnect();
}

testHeaderSpoofProtection().catch(err => {
  console.error('❌ Security Test Failed:', err);
  process.exit(1);
});
