/**
 * Distributed Multi-Process Cluster Verification Test
 * Spawns 3 isolated OS processes communicating over real TCP sockets with Redis.
 */

const { fork } = require('child_process');
const path = require('path');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testDistributedCluster() {
  console.log('--- Launching Multi-Process Cluster Integration Test ---');

  // Spawn index.js cluster process
  const indexPath = path.join(__dirname, '..', 'index.js');
  const clusterProcess = fork(indexPath, [], {
    env: { ...process.env, REDIS_PORT: '6379' },
    stdio: 'inherit'
  });

  // Give child processes time to boot and establish TCP Redis sockets
  await sleep(4000);

  const ports = [3001, 3002, 3003];
  let allowedCount = 0;
  let rejectedCount = 0;
  let last429Body = null;

  console.log('\nSending 65 requests for globex-inc (60 RPM limit) round-robin across Node 1, Node 2, Node 3 over TCP sockets...\n');

  for (let i = 0; i < 65; i++) {
    const port = ports[i % 3];
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/ping`, {
        headers: { 'X-Customer-Id': 'globex-inc' }
      });

      if (res.status === 200) {
        allowedCount++;
      } else if (res.status === 429) {
        rejectedCount++;
        if (!last429Body) {
          last429Body = await res.json();
        }
      }
    } catch (err) {
      console.error(`Request to port ${port} failed:`, err.message);
    }
  }

  console.log(`\n==========================================`);
  console.log(`DISTRIBUTED TEST RESULTS (3 OS Processes over TCP):`);
  console.log(`Allowed (200 OK): ${allowedCount}`);
  console.log(`Rejected (429):   ${rejectedCount}`);
  console.log(`==========================================\n`);

  if (last429Body) {
    console.log('Sample 429 Response over TCP:', JSON.stringify(last429Body, null, 2));
  }

  // Kill cluster processes
  clusterProcess.kill('SIGINT');
  await sleep(1000);

  if (allowedCount === 60 && rejectedCount === 5) {
    console.log('\n✅ VERIFICATION SUCCESS: Distributed 3-process rate limiter enforced limits across TCP sockets with 100% precision.');
    process.exit(0);
  } else {
    console.error('\n❌ VERIFICATION FAILED: Counts did not match expected 60 allowed / 5 rejected.');
    process.exit(1);
  }
}

testDistributedCluster().catch(err => {
  console.error('Cluster integration test failed:', err);
  process.exit(1);
});
