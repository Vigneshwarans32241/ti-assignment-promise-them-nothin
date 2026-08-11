/**
 * Unit Test for Sliding Window Limiter, Fail-Closed Behavior & Boundary Transition Reset
 */

const assert = require('assert');
const { calculateSlidingWindowEstimate, checkRateLimit } = require('../src/services/slidingWindowLimiter');
const { resolveEffectiveQuota } = require('../src/services/quotaResolver');

console.log('--- Running Sliding Window Limiter Unit Tests ---');

// Test 1: Ceil Rounding Estimate Calculation
{
  const nowHalfway = new Date('2026-03-14T02:30:30.000Z');
  const estimate1 = calculateSlidingWindowEstimate(50, 100, nowHalfway);
  assert.strictEqual(estimate1, 100, 'Test 1a failed');

  const nowFractional = new Date('2026-03-14T02:30:30.100Z');
  const estimate2 = calculateSlidingWindowEstimate(50, 100, nowFractional);
  assert.strictEqual(estimate2, 100, 'Test 1b failed: Ceil rounding should round up 99.8333 to 100');
  console.log('✅ Test 1 Passed: Ceil rounding correctly rounds fractional estimates up.');
}

// Test 2: Fail-Closed Behavior on Redis Connection Error
{
  const mockFailingRedis = {
    eval: async () => {
      throw new Error('ECONNREFUSED: Connection to Redis failed');
    }
  };

  async function testFailClosed() {
    const result = await checkRateLimit(mockFailingRedis, 'northwind-logistics', 1200);
    assert.strictEqual(result.allowed, false, 'Fail-Closed Test Failed');
    assert.strictEqual(result.failClosed, true, 'Fail-Closed Test Failed');
    assert.strictEqual(result.retryAfterSeconds, 5, 'Fail-Closed Test Failed');
    console.log('✅ Test 2 Passed: Fail-closed logic correctly rejects requests when Redis errors out.');
  }

  testFailClosed().catch(err => {
    console.error('❌ Test 2 Failed:', err);
    process.exit(1);
  });
}

// Test 3: Boundary Transition Detection & Reset
{
  const duringBatch = resolveEffectiveQuota('northwind-logistics', new Date('2026-03-14T03:59:59Z'));
  assert.strictEqual(duringBatch.effectiveRpm, 1200);
  assert.strictEqual(duringBatch.isBoundaryTransition, false);

  const exactTransitionMinute = resolveEffectiveQuota('northwind-logistics', new Date('2026-03-14T04:00:15Z'));
  assert.strictEqual(exactTransitionMinute.effectiveRpm, 300);
  assert.strictEqual(exactTransitionMinute.isBoundaryTransition, true, 'Should detect boundary transition at 04:00:15');

  const afterTransitionMinute = resolveEffectiveQuota('northwind-logistics', new Date('2026-03-14T04:02:00Z'));
  assert.strictEqual(afterTransitionMinute.effectiveRpm, 300);
  assert.strictEqual(afterTransitionMinute.isBoundaryTransition, false);

  console.log('✅ Test 3 Passed: Boundary transition at 04:00:00 correctly flagged for Redis Lua script key reset.');
}
