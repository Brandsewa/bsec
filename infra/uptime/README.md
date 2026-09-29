# Production Uptime Monitoring (Better Stack / Pingdom)

Status: **Configured** (Monitor specifications in `betterstack.json`).

Per **PLAN §13, §14, §15**, continuous external synthetic uptime monitoring verifies availability, HTTP response status, SSL certificate validity, and internal database health across all production endpoints.

## Configured Endpoints

| Service | Target URL | Expected Status | Payload Assertion | Cadence |
|---|---|---|---|---|
| **Web Storefront & Store API** | `https://gobs.cloud/api/health` | 200 OK | `{"status":"ok","db":{"ok":true,"role":"app_rw"}}` | 60 seconds |
| **Merchant Admin SPA** | `https://admin.gobs.cloud/health` | 200 OK | `{"status":"ok"}` | 60 seconds |
| **Platform API** | `https://platform.gobs.cloud/health` | 200 OK | `{"status":"ok","db":{"ok":true,"role":"app_platform"}}` | 60 seconds |

## Features & Alerting Rules

1. **Health Verification**:
   - `bsec-web` and `bsec-platform` perform a live `SELECT 1` and verify the connecting PostgreSQL role (`app_rw` vs `app_platform`).
   - If Postgres is unreachable or role configuration is corrupted, `/health` returns HTTP 503, immediately triggering the alert.

2. **SSL Expiration Alerting**:
   - Monitors alert if Let's Encrypt / Cloudflare SSL certificate has $\le 14$ days remaining.

3. **Escalation**:
   - First failure: Retry after 15 seconds from alternate geographic location.
   - Confirmed failure (2 consecutive checks): PagerDuty / On-call Slack notification within 2 minutes.

## Provisioning via API or Terraform

To sync monitor configuration with Better Stack API:
```bash
curl -X POST https://uptime.betterstack.com/api/v2/monitors \
  -H "Authorization: Bearer $BETTERSTACK_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @infra/uptime/betterstack.json
```
