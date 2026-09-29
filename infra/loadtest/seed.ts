import pg from "pg";

const connectionString =
  process.env.TEST_DATABASE_URL_SUPERUSER ??
  process.env.DATABASE_URL_SUPERUSER ??
  "postgres://postgres:postgres@localhost:54322/bsec";

const orgId = "0199a074-0000-7000-8000-000000000000";
const tenantA = "0199a074-0000-7000-8000-000000000001";
const tenantB = "0199a074-0000-7000-8000-000000000002";
const locA = "0199a074-0000-7000-8000-000000000010";
const locB = "0199a074-0000-7000-8000-000000000020";
const userId = "0199a074-0000-7000-8000-000000000099";

export async function seedLoadTestData(): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();

  console.log("Seeding load test tenants and products into database...");
  await client.query("SET session_replication_role = 'replica'");

  // Clean prior load test artifacts
  await client.query(`
    DELETE FROM domains WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM inventory_levels WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM variants WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM products WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM locations WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM store_settings WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM store_status WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM memberships WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM roles WHERE tenant_id IN ('${tenantA}', '${tenantB}');
    DELETE FROM tenants WHERE id IN ('${tenantA}', '${tenantB}');
    DELETE FROM organizations WHERE id = '${orgId}';
    DELETE FROM users WHERE id = '${userId}';
    DELETE FROM rate_limit_counters WHERE key LIKE '%0199a074%';
  `);

  await client.query("SET session_replication_role = 'origin'");

  // 1. Organization & User
  await client.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Load Test Organization');
    INSERT INTO users (id, name, email) VALUES ('${userId}', 'Load Test Staff', 'admin@brandsewa.com')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 2. Tenants (Store A & Store B)
  await client.query(`
    INSERT INTO tenants (id, organization_id, slug, name, status)
    VALUES
      ('${tenantA}', '${orgId}', 'store-a', 'Store A (Noisy Neighbor)', 'active'),
      ('${tenantB}', '${orgId}', 'store-b', 'Store B (Target Store)', 'active');

    INSERT INTO store_status (tenant_id, mode)
    VALUES
      ('${tenantA}', 'live'),
      ('${tenantB}', 'live');

    INSERT INTO store_settings (tenant_id, store_name, currency, timezone, order_prefix)
    VALUES
      ('${tenantA}', 'Store A Noisy', 'INR', 'Asia/Kolkata', '#A-'),
      ('${tenantB}', 'Store B Benchmark', 'INR', 'Asia/Kolkata', '#B-');

    INSERT INTO domains (tenant_id, hostname, type, is_primary, status)
    VALUES
      ('${tenantA}', 'store-a.localhost', 'platform_subdomain', true, 'active'),
      ('${tenantA}', 'store-a.brandsewa.com', 'custom', false, 'active'),
      ('${tenantB}', 'store-b.localhost', 'platform_subdomain', true, 'active'),
      ('${tenantB}', 'store-b.brandsewa.com', 'custom', false, 'active');

    INSERT INTO locations (id, tenant_id, name, is_default)
    VALUES
      ('${locA}', '${tenantA}', 'Warehouse A', true),
      ('${locB}', '${tenantB}', 'Warehouse B', true);
  `);

  // 3. Roles and Memberships
  await client.query(`
    INSERT INTO roles (id, tenant_id, name, permissions)
    VALUES
      ('0199a074-0000-7000-8000-000000000081', '${tenantA}', 'store_owner', ARRAY['*']::text[]),
      ('0199a074-0000-7000-8000-000000000082', '${tenantB}', 'store_owner', ARRAY['*']::text[]);

    INSERT INTO memberships (id, tenant_id, user_id, role_id, status)
    VALUES
      ('0199a074-0000-7000-8000-000000000091', '${tenantA}', '${userId}', '0199a074-0000-7000-8000-000000000081', 'active'),
      ('0199a074-0000-7000-8000-000000000092', '${tenantB}', '${userId}', '0199a074-0000-7000-8000-000000000082', 'active');
  `);

  // 4. Products and Inventory for Store A (50 products) and Store B (100 products)
  console.log("Seeding products for Store A and Store B...");
  for (let i = 1; i <= 50; i++) {
    const pad = String(i).padStart(4, "0");
    const pId = `0199a074-0001-7000-8000-${pad}00000000`;
    const vId = `0199a074-0001-7000-8000-${pad}00000001`;
    const invId = `0199a074-0001-7000-8000-${pad}00000002`;

    await client.query(`
      INSERT INTO products (id, tenant_id, title, slug, short_description, status)
      VALUES ('${pId}', '${tenantA}', 'Store A Product ${i}', 'store-a-product-${i}', 'High-velocity apparel ${i}', 'published');

      INSERT INTO variants (id, tenant_id, product_id, sku, title, price)
      VALUES ('${vId}', '${tenantA}', '${pId}', 'SKU-A-${pad}', 'Default', 149900);

      INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
      VALUES ('${invId}', '${tenantA}', '${vId}', '${locA}', 10000, 0);
    `);
  }

  for (let i = 1; i <= 100; i++) {
    const pad = String(i).padStart(4, "0");
    const pId = `0199a074-0002-7000-8000-${pad}00000000`;
    const vId = `0199a074-0002-7000-8000-${pad}00000001`;
    const invId = `0199a074-0002-7000-8000-${pad}00000002`;

    await client.query(`
      INSERT INTO products (id, tenant_id, title, slug, short_description, status)
      VALUES ('${pId}', '${tenantB}', 'Store B Benchmark Product ${i}', 'store-b-product-${i}', 'Premium artisanal shirt item ${i}', 'published');

      INSERT INTO variants (id, tenant_id, product_id, sku, title, price)
      VALUES ('${vId}', '${tenantB}', '${pId}', 'SKU-B-${pad}', 'Default', 199900);

      INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
      VALUES ('${invId}', '${tenantB}', '${vId}', '${locB}', 50000, 0);
    `);
  }

  await client.end();
  console.log("Seeding completed successfully: Store A and Store B ready for load tests.");
}

// Standalone runner
if (process.argv[1]?.endsWith("seed.ts")) {
  seedLoadTestData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seeding error:", err);
      process.exit(1);
    });
}
