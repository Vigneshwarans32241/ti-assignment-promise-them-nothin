/**
 * RelayAPI Load Harness & Boundary Verifier
 * 
 * Drives the distributed 3-node rate limiter service at boundary conditions.
 * Launches the 3-node cluster explicitly in TEST MODE (ALLOW_SIMULATED_TIME=true)
 * to verify deterministic time boundary transitions without exposing header spoofing in production.
 */

const { fork } = require('child_process');
const path = require('path');
// nosemgrep: problem-based-packs.insecure-transport.js-node.using-http-server.using-http-server -- Localhost-only test harness driving local process benchmarks
const http = require('http');
const Redis = require('ioredis');

const PORTS = [3001, 3002, 3003];
const redisClient = new Redis('redis://127.0.0.1:6379');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function flushRedis() {
  await redisClient.flushall();
}

/**
 * Polls cluster nodes until all 3 health checks return 200 OK
 */
async function waitForClusterReady() {
  for (const port of PORTS) {
    let ready = false;
    for (let attempts = 0; attempts < 30; attempts++) {
      try {
        await new Promise((resolve, reject) => {
          // nosemgrep: problem-based-packs.insecure-transport.js-node.http-request.http-request -- Localhost-only test harness driving local process benchmarks
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
      throw new Error(`Node on port ${port} failed to become ready.`);
    }
  }
}

function sendRequest(port, customerId, customTime = null) {
  return new Promise((resolve) => {
    const headers = {
      'X-Customer-Id': customerId
    };
    if (customTime) {
      headers['X-Simulated-Time'] = customTime.toISOString();
    }

    // nosemgrep: problem-based-packs.insecure-transport.js-node.http-request.http-request -- Localhost-only test harness driving local process benchmarks
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/ping',
      method: 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : {}
        });
      });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 500, error: err.message });
    });

    req.end();
  });
}

async function driveLoad({ customerId, requestCount, simulatedTime = null }) {
  const promises = [];
  for (let i = 0; i < requestCount; i++) {
    const targetPort = PORTS[i % 3];
    promises.push(sendRequest(targetPort, customerId, simulatedTime));
  }
  const responses = await Promise.all(promises);

  let allowed = 0;
  let rejected = 0;
  let failClosedCount = 0;
  let errorCount = 0;

  responses.forEach(res => {
    if (res.statusCode === 200) allowed++;
    else if (res.statusCode === 429) {
      rejected++;
      if (res.body && res.body.failClosed) {
        failClosedCount++;
      }
    } else {
      errorCount++;
    }
  });

  return { allowed, rejected, failClosedCount, errorCount, total: requestCount };
}

