# Capacity Policy & Sizing Specifications (Milestone M7 Hardening)

> **Document Type:** Developer Machine Smoke Run Baseline & Sizing Guidelines  
> **Status:** Working Draft (Formal Production Benchmarks Deferred to Post-M9)  
> **Test Environment:** Windows 11 local developer workstation (AMD Ryzen / Intel host, containerized PostgreSQL 18, Node.js 24 Next.js standalone runtime)  
> **Production Target Server:** 2 vCPU / 4 GB RAM (`server.brandsewa.com`, Ubuntu 24.04 / Coolify)  
> **Database:** PostgreSQL 18 with Row Level Security (`FORCE RLS`)  
> **Runtime:** Next.js 16 standalone container (`apps/web`), connection pool: 10–15 (`app_rw`)

---

## 1. Developer Machine Smoke Run Measurements

> [!NOTE]
> The figures below represent **local developer machine smoke runs** executing against local Docker containers. They are intended solely to verify endpoint latency characteristics, connection handling, and rate limiting logic under load. They are **not** production-equivalent benchmarks and must not be treated as production capacity guarantees. Production load benchmarks against staging VPS infrastructure are deferred to a final pass after Milestone M9.

| Scenario | Local Concurrency | Measured Throughput | Median Latency | p90 Latency | p95 Latency (Local) | SLA Target | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Storefront Browse** (Home, Catalog, PDP) | 8 VUs | ~23 req/s | ~160 ms | ~240 ms | **280.2 ms** | < 400 ms | Smoke Pass |
| **Search & Suggestions** (Full-text & trigram) | 8 VUs | ~21 req/s | ~136 ms | ~288 ms | **312.5 ms** | < 400 ms | Smoke Pass |
| **Cart Lifecycle** (Create, add item, get) | 8 VUs | ~32 req/s | ~83 ms | ~113 ms | **126.7 ms** | < 400 ms | Smoke Pass |
| **Checkout Flow** (Cart + reservation + COD) | 6 VUs | ~28 req/s | ~67 ms | ~128 ms | **154.1 ms** | < 450 ms | Smoke Pass |
| **Admin Reads & Health Checks** | 8 VUs | ~65 req/s | ~14 ms | ~29 ms | **33.8 ms** | < 350 ms | Smoke Pass |

> [!IMPORTANT]
> **10,000 Product Bulk Import:** The 10,000 product bulk catalog import benchmark was **not built** in this milestone. Catalog import scalability tests are deferred to the post-M9 performance review.

---

## 2. Noisy Neighbour Contention Smoke Test

The noisy neighbour test validates tenant isolation under resource contention on the local test runner:
> *"Store A floods traffic while Store B completes checkouts; Store B's p95 must stay within target."*

### Local Smoke Observations

| Metric | Store B Baseline | Store B Under Store A Flood | Local Observation | Target SLA | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Store B Browse p95** | ~160 ms | **~261 ms** | +101 ms latency increase | < 400 ms | Pass |
| **Store B Checkout p95** | ~154 ms | **~335 ms** | +181 ms latency increase | < 500 ms | Pass |
| **Store B Error Rate** | 0.00% | **0.00%** | All transactions succeeded | < 2.0% | Pass |
| **Store A Concurrency** | 0 VUs | **6 VUs continuous flood** | Simulated heavy traffic | — | Observed |

### What this smoke run does and does not show
1. All of Store B's checkout requests in this short local run succeeded (see the JSON for counts). Overselling and order-number correctness are proven by the concurrency test suite (`packages/domain/test/concurrency-scale.int.test.ts`), **not** by this k6 run.
2. The rate limiter returns `HTTP 429 Too Many Requests` once a store exceeds its per-minute quota (tested in `rate-limiting.int.test.ts`). This run did not push Store A past its quota, so it does not demonstrate load shedding.

---

## 3. Production Monitoring Signals & Saturation Thresholds (PLAN §14)

All telemetry collection, alert thresholds, and scale triggers follow PLAN §14:

| Signal | Source / Query | Warning Threshold | Scale Trigger Threshold | Operational Action |
| :--- | :--- | :--- | :--- | :--- |
| **Host CPU** | `os.loadavg() / vCPU` | **> 60% sustained** (5m) | **> 75–80% at peak** | Scale web container pool or upgrade VPS to 4 vCPU |
| **Host RAM** | `os.totalmem() - os.freemem()` | **> 70%** (2.8 GB / 4 GB) | **> 80%** (3.2 GB / 4 GB) | OOM risk for Postgres. Increase RAM budget to 8 GB |
| **DB Connections** | `pg_stat_activity` / 60 | **> 70%** (42 / 60) | **Waits / Lock contention** | Investigate connection leak; deploy PgBouncer sidecar |
| **Uncached p95** | Telemetry / k6 | **> 400 ms** | **> 500 ms** | Investigate slow queries, missing indexes, or CPU throttle |
| **Worker Job Lag** | `pgboss.job` pending time | **> 30 s** | **> 2 min** | Increase worker concurrency (up from 4) or spin up 2nd worker |
| **Store Load Share** | Origin RPS per tenant | **> 20%** of total | **> 25–30% repeatedly** | Throttle noisy store, upgrade size tier, or migrate to dedicated VPS |

---

## 4. Tenant Size Tiers & Quota Definitions (Actual Platform Values)

Quota configuration in the platform schema (`quota_definitions`, `tenant_size_tiers`, `tenant_quota_overrides`) uses generous starting defaults to prevent false-positive 429 errors during new store launches:

| Tier | Uncached Storefront Req / Min (`uncached_storefront_rpm`) | Admin & API Req / Min (`admin_api_rpm`) | Job Concurrency (`job_concurrency`) |
| :--- | :--- | :--- | :--- |
| **XS (Default)** | 3,000 req/min (50 req/s) | 600 req/min (10 req/s) | 4 concurrent jobs |
| **S** | 4,500 req/min (75 req/s) | 1,200 req/min (20 req/s) | 6 concurrent jobs |
| **M** | 9,000 req/min (150 req/s) | 2,400 req/min (40 req/s) | 8 concurrent jobs |
| **L** | 18,000 req/min (300 req/s) | 4,800 req/min (80 req/s) | 16 concurrent jobs |

### Enforcement Mechanics
- **Storefront & Admin Traffic:** Enforced via atomic fixed-window counters in `rate_limit_counters`. Violations return `HTTP 429 Too Many Requests` with `Retry-After`. Storefront read errors fail open with a warning log to preserve store availability.
- **Webhooks:** Default 300 req/min per provider and IP. Webhooks bearing valid cryptographic signatures bypass failure rate-limiting to guarantee payment captures are never lost.
- **Background Jobs:** Enforced via `acquireTenantJobSlot` in `packages/domain/src/system/rate-limit.ts` against `tenant_active_jobs`. Slots that a crashed worker never released are freed by `reapStaleTenantJobSlots` (30-minute threshold, run every 15 minutes) and on every worker start.
