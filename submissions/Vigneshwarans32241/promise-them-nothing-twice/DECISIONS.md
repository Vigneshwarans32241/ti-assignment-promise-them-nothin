# Architecture & Tradeoff Decisions

**Project:** RelayAPI Distributed Per-Customer Rate Limiter  
**Author:** Candidate Submission  

---

## 1. CTO vs. Support Lead Conflict Resolution

I resolved the conflict between Priya (CTO) and Marcus (Support Lead) by separating **Contracted Quota** (legal/billing paper numbers) from **Effective System Quota** (engine enforcement). 

Northwind's contracted quota remains 300 RPM. However, I built an auditable, config-driven **Scheduled Quota Override** mechanism that raises Northwind's Effective System Quota to 1,200 RPM during their 02:00–04:00 UTC nightly batch window.

### What I Explicitly Rejected:
* **Literal 300 RPM Enforcement During Batch:** Enforcing 300 RPM against Northwind’s 800–1,200 RPM workload would churn 60% of RelayAPI’s ARR and trigger aggressive client retry storms that degrade cluster performance for all tenants.
* **Hardcoded Code Hacks:** I rejected putting `if (customerId === 'northwind-logistics')` blocks inside middleware. The limiter engine is 100% customer-agnostic; it asks a `QuotaResolver` service for `(customerId, timestamp)` and enforces whatever rule record exists.
* **Unbounded / Invisible Bypasses:** Marcus asked for an "invisible exception." I rejected granting an infinite pass. The override is bounded (capped at 1,200 RPM), time-gated, audited with metadata (`reason`, `approved_by`), and carries a hard `expires_at` timestamp aligned with their 6-week renewal.

---

## 2. Algorithm & Distributed Coordination Choices

I selected the **Sliding Window Counter** algorithm backed by **atomic Redis Lua scripts**.

* **Why Sliding Window Counter over Token Bucket / Fixed Window:**
  * *Fixed Window* suffers from the boundary-burst flaw (allows 2× quota across minute edges), violating legal SLA mandates.
  * *Token Bucket* requires complex read-modify-write transactions across 3 stateless nodes, triggering race conditions or false 429s if split locally.
  * *Sliding Window Counter* uses $O(1)$ memory (only 2 integer counters per tenant) and solves boundary bursts by weighting past window progress.
* **Single-Script Atomicity:** All node instances execute an atomic Redis Lua script (`INCRBY` + `EXPIRE` + `GET prev_key`). Redis single-threaded execution eliminates cross-node race conditions over TCP sockets.
* **Ceil Rounding Policy:** Floating-point estimates use `Math.ceil()`. Per Priya's directive, if a calculation yields 299.1 requests against a 300 RPM limit, it rounds up to 300 immediately, ensuring the error direction always favors SLA integrity over over-allocation.
* **Fail-Closed Strategy:** If Redis connection drops, nodes do not fail open (which would permit un-metered traffic spikes). They fail closed, returning `HTTP 429` with a 5-second `Retry-After` header.
* **04:00:00 Cliff Effect Fix:** Dropping quota from 1,200 to 300 RPM at 04:00:00 UTC would cause the previous minute's 1,200 requests to poison the new 300 RPM ceiling, causing a 1-minute 429 blackout. I resolved this by enforcing half-open intervals `[start, end)` and passing a `reset_prev` flag to the Lua script during the transition minute (`04:00:00–04:01:00`), zeroing out past batch history while strictly enforcing 300 RPM on new incoming requests.

---

## 3. What the Harness Proves vs. What It Doesn't Prove

### What the Load Harness Proves:
1. **True Distributed State Sharing:** Proves 3 isolated OS processes running on ports 3001, 3002, and 3003 share exact counter state over TCP sockets connected to Redis.
2. **Ceiling Math & Cut-Off:** Proves exact cut-off at limit boundaries (e.g. 60 allowed / 5 rejected for Starter tier).
3. **Deterministic Boundary Seam Transitions:** Proves Northwind receives 300 RPM pre-batch, 1,200 RPM during batch, and steps down to 300 RPM post-batch without a blackout cliff.
4. **Security Header Protection:** Proves `ClockProvider` dependency injection prevents clients from spoofing system time via `X-Simulated-Time` headers in production.

### Honest Gaps (What the Harness Does *Not* Prove):
* **Un-Capped Spikes Above 1,200 RPM:** If Northwind's ERP spikes to 1,400 RPM during batch, they will still receive 429s. The harness does not test client behavior when 1,200 RPM is exceeded.
* **Redis High Availability & Failover:** The harness tests single-node Redis connectivity; it does not test Redis Sentinel, Cluster sharding, or network partition failover.
* **Sustained Multi-Hour Load:** Tests run in rapid burst scenarios rather than 120-minute sustained endurance runs.

---

## 4. What I Would Build Next with Another 4 Hours

1. **Dynamic Config Synchronization:** Replace the static configuration dictionary in `customerQuotas.js` with PostgreSQL database polling or Redis Pub/Sub invalidation so account managers can modify scheduled overrides in real-time without restarting worker nodes.
2. **Circuit-Breaker Local Fallback:** Implement a local emergency token bucket in Node memory that activates only when Redis is unreachable, allowing tenants a minimal 10% trickle-rate quota during Redis outages rather than hard 100% fail-closed rejections.
3. **Structured Audit Trail & Metrics:** Add Prometheus metrics counters (`rate_limit_allowed_total`, `rate_limit_rejected_total`, `rate_limit_fail_closed_total`) categorized by tenant ID for legal audit reviews.
4. **Adaptive Client Smoothing Headers:** Return customized `Retry-After` delay jitter recommendations in 429 response headers to smooth Northwind's aggressive ERP retry loops.

**Known Semgrep findings (accepted):** The scan flags HTTP-not-HTTPS in `harness.js` and missing CSRF middleware in `server.js`. Both are expected for this scope — the harness only talks to localhost test processes, and the API is stateless/header-authenticated rather than cookie/session-based, so CSRF protection doesn't apply.
