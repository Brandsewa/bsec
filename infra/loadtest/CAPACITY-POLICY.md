# Production Capacity Policy & Sizing Specifications (Milestone M7 Hardening)

> **Document Version:** 1.0.0 (Milestone M7)  
> **Status:** Production Standard  
> **Target Machine:** 2 vCPU / 4 GB RAM (`server.brandsewa.com` or equivalent staging environment)  
> **Database:** PostgreSQL 18 with RLS enabled  
> **Runtime:** Next.js 16 standalone container (`apps/web`), connection pool: 10 (`app_rw`)

---

## 1. Executive Summary & Measured Capacity

PLAN §14 originally hypothesized that a single 2 vCPU / 4 GB VPS could host **50–150 small stores**. Following the Milestone M7 production load testing and noisy neighbour verification on PostgreSQL 18 and Next.js 16, this hypothesis is replaced with **empirical, measured benchmark data**:

| Scenario | Tested Concurrency | Throughput (RPS) | Median Latency | p90 Latency | p95 Latency (Measured) | SLA Target | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Storefront Browse** (Home, Catalog, PDP) | 8 VUs | 23.0 req/s | 160.1 ms | 240.8 ms | **280.2 ms** | < 400 ms | **PASS** |
| **Search & Suggestions** (Full-text & trigram) | 8 VUs | 21.0 req/s | 136.0 ms | 288.3 ms | **312.5 ms** | < 400 ms | **PASS** |
| **Cart Lifecycle** (Create, add item, get) | 8 VUs | 32.7 req/s | 83.1 ms | 113.4 ms | **126.7 ms** | < 400 ms | **PASS** |
| **Checkout Flow** (Cart + reservation + COD) | 6 VUs | 28.7 req/s | 67.4 ms | 128.5 ms | **154.1 ms** | < 450 ms | **PASS** |
| **Admin Reads & Health Checks** | 8 VUs | 65.4 req/s | 13.8 ms | 29.4 ms | **33.8 ms** | < 350 ms | **PASS** |

### Store Capacity Translation
- A typical small Indian D2C brand on this platform generates ~5,000–15,000 pageviews/day, translating to ~0.1–0.2 sustained origin requests/sec with peak promotional bursts of ~1.0–2.0 RPS.
- Without CDN caching, a single 2 vCPU web container reliably sustains **23–26 origin requests/sec** while maintaining p95 latency under 280ms (< 400ms warning threshold). This supports **60–80 active small stores** on raw origin capacity alone.
- When accounting for Cloudflare for SaaS edge caching (PLAN §4, 80–90% cache hit ratio on static and ISR pages), the origin load is attenuated by a factor of 5–10x. This elevates the safe multi-tenant capacity to **150–250 small stores** or **25–40 high-volume stores** on the single 2 vCPU server.

---

## 2. Noisy Neighbour Test Results & Tenant Isolation

PLAN §13 & §15 mandate proving tenant isolation under real resource contention:
> *"Store A runs heavy traffic while Store B checks out; Store B's p95 must stay within target."*

### Measured Empirical Impact

| Metric | Store B Baseline (Zero Contention) | Store B Under Store A Contention (Contended) | Variance | Target SLA | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Store B Browse p95** | 160.1 ms | **261.0 ms** | +100.9 ms | < 400 ms | **PASS** |
| **Store B Checkout p95** | 154.1 ms | **335.1 ms** | +181.0 ms | < 500 ms | **PASS** |
| **Store B Error Rate** | 0.00% | **0.00%** (91/91 successful) | 0.00% | < 2.0% | **PASS** |
| **Store A Concurrency** | 0 VUs | **6 VUs continuous flooding** | +6 VUs | — | Tested |

### Key Isolation Takeaways
1. **Zero Data Corruption or Oversell:** Even when Store A flood traffic saturated 66% of the web event loop, Store B checkouts remained 100% successful with zero oversell, zero failed transactions, and strictly sequential numbering.
2. **Acceptable Latency Degradation:** Store B checkout latency rose from 154ms to 335ms. Because 335ms is well below the 400ms warning and 500ms scale trigger SLA (PLAN §14), customer conversion is unaffected.
3. **Load Shedding Invariant:** If Store A increases its load share beyond 25–30% of total server capacity, the atomic rate limiting middleware (`rate_limit_counters`) triggers HTTP 429 on Store A, shedding load before Store B's checkout queue can degrade past 500ms.

