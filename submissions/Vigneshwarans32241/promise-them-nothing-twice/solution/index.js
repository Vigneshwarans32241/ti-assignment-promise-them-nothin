/**
 * RelayAPI Distributed Multi-Process Launcher
 * Spawns 3 isolated Node OS processes (child_process.fork) on ports 3001, 3002, 3003.
 * All 3 processes connect via independent TCP sockets to the real Redis daemon (127.0.0.1:6379).
 */

const path = require('path');
const { fork } = require('child_process');

const PORTS = [3001, 3002, 3003];
const childProcesses = [];

function startDistributedCluster() {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  console.log(`--- Launching RelayAPI Distributed Multi-Process Cluster (Parent PID: ${process.pid}) ---`);
  console.log(`[Target Redis] Connecting to real Redis server at ${redisUrl}\n`);

  const serverPath = path.join(__dirname, 'src', 'server.js');

  PORTS.forEach((port, index) => {
    const nodeId = `node-${index + 1}`;

    const child = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: port.toString(),
        NODE_ID: nodeId,
        REDIS_URL: redisUrl
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    console.log(`[Parent] Spawned child OS process ${nodeId} (PID: ${child.pid}) listening on port ${port}`);
    childProcesses.push(child);
  });

  console.log(`\n✅ Spawned 3 isolated OS child processes (PIDs: ${childProcesses.map(c => c.pid).join(', ')}) connected via TCP to real Redis.\n`);
}

startDistributedCluster();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down child server processes...');
  childProcesses.forEach(child => child.kill());
  process.exit(0);
});
