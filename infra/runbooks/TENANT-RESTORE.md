# Single-Tenant Point-in-Time Restore Runbook

**Environment:** Production on `server.brandsewa.com` (host IP `<VPS IP, kept out of the public repo>`).  
**Plan Reference:** PLAN §14 ("Backups and disaster recovery: single-tenant restore without touching other tenants").

---

## 1. Why a Full Database Restore is Prohibited for Single-Tenant Incidents

In a multi-tenant shared PostgreSQL cluster (PLAN §4, §14), every table contains data from multiple stores partitioned by `tenant_id`.

> [!CAUTION]
> **NEVER restore a full cluster backup over the live `bsec` database to fix a single store.**  
> Doing so would roll back all transactions, checkouts, payments, and order fulfillment events for every other innocent tenant on the platform.

A single-tenant restore must always follow the **Sidecar Extraction Pattern**:
```
Live Production Cluster (Untouched)
          ▲
          │ 4. Surgical Insert / Merge
          │
Scratch Postgres Container (Ephemeral)
  ◄── 1. Restore Full Point-In-Time Backup (pgBackRest / pg_dump)
  ──► 2. Extract Target Tenant Rows in Dependency Order (tenant_id = $ID)
  ──► 3. Validate Row Counts & Integrity Checksums
```

---

## 2. Step-by-Step Single-Tenant Restore Protocol

### Step 1: Set Target Tenant to Maintenance Mode
Prevent incoming customer checkouts or staff modifications while restoration is in progress:
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
UPDATE store_status
   SET mode = 'maintenance',
       headline = 'Scheduled Maintenance',
       message_json = '{\"text\": \"We are performing a brief maintenance window. Please check back shortly.\"}'::jsonb
 WHERE tenant_id = '<TARGET_TENANT_ID>';
"
```

### Step 2: Spin Up an Ephemeral Scratch Postgres Container
On the production host (or staging environment), spin up a temporary scratch Postgres 18 instance:
```bash
docker run -d --name bsec-restore-scratch \
  -e POSTGRES_PASSWORD=restore_temp_pw \
  -e POSTGRES_DB=bsec_restore \
  postgres:18

# Restore the target backup into bsec_restore
# From pg_dump:
cat /var/backups/bsec/bsec_backup_YYYYMMDD_HHMM.dump | \
  docker exec -i bsec-restore-scratch pg_restore -U postgres -d bsec_restore --no-owner --role=postgres

# (Or from pgBackRest PITR target time - see infra/backups/README.md)
```

### Step 3: Extract Target Tenant Tables in Topological Dependency Order
Tables must be extracted respecting foreign key constraints:
```bash
TENANT_ID="<TARGET_TENANT_ID>"
EXPORT_DIR="/tmp/tenant_restore_${TENANT_ID}"
mkdir -p "${EXPORT_DIR}"

# List of tenant-scoped tables in strict dependency order:
TABLES=(
  "store_settings"
  "store_status"
  "roles"
  "memberships"
  "brands"
  "locations"
  "categories"
  "products"
  "product_options"
  "variants"
  "inventory_levels"
  "inventory_movements"
  "customers"
  "customer_addresses"
  "orders"
  "order_items"
  "order_events"
  "payment_intents"
  "payment_attempts"
  "refunds"
  "invoices"
  "fulfillments"
  "fulfillment_items"
  "discounts"
  "shipping_zones"
  "shipping_rates"
)

