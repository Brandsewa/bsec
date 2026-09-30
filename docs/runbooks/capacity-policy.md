# Capacity & Resource Management Policy

> **Platform Operations & SRE Standards**  
> System: Brand Sewa E-Commerce Platform (`bsec`)  
> Target Infrastructure: Single Host (Hetzner Dedicated / Coolify) → Multi-Service Docker Stack  
> Date: September 2026

---

## 1. Container Memory & CPU Budgets (PLAN §14)

The platform is designed to operate stably within a 16 GB - 32 GB RAM hardware profile during initial launch, with strict per-container memory ceilings enforced via Docker resource constraints:

| Container | Image | RAM Budget (Soft / Hard) | CPU Quota | Connection Limit (Postgres) | Notes |
|---|---|---|---|---|---|
| `postgres` | `postgres:18` | 4 GB / 6 GB | 4.0 cores | `max_connections = 100` | Shared buffers 2GB, work_mem 16MB |
| `bsec-web` | Next.js / Storefront + Admin API | 1.5 GB / 2.5 GB | 2.0 cores | 25 (`app_rw`) | Node.js SSR, ISR cache, image optimization |
| `bsec-platform` | Hono / Platform Super Admin API | 512 MB / 1 GB | 1.0 core | 10 (`app_platform` BYPASSRLS) | Low concurrency, privileged ops only |
| `bsec-worker` | pg-boss queue consumers | 1 GB / 2 GB | 2.0 cores | 20 (`app_rw`) | Email dispatch, webhooks, export jobs |
| `bsec-admin` | Nginx SPA (Store Admin) | 128 MB / 256 MB | 0.5 cores | 0 | Static assets + SPA routing |
| `bsec-superadmin` | Nginx SPA (Super Admin) | 128 MB / 256 MB | 0.5 cores | 0 | Static assets + SPA routing |
| **Total Headroom** | — | **~8 GB / 12.5 GB** | **10.0 cores max** | **55 active connections** | Remaining ~4-19 GB for OS page cache |

---

## 2. PostgreSQL Connection Pooling Strategy

- `max_connections = 100` configured in `postgresql.conf`.
- Pool allocation:
  - `web` service: Pool Max 25 (connects as `app_rw`).
  - `worker` service: Pool Max 20 (connects as `app_rw`).
  - `platform` service: Pool Max 10 (connects as `app_platform` with BYPASSRLS).
  - Superuser / Migration Reserve: 5 connections.
- Connection leak prevention: all transactions use `withTenant` or `db.transaction()` with scoped lifetimes and 10s query statement timeouts.

---

## 3. Storage & Disk Growth Policy

1. **Database Footprint (`pgdata`):**
   - Alert threshold: 75% disk utilization.
   - Critical action threshold: 85% disk utilization.
   - Automatic cleanup:
     - `rate_limit_counters` pruned every hour (`cleanExpiredRateLimits`).
     - `pgboss.job` completed rows retained for 7 days, failed rows for 30 days.
     - `tenant_deletions` purges rows while retaining `platform_invoices` for 8 years (statutory requirement).
2. **Object Storage (Cloudflare R2 / S3):**
   - Media stored per tenant under `media/{tenantId}/{mediaId}`.
   - Quota enforcement: tenant size tiers limit media upload ceilings.

---

## 4. Tenant Size Tiers & Quota Ceilings (PLAN §6.1 / §14)

| Metric | XS (Starter) | S (Growth) | M (Scale) | L (Enterprise) |
|---|---|---|---|---|
| Active Products | 50 | 500 | 5,000 | 25,000 |
| Staff Seats | 2 | 5 | 15 | 50 |
| Storefront RPM | 3,000 req/min | 4,500 req/min | 9,000 req/min | 18,000 req/min |
| Admin API RPM | 600 req/min | 1,200 req/min | 2,400 req/min | 4,800 req/min |
| Background Job Concurrency | 4 parallel jobs | 6 parallel jobs | 8 parallel jobs | 16 parallel jobs |

---

## 5. Horizontal Scale-Up Triggers

When metrics breach the following thresholds consistently over a 7-day trailing window:
1. **PostgreSQL CPU > 60% sustained:** Separate PostgreSQL 18 instance to dedicated database server. *(Marked: UNTESTED in live environment)*.
2. **Web RAM > 80% sustained:** Spin up second `bsec-web` instance behind Caddy load balancer. *(Marked: UNTESTED in live environment)*.
3. **Queue depth > 5,000 persistent:** Add dedicated worker nodes.
