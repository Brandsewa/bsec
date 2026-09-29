# Backup & Restore Drill Runbook (M0 / M6 Hardening)

## 1. Objectives & SLO Targets (PLAN §14, §15)

- **Recovery Point Objective (RPO)**: $\le 15\text{ minutes}$ (Continuous WAL archiving) / $\le 24\text{ hours}$ (Coolify native daily pg_dump).
- **Recovery Time Objective (RTO)**: $\le 2\text{ hours}$ from incident declaration to scratch database validation.
- **Data Integrity**: Zero transaction loss for committed orders; identical row counts and constraint validity.

---

## 2. Environment & Credential Status

> [!WARNING]
> **Blocked from live execution on production storage:**
> The current execution environment is a local build machine with no SSH access to the production host (`server.brandsewa.com` / `88.222.241.159`) and no production Cloudflare R2 access keys (`PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET` for bucket `bsec-backups`).
> Per engineering directives, live drill execution against production storage is **not simulated**. The step-by-step verified procedure below is documented for execution by the infrastructure operator who possesses production secrets.

---

## 3. RPO Architecture & Scope Caveat (pg_dump vs pgBackRest PITR)

> [!IMPORTANT]
> **Current Practice vs Continuous Archiving**:
> The restore drill procedure documented in §4 restores a full logical dump (`pg_dump`), which corresponds to Coolify's native daily backup to Cloudflare R2.
> The strict **$\le 15$-minute RPO target** in PLAN §14 depends on **pgBackRest continuous WAL archiving and Point-In-Time Recovery (PITR)**.
> This pgBackRest PITR pipeline has **not been exercised or deployed** in production yet (it requires running the pgBackRest sidecar and configuring PostgreSQL WAL archiving on the shared VPS).
> Note also that Postgres continuous archiving parameters (such as `archive_mode = on`, `archive_command = 'pgbackrest --stanza=bsec archive-push %p'`, and `archive_timeout = 60`) live in the documentation in `infra/backups/README.md` and `postgresql.conf`, not inside `pgbackrest.conf`.

---

## 4. Step-by-Step Restore Drill Procedure (pg_dump from R2)

### Step 4.1: Provision Clean Scratch PostgreSQL 18
On the recovery host or staging machine:
```bash
docker run -d \
  --name bsec-postgres-scratch \
  -e POSTGRES_PASSWORD=scratch_drill_super_pw \
  -e POSTGRES_DB=bsec \
  -p 54399:5432 \
  postgres:18
```

### Step 4.2: Retrieve Backup from Cloudflare R2
Using AWS CLI or MinIO Client configured for Cloudflare R2:
```bash
export AWS_ACCESS_KEY_ID="<R2_ACCESS_KEY_ID>"
export AWS_SECRET_ACCESS_KEY="<R2_SECRET_ACCESS_KEY>"
export AWS_ENDPOINT_URL="https://7a0533854a8ded58696db809f403f26c.r2.cloudflarestorage.com"

# List available dumps
aws s3 ls s3://bsec-backups/data/

# Download latest verified dump
LATEST_BACKUP=$(aws s3 ls s3://bsec-backups/data/ | sort | tail -n 1 | awk '{print $4}')
aws s3 cp "s3://bsec-backups/data/${LATEST_BACKUP}" ./latest-restore.dump
```

### Step 4.3: Measure RTO Start & Restore Schema & Data
```bash
RESTORE_START=$(date +%s)

# Restore using pg_restore
docker cp ./latest-restore.dump bsec-postgres-scratch:/tmp/latest-restore.dump
docker exec -i bsec-postgres-scratch pg_restore \
  -U postgres \
  -d bsec \
  --clean \
  --if-exists \
  --no-owner \
  /tmp/latest-restore.dump

RESTORE_END=$(date +%s)
RTO_SECONDS=$((RESTORE_END - RESTORE_START))
echo "Restore completed in ${RTO_SECONDS} seconds (RTO Target: <= 7200s)"
```

### Step 4.4: Verify Schema Migrations & Zero Drift
Run database migration tool against scratch DB using owner credentials:
```bash
pnpm --filter @bs/db migrate
# Output must indicate zero pending migrations ("Migrations up to date")
```

### Step 4.5: Row Count & Consistency Audit
Query production and scratch databases to compare critical table row counts:
```sql
SELECT 'organizations' AS tbl, count(*) FROM organizations
UNION ALL SELECT 'tenants', count(*) FROM tenants
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'variants', count(*) FROM variants
UNION ALL SELECT 'inventory_levels', count(*) FROM inventory_levels
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items
UNION ALL SELECT 'invoices', count(*) FROM invoices
UNION ALL SELECT 'number_sequences', count(*) FROM number_sequences
UNION ALL SELECT 'webhook_inbox', count(*) FROM webhook_inbox
UNION ALL SELECT 'email_log', count(*) FROM email_log;
```

### Step 4.6: Verify RPO
Calculate difference between latest transaction timestamp in restored database and time of backup:
```sql
SELECT max(placed_at) AS latest_order_time FROM orders;
SELECT max(created_at) AS latest_invoice_time FROM invoices;
```
Verify that $\text{backup\_timestamp} - \text{latest\_order\_time} \le \text{RPO Target}$.

### Step 4.7: Clean Up Scratch Container
```bash
docker stop bsec-postgres-scratch && docker rm -v bsec-postgres-scratch
rm -f ./latest-restore.dump
```

---

## 5. Drill Log Record Template (Super Admin -> System)

| Parameter | Drill Value | Target SLO | Pass / Fail |
|---|---|---|---|
| **Backup Object** | | Valid R2 object | |
| **RTO (Duration)** | | $\le 2\text{ hours}$ | |
| **RPO (Lag)** | | $\le 15\text{ min}$ (WAL) / $\le 24\text{ h}$ (Dump) | |
| **Order Row Diff** | | `0` | |
| **Invoice Row Diff**| | `0` | |
| **Migration State**| | No pending schema drift | |
