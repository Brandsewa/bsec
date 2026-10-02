# Production Rollback Runbook

**Environment:** Production on `server.brandsewa.com` (host IP `88.222.241.159`).  
**Coolify Project:** Bs Commerce Platform -> Environment `production`.  
**Plan Reference:** PLAN §14 ("Database migration safety: expand -> migrate -> contract").

> **UNTESTED:** none of the commands below have been run against the production Coolify server. The Coolify API call in
> section 3, the image tag/SHA values, and the container names used with `docker exec` (`bsec-postgres`, `bsec-worker`) are assumptions
> from the runbook author, not verified facts: Coolify names containers by UUID, and there is no SSH access from the development
> environment. Verify each step in Coolify's UI (Deployments > Rollback) before relying on it in an incident.

---

## 1. The Core Invariant: The Expand / Contract Rule

Per PLAN §14, all changes follow **expand -> migrate -> contract**:
1. **Expand:** New database columns, tables, or constraints are introduced as nullable or with backward-compatible defaults. The database supports BOTH the current application version and the previous application version simultaneously.
2. **Migrate:** The new application version is deployed and begins reading/writing the new schema.
3. **Contract:** Destructive changes (dropping deprecated columns, deleting obsolete tables, renaming fields) are strictly deferred to a subsequent milestone after the new version has soaked in production.

> [!IMPORTANT]
> **Because of the Expand/Contract Rule, an application rollback (rolling back container images) is safe to execute at any time WITHOUT rolling back database migrations.**

---

## 2. Fast Application Rollback (Image Tag Reversion)

When a new release introduces regressions (e.g. 500 errors, checkout failure, memory leaks):

### Step 1: Identify Last Known Good Image Tag
1. Inspect GitHub Actions deploy history on `main` or inspect Coolify deployment history.
2. Image tags follow the strict format `sha-<full_git_commit_sha>`.
   - Example current (bad) tag: `sha-7a1b2c3d4e5f...`
   - Example previous (good) tag: `sha-6e78ac7...`

### Step 2: Trigger Rollback via Coolify UI
1. Navigate to Coolify (`https://server.brandsewa.com`).
2. Go to **Bs Commerce Platform** -> **production**.
3. For each affected service (`bsec-web`, `bsec-worker`, `bsec-platform`, `bsec-admin`):
   - Open resource -> **Configuration** -> **Docker Image**.
   - Change image tag from `ghcr.io/brandsewa/bsec-<service>:sha-<bad-sha>` to `ghcr.io/brandsewa/bsec-<service>:sha-<good-sha>`.
   - Click **Save** and **Deploy**.
4. Check Runtime Logs to confirm image is pulled and running.

### Step 3: Trigger Rollback via Coolify API (Headless Emergency CLI)
If Coolify UI is unavailable, use the Coolify API bearer token from GitHub Secrets (`COOLIFY_TOKEN`):
```bash
# Set parameters
COOLIFY_API_URL="https://server.brandsewa.com/api/v1"
BEARER_TOKEN="<COOLIFY_API_TOKEN>"
PREV_SHA="sha-6e78ac7f0123456789abcdef0123456789abcdef"

# Update web resource image tag
curl -X PATCH "${COOLIFY_API_URL}/applications/7wuzc3xhtzhxud3315pjutnd" \
  -H "Authorization: Bearer ${BEARER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"custom_docker_run_options\": \"\", \"image\": \"ghcr.io/brandsewa/bsec-web:${PREV_SHA}\"}"

# Trigger immediate deploy
curl -X POST "${COOLIFY_API_URL}/deploy?uuid=7wuzc3xhtzhxud3315pjutnd&force=true" \
  -H "Authorization: Bearer ${BEARER_TOKEN}"
```

---

## 3. Database Migration Rollback Protocol

### Policy on Database Rollbacks
- **Default Action:** **DO NOT TOUCH THE DATABASE.** Since all migrations follow the expand-only rule, the previous code version will ignore any newly added columns or tables.
- **Exception (Corrupted Schema or Table Lock Bug):** If and only if a migration introduced an invalid table constraint, lock deadlock, or data corruption that prevents the old code from operating.

### Step-by-Step Emergency DB Schema Correction
1. SSH into the production host:
```bash
ssh root@server.brandsewa.com
```
2. Inspect the latest applied migration in Drizzle metadata journal:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
SELECT id, hash, created_at FROM \"drizzle\".\"__drizzle_migrations\" ORDER BY id DESC LIMIT 5;
"
```
3. If an index is causing locking or performance degradation, drop it concurrently (zero downtime):
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
DROP INDEX CONCURRENTLY IF EXISTS <problematic_index_name>;
"
```
4. If a check constraint or foreign key constraint is incorrectly blocking writes:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
ALTER TABLE <table_name> DROP CONSTRAINT <constraint_name>;
"
```
5. If a migration row in `__drizzle_migrations` must be removed so the fixed migration can re-run:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
DELETE FROM \"drizzle\".\"__drizzle_migrations\" WHERE id = <latest_id>;
"
```

---

## 4. Post-Rollback Verification Checklist

Immediately after rollback completes, verify the following in sequence:

- [ ] **Health Endpoint Version:** `curl -sS https://bcom.si/api/health | jq .version` confirms the running container is on the rollback version / commit SHA.
- [ ] **Database Connection Health:** `curl -sS https://bcom.si/api/health | jq .db` returns `{"ok": true, "role": "app_rw"}`.
- [ ] **Storefront Smoke Test:** Load home page `https://bcom.si/` and a product page. Verify HTTP 200 and valid rendered HTML.
- [ ] **Admin Smoke Test:** Open `https://admin.bcom.si/` and log in. Verify order list loads cleanly.
- [ ] **Background Worker Logs:** Check `docker logs --tail 50 bsec-worker` to verify pg-boss consumers are processing jobs without errors.
- [ ] **Git Alignment:** Open a revert PR on GitHub (`git revert <bad_commit>`) to keep git `main` aligned with the deployed state.