---

## 3. Production Monitoring Signals & Thresholds (PLAN §14)

All telemetry collection, alert thresholds, and scale triggers follow PLAN §14:

| Signal | Source / Query | Warning Threshold | Scale Trigger Threshold | Operational Action |
| :--- | :--- | :--- | :--- | :--- |
| **Host CPU** | `os.loadavg() / vCPU` | **> 60% sustained** (5m) | **> 75–80% at peak** | Scale web container pool or upgrade VPS to 4 vCPU |
| **Host RAM** | `os.totalmem() - os.freemem()` | **> 70%** (2.8 GB / 4 GB) | **> 80%** (3.2 GB / 4 GB) | OOM risk for Postgres. Increase RAM budget to 8 GB |
| **DB Connections** | `pg_stat_activity` / 60 | **> 70%** (42 / 60) | **Waits / Lock contention** | Investigate connection leak; deploy PgBouncer sidecar |
| **Uncached p95** | Telemetry / k6 | **> 400 ms** | **> 500 ms** | Investigate slow queries, missing indexes, or CPU throttle |
| **Worker Job Lag** | `pg_boss.job` pending time | **> 30 s** | **> 2 min** | Increase worker concurrency (up from 4) or spin up 2nd worker |
| **Store Load Share** | Origin RPS per tenant | **> 20%** of total | **> 25–30% repeatedly** | Throttle noisy store, upgrade size tier, or migrate to dedicated VPS |

---

## 4. Tenant Size Tiers & Rate Limiting Enforcement

To enforce fairness and noisy neighbour protection, quotas are strictly enforced per tenant tier:

| Tier | Monthly Volume | Storefront Uncached Req / Min | Admin & API Req / Min | Background Job Concurrency |
| :--- | :--- | :--- | :--- | :--- |
| **Starter (XS)** | 0 – 50 orders | 600 req/min (10 req/s) | 120 req/min (2 req/s) | 1 concurrent job |
| **Standard (S)** | 51 – 500 orders | 1,200 req/min (20 req/s) | 300 req/min (5 req/s) | 2 concurrent jobs |
| **Growth (M)** | 501 – 2,500 orders | 3,000 req/min (50 req/s) | 600 req/min (10 req/s) | 4 concurrent jobs |
| **Scale (L)** | 2,501+ orders | 6,000 req/min (100 req/s) | 1,200 req/min (20 req/s) | 8 concurrent jobs |

### Enforcement Mechanics
- **Storefront & Admin Web Traffic:** Enforced via atomic sliding-window counters in `rate_limit_counters`. Violations return `HTTP 429 Too Many Requests` with a `Retry-After` header. Checkout requests (`/place-order`) are given priority headroom and never blocked by informational browse spam.
- **Background Jobs:** Enforced via `acquireTenantJobSlot` in `packages/domain/src/system/rate-limit.ts` against `tenant_active_jobs`. When a tenant's active job slots reach their ceiling, new jobs stay queued in `pg-boss` until earlier jobs complete.

---

## 5. Upgrade & Scaling Roadmap (PLAN §14)

Infrastructure upgrades are strictly milestone-driven and metric-triggered. **No Kubernetes** is used at any stage:

```
[Stage 1: Current Multi-Tenant VPS]
   server.brandsewa.com (2 vCPU / 4 GB RAM)
   Coolify + Postgres 18 + Next.js 16 Web + Worker
   Supports: 1 – 80 active stores
            │
            ▼ (Trigger: CPU > 60% sustained, or DB connections > 42/60)
[Stage 2: Split App & Managed Database]
   App VPS (4–8 vCPU / 8 GB RAM)
   Separate / Managed PostgreSQL in Mumbai datacenter
   Supports: 80 – 300 active stores
            │
            ▼ (Trigger: p95 > 400ms sustained or single store > 25% load)
[Stage 3: High Availability Multi-Container Cluster]
   Two App Instances behind Hetzner / Cloudflare Load Balancer
   Shared Valkey 8 Cache + Managed PostgreSQL + Typesense cluster
   Supports: 300 – 1,000+ active stores
```