for tbl in "${TABLES[@]}"; do
  echo "Exporting ${tbl} for tenant ${TENANT_ID}..."
  docker exec -i bsec-restore-scratch psql -U postgres -d bsec_restore -c "
    COPY (SELECT * FROM \"${tbl}\" WHERE tenant_id = '${TENANT_ID}') TO STDOUT WITH (FORMAT CSV, HEADER);
  " > "${EXPORT_DIR}/${tbl}.csv"
done
```

### Step 4: Validate Extracted Data Integrity
Inspect row counts and verify against pre-incident expected counts:
```bash
for tbl in "${TABLES[@]}"; do
  ROWS=$(wc -l < "${EXPORT_DIR}/${tbl}.csv")
  echo "${tbl}: $((ROWS - 1)) rows extracted"
done
```

### Step 5: Surgically Merge / Re-Import into Live Production Database
Perform the replacement inside an explicit transactional block on production:
```bash
# In production Postgres (bsec-postgres):
docker exec -i bsec-postgres psql -U postgres -d bsec <<EOF
BEGIN;

-- Disable triggers or constraints temporarily for clean import if necessary
-- Note: set session_replication_role = 'replica' bypasses FK and RLS checks during surgical restore
SET session_replication_role = 'replica';

-- Delete existing corrupted rows for target tenant only (in reverse dependency order)
DELETE FROM shipping_rates WHERE tenant_id = '${TENANT_ID}';
DELETE FROM shipping_zones WHERE tenant_id = '${TENANT_ID}';
DELETE FROM fulfillment_items WHERE tenant_id = '${TENANT_ID}';
DELETE FROM fulfillments WHERE tenant_id = '${TENANT_ID}';
DELETE FROM invoices WHERE tenant_id = '${TENANT_ID}';
DELETE FROM refunds WHERE tenant_id = '${TENANT_ID}';
DELETE FROM payment_attempts WHERE tenant_id = '${TENANT_ID}';
DELETE FROM payment_intents WHERE tenant_id = '${TENANT_ID}';
DELETE FROM order_events WHERE tenant_id = '${TENANT_ID}';
DELETE FROM order_items WHERE tenant_id = '${TENANT_ID}';
DELETE FROM orders WHERE tenant_id = '${TENANT_ID}';
DELETE FROM inventory_movements WHERE tenant_id = '${TENANT_ID}';
DELETE FROM inventory_levels WHERE tenant_id = '${TENANT_ID}';
DELETE FROM variants WHERE tenant_id = '${TENANT_ID}';
DELETE FROM product_options WHERE tenant_id = '${TENANT_ID}';
DELETE FROM products WHERE tenant_id = '${TENANT_ID}';

COMMIT;
EOF
```
Stream the CSVs into live tables:
```bash
for tbl in "${TABLES[@]}"; do
  if [ -s "${EXPORT_DIR}/${tbl}.csv" ]; then
    echo "Importing ${tbl}..."
    docker exec -i bsec-postgres psql -U postgres -d bsec -c "
      SET session_replication_role = 'replica';
      COPY \"${tbl}\" FROM STDIN WITH (FORMAT CSV, HEADER);
    " < "${EXPORT_DIR}/${tbl}.csv"
  fi
done
```

### Step 6: Verify and Release Maintenance Mode
```bash
docker exec -i bsec-postgres psql -U postgres -d bsec -c "
SET session_replication_role = 'origin';

-- Verify counts
SELECT count(*) FROM products WHERE tenant_id = '${TENANT_ID}';
SELECT count(*) FROM orders WHERE tenant_id = '${TENANT_ID}';

-- Return store to live operation
UPDATE store_status SET mode = 'live' WHERE tenant_id = '${TENANT_ID}';
"

# Clean up ephemeral scratch container
docker rm -f bsec-restore-scratch
rm -rf "${EXPORT_DIR}"
```

---

## 3. Operational Verification Status

- **Status:** **Untested procedure against production** (verified only on local scratch database container; see `infra/backups/RESTORE-DRILL-M7.md`). Always verify and dry-run on a staging/scratch container prior to production use.
- **Production PITR:** Continuous WAL archiving and PITR via pgBackRest/WAL-G are **NOT** configured in production yet. Production currently relies on daily scheduled full logical dumps (`pg_dump` via Coolify to Cloudflare R2). Point-in-time recovery is unavailable until continuous WAL archiving is configured post-M9.
