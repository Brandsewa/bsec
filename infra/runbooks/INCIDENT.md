# Production Incident Response Runbook

**Environment:** Production on `server.brandsewa.com` (host IP `88.222.241.159`).  
**Coolify Project:** Bs Commerce Platform -> Environment `production`.  
**Architecture:** Shared single-server PostgreSQL 18 + Dockerized web, platform, worker, admin.  
**Plan Reference:** PLAN §14 (Capacity, Monitoring, Upgrade Stages).

---

## 1. Severity Classifications & Escalation SLAs

| Severity | Definition | Examples | SLA (Ack / Resolve) |
|---|---|---|---|
| **SEV-1 (Critical)** | Core transactional revenue path down; data loss/corruption; security compromise. | Storefront 500s across all routes; checkout fails; Postgres unreachable; customer data leak. | 5 min / 1 hour |
| **SEV-2 (Major)** | Core revenue path degraded; single provider down; severe latency; background job backlog. | Razorpay webhooks failing; Shiprocket tracking lagging > 1h; uncached p95 > 500ms; single store throttled. | 15 min / 4 hours |
| **SEV-3 (Minor)** | Non-revenue impacting issue; admin portal defect; single tenant styling/asset issue. | Admin export CSV formatting bug; theme preview glitch; batch report slow. | 1 hour / 24 hours |

---

## 2. The First 5 Minutes: Rapid Diagnostic Protocol

When an alert fires or an incident is reported, run through this sequence before changing any state:

### Step 1: External Blackbox Verification
Verify whether the services are responding to external HTTP probes:
```bash
# Storefront and Store API
curl -sS -I https://gobs.cloud/api/health
curl -sS https://gobs.cloud/api/health | jq .

# Platform API (Cloudflare Access protected in prod)
curl -sS -I https://platform.gobs.cloud/health

# Admin Dashboard
curl -sS -I https://admin.gobs.cloud/
```
**Expected response:** HTTP 200 with JSON payload containing `status: "ok"`, `version`, `db: { ok: true, role: "app_rw" }`.

### Step 2: VPS Host Status (SSH to `server.brandsewa.com`)
```bash
ssh root@server.brandsewa.com

# 1. Check system load, CPU saturation, and memory
uptime
free -h
vmstat 1 5

# 2. Check for kernel Out-Of-Memory (OOM) kills
dmesg -T | grep -i -E "oom|killed process" | tail -n 20

# 3. Check disk space on root volume
df -h /
```
- **If CPU load > 60% sustained (PLAN §14 warning):** Identify culprit container with `docker stats --no-stream`.
- **If RAM available < 500 MB (PLAN §14 scale trigger):** Risk of Postgres crash. Check memory hogging containers.
- **If disk is full:** Docker overlay2 logs may need truncation: `truncate -s 0 /var/lib/docker/containers/*/*-json.log`.

### Step 3: Container Liveness & Docker Status
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```
All six containers must report `Up`:
- `bsec-postgres` (or `postgres` in staging/local compose)
- `bsec-web` (or `web` in staging/local compose)
- `bsec-platform` (or `platform` in staging/local compose)
- `bsec-worker` (or `worker` in staging/local compose)
- `bsec-admin` (or `admin` in staging/local compose)
- `bsec-migrate` (or `migrate` in staging/local compose; should be `Exited (0)` - normal for one-shot migrate)

If a container is continually restarting (`Restarting (1)`):
```bash
docker logs --tail 200 bsec-web
docker logs --tail 200 bsec-worker
```

---

## 3. Subsystem Incident Triage

### Scenario A: PostgreSQL Saturation or Deadlocks (DB Connections > 70%)
**Signal:** Alerts `DBConnectionPoolWarning` or `DBConnectionPoolSaturation`.
1. Inspect active Postgres connections:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
SELECT pid, usename, client_addr, state, wait_event_type, wait_event, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC
LIMIT 10;
"
```
2. If queries are stuck on locks:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
SELECT blocked_locks.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocking_locks.pid AS blocking_pid,
       blocking_activity.usename AS blocking_user,
       blocked_activity.query AS blocked_statement,
       blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
     AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
     AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
     AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
     AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
     AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
     AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
     AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
     AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
     AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
     AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
"
```
3. Terminate a pathological rogue query blocking transactions:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "SELECT pg_cancel_backend(<pid>);"
# If cancel does not release after 10s:
docker exec -i bsec-postgres psql -U postgres -d bsec -c "SELECT pg_terminate_backend(<pid>);"
```

### Scenario B: Noisy Neighbour Monopolizing Capacity (> 25% Load Share)
**Signal:** Alert `SingleStoreLoadShareScaleTrigger`.
1. Identify the offending tenant ID:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
SELECT split_part(key, ':', 4) as tenant_id, sum(count) as total_requests
FROM rate_limit_counters
WHERE key LIKE 'rate:storefront:tenant:%' OR key LIKE 'rate:admin:tenant:%'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 5;
"
```
2. Verify tenant details:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
SELECT id, slug, name FROM tenants WHERE id = '<tenant_id>';
"
```
3. Apply temporary protective override on the tenant's quota (PLAN §14 / §15):
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value, reason, expires_at)
VALUES ('<tenant_id>', 'uncached_storefront_rpm', 60, 'Throttling noisy neighbour under incident response', now() + interval '2 hours')
ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 60, expires_at = now() + interval '2 hours';
"
```

### Scenario C: Background Worker Job Backlog (Job Lag > 2 min)
**Signal:** Alert `BackgroundJobLagScaleTrigger`.
1. Check queue size and oldest pending job:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
SELECT name, count(*) as pending_count,
       coalesce(max(extract(epoch from (now() - created_on))), 0)::int as oldest_age_seconds
FROM pgboss.job
WHERE state = 'created'
GROUP BY name;
"
```
2. Restart `bsec-worker` container via Coolify or Docker if stuck on dead connection:
```bash
docker restart bsec-worker
docker logs -f --tail 100 bsec-worker
```

---

## 4. Communication & Incident Resolution Protocol

1. **Merchant Communication (Store #1):**
   - If storefront is degraded > 5 minutes, post status update: *"We are investigating elevated checkout response times on server.brandsewa.com. Orders are queued safely."*
2. **Post-Incident Review:**
   - Record incident timeline, root cause, RTO, RPO, and action items in `docs/postmortems/YYYY-MM-DD-<incident-name>.md`.
   - Never close an incident without a regression test or threshold tuning.
