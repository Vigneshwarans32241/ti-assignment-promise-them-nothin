/**
 * Distributed Multi-Process Cluster Verification Test
 * Spawns 3 isolated OS processes communicating over real TCP sockets with Redis.
 * Uses health check polling for deterministic readiness verification.
 */

const { fork } = require('child_process');
const path = require('path');
const http = require('http');
const Redis = require('ioredis');

const PORTS = [3001, 3002, 3003];
const redisClient = new Redis('redis://127.0.0.1:6379');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Polls all 3 cluster nodes until health checks return 200 OK
 */
async function waitForClusterReady() {
  for (const port of PORTS) {
    let ready = false;
    for (let attempts = 0; attempts < 30; attempts++) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/health`, res => {
            if (res.statusCode === 200) resolve();
            else reject(new Error(`Status ${res.statusCode}`));
          });
          req.on('error', reject);
          req.end();
        });
        ready = true;
        break;
      } catch (err) {
        await sleep(200);
      }
    }
    if (!ready) {
      throw new Error(`Node process on port ${port} failed to become ready.`);
    }
  }
}

async function testDistributedCluster() {
  console.log('--- Launching Multi-Process Cluster Integration Test ---');

  // Clear Redis state before test run
  await redisClient.flushall();

  // Spawn index.js cluster process
  const indexPath = path.join(__dirname, '..', 'index.js');
  const clusterProcess = fork(indexPath, [], {
    env: { ...process.env, REDIS_PORT: '6379' },
    stdio: 'inherit'
  });

  // Poll cluster nodes until all 3 ports (3001, 3002, 3003) respond healthy
  await waitForClusterReady();
  console.log('✅ Cluster health checks verified across ports 3001, 3002, 3003.\n');

  let allowedCount = 0;
  let rejectedCount = 0;
  let last429Body = null;

  console.log('Sending 65 requests for globex-inc (60 RPM limit) round-robin across Node 1, Node 2, Node 3 over TCP sockets...\n');

  for (let i = 0; i < 65; i++) {
    const port = PORTS[i % 3];
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
      } else {
        console.error(`Unexpected HTTP status ${res.status} from port ${port}`);
      }
    } catch (err) {
      console.error(`Request to port ${port} failed:`, err.message);
    }
  }

  console.log(`==========================================`);
  console.log(`DISTRIBUTED TEST RESULTS (3 OS Processes over TCP):`);
  console.log(`Allowed (200 OK): ${allowedCount}`);
  console.log(`Rejected (429):   ${rejectedCount}`);
  console.log(`==========================================\n`);

  if (last429Body) {
    console.log('Sample 429 Response over TCP:', JSON.stringify(last429Body, null, 2));
  }

  // Kill cluster processes
  clusterProcess.kill('SIGINT');
  redisClient.disconnect();
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
