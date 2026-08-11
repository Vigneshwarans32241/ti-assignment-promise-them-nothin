# RelayAPI Per-Customer Rate Limiter & Load Harness

A distributed, per-customer rate limiting service backed by Redis, implementing an atomic Sliding Window Counter with scheduled quota overrides for Enterprise batch windows.

> **Note:** Redis is a **hard requirement** for this service — state is maintained via atomic Redis Lua scripts across 3 isolated processes over TCP. There are zero in-memory fallback mocks.

---

## Prerequisites

* **Node.js:** v18.0.0 or higher (`node -v`)
* **Redis Server:** Running locally on port `6379` (`redis-cli ping` returns `PONG`)

---

## 1. Installation & Environment Setup

### Start Local Redis Server
Ensure Redis daemon is active on port `6379`:

```bash
# Ubuntu / Debian / WSL:
sudo service redis-server start

# macOS (Homebrew):
brew services start redis

# Docker alternative:
docker run -d -p 6379:6379 --name relayapi-redis redis:alpine

# Verify Redis connection
redis-cli ping
# Expected output: PONG
```

### Install Dependencies
```bash
cd solution
npm install
```

---

## 2. Running the 3-Node Cluster

Launch the 3 stateless application worker processes:

```bash
npm start
```

### Confirming True 3-Process Isolation
Upon running `npm start`, the launcher spawns 3 isolated Node child processes (`child_process.fork`). 

You can confirm 4 distinct OS processes are active in a separate terminal:

```bash
# Linux / WSL / macOS
ps aux | grep node
```

**Expected Process Hierarchy:**
```text
node index.js                              # Parent Cluster Launcher
├── node src/server.js (PID 1, Port 3001)  # Node 1
├── node src/server.js (PID 2, Port 3002)  # Node 2
└── node src/server.js (PID 3, Port 3003)  # Node 3
```

Each worker process runs in its own isolated V8 memory runtime and connects over TCP sockets (`ioredis`) to `redis://127.0.0.1:6379`.

---

## 3. Running the Load Harness & Verification

The load harness drives requests round-robin across ports `3001`, `3002`, and `3003` at boundary conditions, testing baseline limits, scheduled batch overrides, boundary resets, and security header-spoof protection.

Run the harness deliverable:

```bash
npm run harness
```

### Expected Output Report

```text
========================================================================================
                 RELAYAPI DISTRIBUTED RATE LIMITER LOAD HARNESS REPORT                  
========================================================================================
Spawning 3-Node Cluster in Isolated Test Mode (ALLOW_SIMULATED_TIME=true)...
[Target Redis] Connecting to real Redis server at redis://127.0.0.1:6379

✅ Spawned 3 isolated OS child processes (PIDs: 5812, 5813, 5814) connected via TCP to real Redis.
✅ Cluster health checks verified across ports 3001, 3002, 3003.

+--------------------------------------------------------------------+------+---------+----------+----------+
| SCENARIO                                                           | SENT | ALLOWED | REJECTED | RESULT   |
+--------------------------------------------------------------------+------+---------+----------+----------+
| 1. Starter Tier Baseline (globex-inc @ 60 RPM)                     |   65 |      60 |        5 | PASS ✅  |
| 2. Northwind Pre-Batch Window (01:59:50 UTC @ 300 RPM limit)       |  310 |     300 |       10 | PASS ✅  |
| 3. Northwind Nightly Batch Active (02:30:00 UTC @ 1,200 RPM limit) | 1210 |    1200 |       10 | PASS ✅  |
| 4. Northwind Post-Batch Transition (04:00:15 UTC @ 300 RPM limit)  |  310 |     300 |       10 | PASS ✅  |
| 5. Northwind Upward Transition Seam (01:59:55 -> 02:00:05 UTC)     | 1240 |    1224 |       16 | PASS ✅  |
+--------------------------------------------------------------------+------+---------+----------+----------+
```

---

## 4. Manual `curl` Verification

You can test individual HTTP endpoints manually:

```bash
# 1. Standard Starter Tier (60 RPM limit)
curl -i -H "X-Customer-Id: globex-inc" http://localhost:3001/api/v1/ping

# 2. Hit different app nodes (proves cluster state sharing over Redis TCP)
curl -i -H "X-Customer-Id: globex-inc" http://localhost:3002/api/v1/ping
curl -i -H "X-Customer-Id: globex-inc" http://localhost:3003/api/v1/ping

# 3. Northwind Logistics Baseline (300 RPM limit)
curl -i -H "X-Customer-Id: northwind-logistics" http://localhost:3001/api/v1/ping
```

### Running Unit & Security Tests

To verify unit logic and security header-spoof protection:

```bash
# Unit test for sliding window math, ceil rounding, and fail-closed error handling
npm test

# Security test: Verifies production nodes ignore X-Simulated-Time client headers
node test/security.test.js
```
