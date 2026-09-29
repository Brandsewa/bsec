# Production Uptime Monitoring Spec

Status: **Draft, not provisioned: no Better Stack account yet**

Per **PLAN §13, §14, §15**, continuous external synthetic uptime monitoring will verify availability, HTTP response status, SSL certificate validity, and internal database health across all production endpoints.

## Monitor Specifications

The file `betterstack.json` provides the target configuration to translate into Better Stack (or another synthetic monitoring provider) once an account and API token are provisioned.

| Service | Target URL | Expected Status | Payload Assertion | Cadence |
|---|---|---|---|---|
| **Web Storefront & Store API** | `https://gobs.cloud/api/health` | 200 OK | `{"status":"ok","service":"web","db":{"ok":true,"role":"app_rw"}}` | 60 seconds |
| **Merchant Admin SPA** | `https://admin.gobs.cloud/health` | 200 OK | `{"status":"ok"}` | 60 seconds |
| **Platform API** | `https://platform.gobs.cloud/health` | 200 OK | `{"status":"ok","service":"platform","db":{"ok":true,"role":"app_platform"}}` | 60 seconds |

## Health Checks & SSL Alerting Requirements

1. **Database Role Verification**:
   - `bsec-web` and `bsec-platform` execute a live `SELECT 1` and verify the connecting PostgreSQL role (`app_rw` vs `app_platform`).
   - If Postgres is unreachable or role configuration is corrupted, `/health` returns HTTP 503, which will trigger the uptime monitor alert.

2. **SSL Expiration Alerting**:
   - Alert when the TLS certificate has $\le 14$ days remaining.
