# Rollback Runbook

> **Platform Operations & SRE Standards**  
> System: Brand Sewa E-Commerce Platform (`bsec`)  
> Target Infrastructure: Coolify API / Docker Registry / Drizzle ORM  
> Date: September 2026

---

## 1. Application Image Rollback (Web, Platform, Worker, Admin, Superadmin)

Because images are built with immutable Git SHA tags (`ghcr.io/brandsewa/bsec-<app>:sha-<commit>`), rollbacks to any previous known-healthy build are instantaneous and deterministic.

### Coolify API Rollback Procedure
1. Identify the last healthy commit SHA (e.g. from GitHub Actions CI history).
2. In Coolify Dashboard:
   - Navigate to the affected application resource (e.g. `bsec-web` or `bsec-platform`).
   - In **General Settings** → **Docker Image**, change tag from `sha-new` to `sha-previous`.
   - Click **Deploy** (takes ~15 seconds to pull and restart container).
3. Alternatively, trigger redeploy via Coolify Webhook/API:
   ```bash
   curl -fsS -X POST "$COOLIFY_URL/api/v1/deploy?uuid=$APP_UUID&force=true" \
     -H "Authorization: Bearer $COOLIFY_TOKEN"
   ```
4. Verify healthcheck:
   ```bash
   curl -fsS http://127.0.0.1:4000/health
   curl -fsS http://127.0.0.1:3000/api/health
   curl -fsS http://127.0.0.1:8081/health
   ```
   *(Status: TESTED in CI staging-smoke-test step)*.

---

## 2. Database Migration Rollback Policy

### Core Rule: Forward-Only & Additive Migrations
- In accordance with ADR 003, database schema migrations in `packages/db/migrations` are designed to be **additive and backward-compatible**.
- Columns are added as nullable or with defaults before application code uses them.
- Columns are never dropped in the same release as code changes.

### Emergency Down-Migration (When Irreversible Schema Error Occurs)
> **WARNING: Down-migrations carry risk of data loss. Always run a manual pg_dump before altering tables.**

1. Take emergency database snapshot:
   ```bash
   docker exec -t $(docker ps -qf "name=postgres") pg_dump -U postgres -d bsec -Fc > /root/backups/bsec_pre_rollback_$(date +%s).dump
   ```
   *(Status: UNTESTED in automated pipeline; must be run manually by operator)*.

2. Inspect `__drizzle_migrations` table:
   ```sql
   SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 5;
   ```

3. If a specific migration script must be reverted:
   - Identify the SQL statements in the failed migration file (e.g. `packages/db/migrations/0013_*.sql`).
   - Execute the reverse SQL statements within an explicit transaction:
     ```sql
     BEGIN;
     -- e.g. DROP TABLE new_table; or ALTER TABLE tenants DROP COLUMN new_column;
     DELETE FROM __drizzle_migrations WHERE hash = '<failed_migration_hash>';
     COMMIT;
     ```
   - *(Status: UNTESTED in production; verified in local development)*.

---

## 3. Configuration & Secrets Rollback

If a secret was incorrectly updated in environment variables:
1. `TENANT_SECRETS_KEY`:
   > **CAUTION: Never permanently delete or overwrite the old key if tenant secrets were encrypted with it.** If rotated mistakenly, immediately restore the previous key value from backup password store.
2. `BETTER_AUTH_SECRET`:
   - Reverting this will invalidate all active sessions, requiring store owners and platform staff to re-authenticate with their password and MFA.
