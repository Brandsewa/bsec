# Production Uptime Monitoring Spec

Status: **Live (Better Stack, provisioned 2026-10-02).** Public status page: https://bcom.betteruptime.com/ (web, admin and platform monitors; Super Admin is deliberately not on it).

Per **PLAN §13, §14, §15**, continuous external synthetic uptime monitoring will verify availability, HTTP response status, SSL certificate validity, and internal database health across all production endpoints.

## Monitor Specifications

The file `betterstack.json` is the target configuration; the monitors below were created by hand in Better Stack to match it. Status code is the check (the health endpoints return 503 when the database is down); the body column documents what a healthy response looks like.

| Service | Target URL | Expected Status | Payload Assertion | Cadence |
|---|---|---|---|---|
| **Web Storefront & Store API** | `https://bcom.si/api/health` | 200 OK | `{"status":"ok","service":"web","db":{"ok":true,"role":"app_rw"}}` | 3 minutes |
| **Merchant Admin SPA** | `https://admin.bcom.si/health` | 200 OK | `{"status":"ok"}` | 3 minutes |
| **Platform API** | `https://platform.bcom.si/health` | 200 OK | `{"status":"ok","service":"platform","db":{"ok":true,"role":"app_platform"}}` | 3 minutes |
| **Super Admin SPA** | `https://superadmin.bcom.si/` | 200 OK | none (static page; the API behind it is covered by the Platform API monitor) | 3 minutes |

## Health Checks & SSL Alerting Requirements

1. **Database Role Verification**:
   - `bsec-web` and `bsec-platform` execute a live `SELECT 1` and verify the connecting PostgreSQL role (`app_rw` vs `app_platform`).
   - If Postgres is unreachable or role configuration is corrupted, `/health` returns HTTP 503, which will trigger the uptime monitor alert.

2. **SSL Expiration Alerting**:
   - Alert when the TLS certificate has $\le 14$ days remaining.