async function runHarness() {
  console.log('========================================================================================');
  console.log('                 RELAYAPI DISTRIBUTED RATE LIMITER LOAD HARNESS REPORT                  ');
  console.log('========================================================================================');
  console.log('Spawning 3-Node Cluster in Isolated Test Mode (ALLOW_SIMULATED_TIME=true)...');

  // Spawn cluster in test mode
  const indexPath = path.join(__dirname, 'index.js');
  const clusterProcess = fork(indexPath, [], {
    env: { ...process.env, ALLOW_SIMULATED_TIME: 'true' },
    stdio: 'inherit'
  });

  await waitForClusterReady();
  console.log('✅ Cluster health checks verified across ports 3001, 3002, 3003.\n');

  const results = [];

  // Scenario 1: Standard Starter Customer Baseline Enforcement (globex-inc @ 60 RPM limit)
  {
    await flushRedis();
    const scenarioName = '1. Starter Tier Baseline (globex-inc @ 60 RPM)';
    const load = await driveLoad({ customerId: 'globex-inc', requestCount: 65 });
    const expectedAllowed = 60;
    const expectedRejected = 5;
    const passed = (load.allowed === expectedAllowed && load.rejected === expectedRejected);

    results.push({
      scenario: scenarioName,
      sent: load.total,
      allowed: load.allowed,
      rejected: load.rejected,
      expectedAllowed,
      expectedRejected,
      status: passed ? 'PASS ✅' : 'FAIL ❌'
    });
  }

  // Scenario 2: Northwind Pre-Batch Window (01:59:50 UTC - Baseline Enterprise 300 RPM)
  {
    await flushRedis();
    const scenarioName = '2. Northwind Pre-Batch Window (01:59:50 UTC @ 300 RPM limit)';
    const preBatchTime = new Date('2026-03-14T01:59:50.000Z');
    const load = await driveLoad({ customerId: 'northwind-logistics', requestCount: 310, simulatedTime: preBatchTime });
    const expectedAllowed = 300;
    const expectedRejected = 10;
    const passed = (load.allowed === expectedAllowed && load.rejected === expectedRejected);

    results.push({
      scenario: scenarioName,
      sent: load.total,
      allowed: load.allowed,
      rejected: load.rejected,
      expectedAllowed,
      expectedRejected,
      status: passed ? 'PASS ✅' : 'FAIL ❌'
    });
  }

  // Scenario 3: Northwind Nightly Batch Active (02:30:00 UTC - Scheduled Override 1,200 RPM)
  {
    await flushRedis();
    const scenarioName = '3. Northwind Nightly Batch Active (02:30:00 UTC @ 1,200 RPM limit)';
    const batchActiveTime = new Date('2026-03-14T02:30:00.000Z');
    const load = await driveLoad({ customerId: 'northwind-logistics', requestCount: 1210, simulatedTime: batchActiveTime });
    const expectedAllowed = 1200;
    const expectedRejected = 10;
    const passed = (load.allowed === expectedAllowed && load.rejected === expectedRejected);

    results.push({
      scenario: scenarioName,
      sent: load.total,
      allowed: load.allowed,
      rejected: load.rejected,
      expectedAllowed,
      expectedRejected,
      status: passed ? 'PASS ✅' : 'FAIL ❌'
    });
  }

  // Scenario 4: Northwind Post-Batch Boundary Transition (04:00:15 UTC - Step-down to 300 RPM)
  {
    await flushRedis();
    const batchEndMinuteUnix = Math.floor(new Date('2026-03-14T03:59:00.000Z').getTime() / 60000) * 60;
    await redisClient.set(`ratelimit:northwind-logistics:${batchEndMinuteUnix}`, '1200');

    const scenarioName = '4. Northwind Post-Batch Transition (04:00:15 UTC @ 300 RPM limit)';
    const postBatchTime = new Date('2026-03-14T04:00:15.000Z');
    const load = await driveLoad({ customerId: 'northwind-logistics', requestCount: 310, simulatedTime: postBatchTime });
    const expectedAllowed = 300;
    const expectedRejected = 10;
    const passed = (load.allowed === expectedAllowed && load.rejected === expectedRejected);

    results.push({
      scenario: scenarioName,
      sent: load.total,
      allowed: load.allowed,
      rejected: load.rejected,
      expectedAllowed,
      expectedRejected,
      status: passed ? 'PASS ✅' : 'FAIL ❌'
    });
  }

  // Scenario 5: Northwind Upward Boundary Seam (01:59:55 UTC -> 02:00:05 UTC Transition 300 -> 1,200 RPM)
  {
    await flushRedis();
    const scenarioName = '5. Northwind Upward Transition Seam (01:59:55 -> 02:00:05 UTC 300->1,200 RPM)';
    
    // Step A: Send 290 requests at 01:59:55 UTC (Pre-batch, 300 RPM limit)
    const stepATime = new Date('2026-03-14T01:59:55.000Z');
    const loadA = await driveLoad({ customerId: 'northwind-logistics', requestCount: 290, simulatedTime: stepATime });

    // Step B: Send 950 requests at 02:00:05 UTC (Batch starts, 1,200 RPM limit, weighted prev = 290 * (55/60) ≈ 266)
    const stepBTime = new Date('2026-03-14T02:00:05.000Z');
    const loadB = await driveLoad({ customerId: 'northwind-logistics', requestCount: 950, simulatedTime: stepBTime });

    // Headroom calculation: 1200 - ceil(290 * 55 / 60) = 1200 - 266 = 934 allowed in Step B
    const totalSent = loadA.total + loadB.total;          // 1240
    const totalAllowed = loadA.allowed + loadB.allowed;  // 290 + 934 = 1224
    const totalRejected = loadA.rejected + loadB.rejected; // 16

    const expectedAllowed = 1224;
    const expectedRejected = 16;
    const passed = (totalAllowed === expectedAllowed && totalRejected === expectedRejected);

    results.push({
      scenario: scenarioName,
      sent: totalSent,
      allowed: totalAllowed,
      rejected: totalRejected,
      expectedAllowed,
      expectedRejected,
      status: passed ? 'PASS ✅' : 'FAIL ❌'
    });
  }

  // Print Results Table
  console.log('\n+--------------------------------------------------------------------+------+---------+----------+----------+');
  console.log('| SCENARIO                                                           | SENT | ALLOWED | REJECTED | RESULT   |');
  console.log('+--------------------------------------------------------------------+------+---------+----------+----------+');

  results.forEach(r => {
    const namePad = r.scenario.padEnd(66);
    const sentPad = String(r.sent).padStart(4);
    const allowedPad = String(r.allowed).padStart(7);
    const rejectedPad = String(r.rejected).padStart(8);
    console.log(`| ${namePad} | ${sentPad} | ${allowedPad} | ${rejectedPad} | ${r.status}  |`);
  });
  console.log('+--------------------------------------------------------------------+------+---------+----------+----------+\n');

  // Kill cluster test process
  clusterProcess.kill('SIGINT');
  redisClient.disconnect();
}

runHarness().catch(err => {
  console.error('Harness execution failed:', err);
  process.exit(1);
});
