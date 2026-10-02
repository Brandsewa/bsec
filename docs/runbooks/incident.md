# Incident Management Runbook

> **Platform Operations & SRE Standards**  
> System: Brand Sewa E-Commerce Platform (`bsec`)  
> Target Topology: PostgreSQL 18, Docker/Coolify, Hono/oRPC, Better Auth, pg-boss  
> Date: September 2026

---

## 1. Incident Severity Matrix

| Severity | Definition | Examples | Response Target | Comms Frequency |
|---|---|---|---|---|
| **SEV-1 (Critical)** | Core platform down, widespread storefront checkout failure, active security breach, or data corruption across tenants. | PostgreSQL down; payment webhooks dropping orders platform-wide; BYPASSRLS leakage. | Immediate (< 15 min) | Every 30 minutes |
| **SEV-2 (Major)** | Degradation of critical features for multiple stores; background queues completely stalled; admin inaccessible. | pg-boss queue backlog > 10,000; transactional emails failing; Razorpay webhook delivery failing. | < 45 minutes | Every 1 hour |
| **SEV-3 (Minor)** | Single tenant issue or non-critical feature impaired (e.g. export queue delayed, single template preview error). | Single store quota exhausted; theme preview slow; one custom domain SSL verification delayed. | < 4 hours | Once daily or on resolution |
| **SEV-4 (Low)** | Cosmetic bugs, minor discrepancies in analytics, non-impacting operator log warnings. | Non-blocking dashboard UI alignment; non-critical rate-limit warning. | Next business day | On release notes |

---

## 2. Emergency Incident Response Procedure

### Step 1: Triage & Identification
1. Check overall platform health:
   ```bash
   curl -fsS http://127.0.0.1:4000/health
   curl -fsS http://127.0.0.1:3000/api/health
   curl -fsS http://127.0.0.1:4100/health
   ```
2. Inspect Super Admin system health dashboard: `https://platform.bcom.si/system`.
3. Check Sentry alerts for uncaught exceptions or spikes in 500 errors.

### Step 2: Immediate Containment

#### Scenario A: Database Connection Pool Exhaustion
- **Symptom:** `503 Service Unavailable`, logs report `timeout exceeded when connecting to database`.
- **Diagnosis:**
  ```sql
  -- Run inside PostgreSQL via Coolify terminal
  SELECT count(*), state, usename FROM pg_stat_activity GROUP BY state, usename;
  ```
- **Remediation:**
  1. Identify runaway queries:
     ```sql
     SELECT pid, query_start, now() - query_start AS duration, query 
     FROM pg_stat_activity 
     WHERE state != 'idle' ORDER BY duration DESC LIMIT 5;
     ```
  2. Terminate rogue query:
     ```sql
     SELECT pg_terminate_backend(<pid>);
     ```
  3. *(Status: TESTED in integration concurrency suite)*.

#### Scenario B: pg-boss Queue Failure Spike or Worker Stall
- **Symptom:** Orders not sending customer confirmation emails; exports stuck in `requested` state.
- **Diagnosis:**
  Inspect failed jobs count in PostgreSQL:
  ```sql
  SELECT name, count(*), state FROM pgboss.job WHERE state IN ('failed', 'retry') GROUP BY name, state;
  ```
- **Remediation:**
  1. Inspect error diagnostics in Super Admin (`/system` screen) or query:
     ```sql
     SELECT id, name, output FROM pgboss.job WHERE state = 'failed' ORDER BY createdon DESC LIMIT 5;
     ```
  2. If caused by external provider downtime (e.g. Resend or Shiprocket API rate limit), wait for provider recovery.
  3. Use Super Admin System screen to click **Retry Job**, or trigger via platform API:
     ```bash
     curl -X POST https://platform.bcom.si/rpc/platform/system/jobs/<jobId>/retry
     ```
  4. *(Status: TESTED in domain queue suite)*.

#### Scenario C: Suspected Cross-Tenant Data Leak or Compromised Token
- **Symptom:** Tenant reports seeing another merchant's orders, or an unauthorized support session is detected.
- **Remediation:**
  1. Immediately terminate all active support sessions:
     ```sql
     UPDATE support_sessions SET ended_at = now(), ended_by = 'incident-response' WHERE ended_at IS NULL;
     ```
  2. Suspend suspected compromised tenant from Super Admin or run:
     ```sql
     UPDATE tenants SET status = 'suspended', suspended_reason = 'Security hold - SEV-1 incident investigation' WHERE id = '<tenant_id>';
     ```
  3. Rotate `TENANT_SECRETS_KEY` and Better Auth session secret if credential theft is suspected. *(Marked: UNTESTED in live production drill - see rollback runbook)*.

---

## 3. Post-Incident Review (PIR)
Within 48 hours of resolving any SEV-1 or SEV-2:
1. Conduct blame-free Post-Mortem.
2. Document timeline (detection, response, mitigation, resolution).
3. Identify Root Cause (5 Whys).
4. Create Jira/GitHub remediation tickets before closing incident.
