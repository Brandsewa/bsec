# Failover and resilience plan (standby server behind Cloudflare)

- **Status:** parked by the owner on 2026-11-01. Build when real order volume justifies a second server. Nothing here is implemented yet.
- **Owner decisions needed before starting:** provider for the standby, monthly budget (section 9), accepted RPO/RTO (section 2).
- **Affects:** `infra/`, `DEPLOYMENT.md`, `infra/coolify/RUNBOOK.md`, Cloudflare dashboard. Application code only for Phase A and the optional `placement` field.
- **Rules that apply:** `AGENTS.md` section 2 rule 9 (DB roles), section 5 (infra changes need the owner's yes in session), `docs/migrations.md`.

## 1. Where we are today (audited 2026-11-01)

One Hostinger VPS runs everything through Coolify and Traefik: `bsec-postgres`, `bsec-web`, `bsec-platform`, `bsec-worker`, `bsec-admin`, `bsec-migrate` (`infra/coolify/RUNBOOK.md`). Cloudflare sits in front for DNS, CDN, SSL and Cloudflare for SaaS custom hostnames (fallback origin `stores.bcom.si`, `DEPLOYMENT.md` "Custom domains"). Images come from GHCR; CI promotes `:main` only after all gates pass.

| Area | State | Source |
|---|---|---|
| Postgres backups | Daily Coolify `pg_dump` at 02:30 UTC, local (14 days / 5 GB) plus R2 bucket `bsec-backups`. **RPO up to 24 h.** | RUNBOOK section 8 |
| Point-in-time recovery | pgBackRest design written, **not active** (`infra/backups/`) | `infra/backups/README.md` |
| Restore drill | **Never done** (RUNBOOK says "not yet done"; drill docs are drafts) | RUNBOOK section 8 |
| R2 retention | No lifecycle rule on `bsec-backups`, grows unbounded. Media bucket versioning is stated as the plan, not confirmed | RUNBOOK section 8, backups README |
| Standby server | None | n/a |
| Per-tenant rate limits | **Done.** Postgres fixed-window counters, tier quotas (XS to L), 429 with `Retry-After`; job slots per tenant with stale-slot reaper | `packages/domain/src/system/rate-limit.ts`, `infra/loadtest/CAPACITY-POLICY.md` |
| Noisy-neighbour test | Local smoke only, no production-size benchmark | CAPACITY-POLICY section 2 |
| DB statement timeouts | **Missing.** Only the segment preview sets `SET LOCAL statement_timeout`. No role-level `statement_timeout`, `idle_in_transaction_session_timeout` or `lock_timeout` | grep, 2026-11-01 |
| Uptime monitoring | Live, Better Stack, 3-minute checks, public status page | `infra/uptime/README.md` |
| Incident runbook | Exists, single-server only | `infra/runbooks/INCIDENT.md` |
| Platform API access | Public HTTPS with app-layer auth; RUNBOOK says to consider Cloudflare Access. INCIDENT.md says "Cloudflare Access protected in prod": **the two docs disagree, confirm which is true** | RUNBOOK section 5 vs INCIDENT section 2 |
| Super Admin access | Public SPA at `superadmin.bcom.si`; not confirmed behind Cloudflare Access | uptime README |
| Origin firewall | Only 22, 80, 443 open. Cloudflare-only allowlist for 80/443 and SSH hardening **still open** | RUNBOOK section 9 |
| Sentry, log drain | Not configured | RUNBOOK section 9 |
| Resource limits per container | Not set | RUNBOOK section 5 |

Conclusion: single-tenant noisy-neighbour protection is good. The real gaps are backup freshness, an unproven restore, no timeouts at the database, and no second place to run.

## 2. Targets

| | Today | Phase A | Phase B (standby) |
|---|---|---|---|
| RPO (data you can lose) | up to 24 h | up to 24 h, but restore proven | seconds to ~1 min (WAL) |
| RTO (time to recover) | unknown (never tested) | measured, aim under 2 h | 5 to 15 min app, scripted DB promote |

Owner to confirm. `infra/backups/README.md` already states PLAN section 14 targets of RPO 15 min / RTO 2 h; Phase B meets them.

## 3. Phase A: do now, no new server (small, high value)

These need no second VPS and make the later work safer. Each is one branch and one change record.

**A1. Database timeouts (code, small).**
- In the role bootstrap (`packages/db/src/sql/roles.ts`), set per-role defaults, for example `ALTER ROLE app_rw SET statement_timeout = '15s'`, `idle_in_transaction_session_timeout = '30s'`, `lock_timeout = '5s'`. Use a longer value for `app_platform` (reports) and none for `app_owner` (migrations).
- Exempt long jobs explicitly with `SET LOCAL statement_timeout` (bulk import, exports, worker sweeps) so they do not break. Find them first by running the heavy suite and the loadtests.
- Test: a real-DB test that a pg_sleep over the limit is cancelled for `app_rw` and not for `app_owner`.
- Risk: a too-low limit breaks imports. Start permissive (30 s), tighten from logs.

**A2. Run one real restore drill and log it.**
- Follow `infra/backups/RESTORE-DRILL.md`: download the latest R2 dump, restore into a scratch Postgres 18, run `pnpm --filter @bs/db migrate` (must be a no-op), compare row counts, record start/end time (RTO) and newest row (RPO) in `progress.md`.
- Also rehearse `infra/runbooks/TENANT-RESTORE.md` for one tenant.
- Never against production. Local or ephemeral only.

**A3. R2 hygiene.**
- Add a lifecycle rule on `bsec-backups` (for example expire dumps after 30 to 60 days) and confirm object versioning on the media bucket. Cloudflare dashboard changes: owner approves.
- Consider a second R2 bucket or a second account for an offsite copy of the dumps, so one compromised token cannot delete every backup. Use a token scoped to write-only for the backup job if Coolify allows.

**A4. Lock down the origin and admin surfaces (owner, Cloudflare/Hostinger dashboards).**
- Cloudflare-IP-only allowlist for 80/443 in the Hostinger firewall (RUNBOOK section 9 item 3). Important before adding a standby: both servers should accept only Cloudflare.
- Put `platform.bcom.si` and `superadmin.bcom.si` behind Cloudflare Access (free for up to 50 users). Resolve the doc conflict in section 1 at the same time.
- SSH key-only and fail2ban.

**A5. Observability.** Set Sentry DSNs and a Better Stack log drain (RUNBOOK section 9). Failover decisions need logs that outlive a dead server.

**A6. Rehearse capacity at production size** (CAPACITY-POLICY says deferred to after M9): run the noisy-neighbour k6 script against the real VPS size once, off-hours, with the owner's yes. Do not run loadtests against the live store without that yes.

## 4. Phase B: standby server (build when ready)

### 4.1 Architecture

```
Visitors -> Cloudflare (CDN, SSL, DDoS, Cloudflare for SaaS)
         -> Cloudflare Load Balancer (health checks)
              |-> Pool 1: primary VPS (Hostinger)   [normal traffic]
              |-> Pool 2: standby VPS (other provider) [only if pool 1 is unhealthy]
Primary Postgres --WAL archive / replica--> Standby Postgres
Both servers: R2 for media and backups
```

The router role Shopify gives its NGINX/Lua layer is played by Cloudflare plus the load balancer here. A map of this was shared in chat on 2026-11-01.

### 4.2 Standby server

1. Different provider and region from Hostinger (example: Hetzner, DigitalOcean, Vultr). Same CPU/RAM class as the primary or one step smaller.
2. Install Coolify (same version), Traefik routing identical to the primary including the custom-hostname catch-all (`DEPLOYMENT.md`, "Traefik must also route custom hostnames").
3. Deploy the same six resources from GHCR. Keep CI deploying to **both** (add a second Coolify target to `deploy-production`; `promote-images` already gates the tag). Never let the standby lag a release behind: schema must match.
4. Secrets: copy `TENANT_SECRETS_KEY`, all `DATABASE_URL_*`, `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`, `SENTRY_DSN` and R2 credentials. Without the same `TENANT_SECRETS_KEY` the standby cannot decrypt tenant credentials. Store them in a password manager, never in the repo or chat. Standby gets its **own** R2 token and Coolify API token so one leak does not expose both.
5. Same firewall: only 22 (your IP), 80, 443, and Cloudflare-only for 80/443. Postgres replication port reachable only over a private tunnel (WireGuard or Tailscale), never public.
6. Keep the `bsec-worker` **stopped** on the standby until promotion, so two workers never run against different databases. pg-boss lives in the same database; a worker pointed at the replica would fail anyway, but stop it explicitly.

### 4.3 Database replication (pick one; recommendation first)

**Option 1 (recommended): pgBackRest continuous WAL to R2, standby restores continuously.**
- Activate the existing design in `infra/backups/`: sidecar with `archive_mode=on`, `archive_command=pgbackrest ... archive-push`, `archive_timeout=60`.
- Standby runs as a hot standby fed by `restore_command` from R2. RPO about 1 minute, no inbound DB port needed, R2 already trusted.
- Also gives point-in-time recovery for operator mistakes, which a pure replica cannot (a replica copies a bad delete instantly).
- Note the Coolify image of Postgres may need a custom image or sidecar to run pgBackRest; confirm before committing (spike first).

**Option 2: streaming replica over WireGuard.** Lower RPO (near zero), more moving parts, still needs PITR backups on top.

**Option 3: managed HA Postgres** (Neon, DigitalOcean Managed, Supabase). Simplest operations, but must support the four roles including `app_platform` with BYPASSRLS and `FORCE RLS`; verify this first, and pg-boss compatibility with the pooler. Moves the database off the VPS, which changes ADR-002's deployment assumptions: write an ADR.

### 4.4 Cloudflare setup (owner, dashboard)

Costs are in section 9. Order matters: build the health endpoint check first.

1. Enable Load Balancing add-on (about USD 5/month for 2 origins; confirm current price in the dashboard).
2. Create two origin pools: primary (Hostinger) and standby. Monitor: HTTPS GET `/api/health`, expect 200 and body `"status":"ok"`, interval 60 s, 2 to 3 consecutive failures to mark unhealthy.
3. Create a load balancer on a hostname, with the primary pool first and standby as fallback pool (failover steering, not geo-steering).
4. **Cloudflare for SaaS integration (verify in a test first).** The Cloudflare reference architecture describes attaching a load balancer as the *custom origin* of a custom hostname. We currently use a single *fallback origin* (`stores.bcom.si`). Unconfirmed: whether the fallback origin itself can be the load balancer hostname. Test with one throwaway custom hostname:
   - Point the fallback origin `stores.bcom.si` at the load balancer hostname. If Cloudflare refuses, set `custom_origin_server` per custom hostname through the API in `domains.sweep`/the Domains service instead (a code change in the domains area).
   - Shut down the primary and confirm requests reach the standby, the `/.well-known/bsec-domain` check still passes, and SSL stays "Full".
5. Wildcard `*.bcom.si`, `bcom.si`, `admin`, `platform`, `superadmin` hostnames: point them at the load balancer too (or the same pools), keeping platform and superadmin behind Access.
6. Optional later: Tunnel (`cloudflared`) on both servers instead of public origins. Replicas do not support traffic steering, so with a load balancer use one tunnel per server. Not required.

### 4.5 Failover procedure (scripted, written before first use)

Automatic: Cloudflare stops sending traffic to an unhealthy primary and uses the standby. Until the database is promoted the standby apps run against a **read-only** replica, so storefront reads work and checkout writes fail.

Manual, scripted (`infra/runbooks/FAILOVER.md`, to be written, with the exact commands):
1. Confirm the primary is really down (not a network blip). Check Better Stack and the Cloudflare pool status.
2. Make sure the primary cannot come back as a writer (stop Postgres or fence it at the firewall). This prevents split-brain.
3. On the standby: stop WAL replay, promote Postgres (`pg_ctl promote` or pgBackRest promote), run `pnpm --filter @bs/db migrate` as `app_owner` (expected no-op), start `bsec-worker`.
4. Verify `/api/health` shows `db.ok` and the right roles; place a test COD order on a throwaway tenant; check pg-boss is draining.
5. Announce on the status page; record the incident per `INCIDENT.md` section 4.
6. Failback is a separate planned operation: rebuild the old primary as a new standby from a base backup. Never just switch it back on.

Do not automate step 3 at first. A false-positive health alarm that auto-promotes can create two writable databases, which is worse than a short outage.

### 4.6 Switchover hold (nice to have)

Shopify queues requests for a few seconds during a pod failover. Equivalent: during the promote window, the web app returns a friendly "back in a minute" response for checkout writes (HTTP 503 with `Retry-After`) rather than failing mid-order. Totals are already recomputed server-side (rule 12), and side effects go through pg-boss after commit (rule 13), so no half-order should be created. A feature flag read from env is enough; no schema change.

### 4.7 Optional: `placement` field per store

A nullable `placement` (a "cell" or server name) on `tenants`, read in one place, so tenants can later be moved between servers like Shopify's pod routing table. Not needed for a single active/standby pair. Do it only if a second *active* server is ever planned. Needs an ADR and a migration (expand/migrate/contract).

## 5. Drills and acceptance criteria

Phase A done when:
- [ ] `app_rw` queries over the configured limit are cancelled; imports and exports still pass; heavy suite green.
- [ ] One restore drill logged in `progress.md` with measured RTO and RPO; tenant restore rehearsed.
- [ ] R2 lifecycle rule present; second-copy decision recorded.
- [ ] Origin accepts only Cloudflare on 80/443 (verified by an outside probe); platform and Super Admin behind Access; the INCIDENT/RUNBOOK conflict resolved.
- [ ] Sentry and log drain live.

Phase B done when:
- [ ] Standby runs the same image SHA as the primary after every deploy.
- [ ] Standby Postgres is within 2 minutes of the primary (measured), and a PITR restore to a chosen time works.
- [ ] Test hostname fails over to standby within the health-check window; custom-hostname verification still passes there.
- [ ] A full promotion drill is run on a **staging copy** (not production) from `FAILOVER.md`, with timings recorded: step 3 to 4 under 15 minutes.
- [ ] Failback procedure rehearsed.
- [ ] Monthly drill scheduled; `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `infra/coolify/RUNBOOK.md`, ADR and change record updated.

## 6. Security checklist for the standby

- Same hardening as the primary (section A4) before it ever receives traffic.
- Separate credentials per server where the platform allows it; rotate `COOLIFY_TOKEN` and R2 keys on a schedule.
- Replication traffic only over WireGuard/Tailscale or R2; no public 5432.
- Dumps and WAL encrypted at rest (pgBackRest `aes-256-cbc` is already in the draft config; keep the passphrase offline).
- Do not commit server IPs, hostnames you were not told to publish, or the R2 account endpoint beyond what is already public. The sample endpoint in `infra/backups/pgbackrest.conf` is already in the public repo; treat it as known.
- `app_platform` (BYPASSRLS) password handled like a superuser's on both servers.

## 7. Risks and unknowns

| Risk / unknown | Mitigation |
|---|---|
| Load balancer as fallback origin for Cloudflare for SaaS unverified | Test with one hostname before building around it (4.4 step 4) |
| Split-brain after a false failover | Manual promotion, fence the old primary first (4.5) |
| Standby schema or image lags the primary | Deploy to both in CI; check SHA in the drill |
| Running Postgres under Coolify with pgBackRest | Spike on a throwaway server first |
| Hostinger-wide outage vs single VPS failure | Different provider for the standby |
| Cost surprises (extra hostnames, DNS queries) | Section 9; review the first two invoices |
| Replica copies a destructive mistake | PITR from WAL archive, not just a replica |

## 8. Out of scope

Sharding or multiple active pods, active-active across regions, moving to Kubernetes, anything touching Shiprocket or other shipping integrations (`AGENTS.md` rule 14), live payment credentials.

## 9. Rough monthly cost (verify before approving)

| Item | Estimate |
|---|---|
| Standby VPS, same class as primary | similar to the current VPS bill |
| Cloudflare Load Balancing, 2 origins | about USD 5 (not confirmed on the official docs; check dashboard) |
| DNS queries beyond the free 500k | about USD 0.50 per extra 500k |
| Cloudflare for SaaS hostnames | first 100 free, then USD 0.10 each (already in `DEPLOYMENT.md`) |
| R2 storage for WAL and dumps | small; set lifecycle rules |
| Private tunnel (Tailscale free tier or WireGuard) | free |

## 10. Suggested order and effort

1. A1 timeouts, A2 restore drill, A5 observability (a few days, no cost).
2. A3 R2 retention, A4 lockdown and Access (an hour or two of owner dashboard work each).
3. Decide Option 1/2/3 in 4.3; write the ADR.
4. Phase B: spike pgBackRest under Coolify, build standby, CI dual deploy, load balancer test hostname, write `FAILOVER.md`, run the staging drill, then cut over real hostnames.
5. Schedule monthly drills.

## 11. Sources used for the Cloudflare and Shopify claims (2026-11-01)

- Cloudflare Load Balancing is an add-on: https://developers.cloudflare.com/load-balancing/
- Tunnel replicas and no traffic steering: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/tunnel-availability/
- Cloudflare for SaaS plans and 100 free hostnames: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- Custom origin per hostname: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/custom-origin/
- Load balancer as custom origin (reference architecture): https://developers.cloudflare.com/reference-architecture/design-guides/extending-cloudflares-benefits-to-saas-providers-end-customers
- Load Balancing price figures are from third-party aggregators, not confirmed on Cloudflare's own docs.
- Shopify pods and failover: https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale and https://shopify.engineering/mysql-database-shard-balancing-terabyte-scale
