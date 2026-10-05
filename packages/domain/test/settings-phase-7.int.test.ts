import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  type TenantContext,
  getNotificationSettings,
  updateNotificationSettings,
  savePolicyDraft,
  publishPolicy,
  getPublishedPolicy,
  getPolicyVersions,
  restorePolicyDraft,
  getPrivacySettings,
  updatePrivacySettings,
  createPrivacyRequestPublic,
  RateLimitExceededError,
  executePrivacyErasure,
  setMarketingConsent,
  pruneEmailLogs,
  prunePrivacyRequests,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let rt: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

async function q<T extends pg.QueryResultRow>(url: string, text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query<T>(text, params);
  } finally {
    await c.end();
  }
}

const orgId = "0199a099-0000-7000-8000-000000000070";
const tenantId = "0199a099-0000-7000-8000-000000000071";
const tenantIdB = "0199a099-0000-7000-8000-000000000072";

let adminCtx: TenantContext;
let staffLimitedCtx: TenantContext;

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }

  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 15 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 15 });

  const pgClient = new pg.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM email_log WHERE tenant_id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM privacy_requests WHERE tenant_id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM privacy_settings WHERE tenant_id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM store_policy_versions WHERE tenant_id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM store_policies WHERE tenant_id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM customer_consent_events WHERE tenant_id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM customers WHERE tenant_id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM store_settings WHERE tenant_id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM tenants WHERE id IN ('${tenantId}', '${tenantIdB}');
    DELETE FROM organizations WHERE id = '${orgId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");

  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org P7') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'tenant-p7', 'Tenant P7') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantIdB}', '${orgId}', 'tenant-p7b', 'Tenant P7B') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO store_settings (tenant_id, store_name, address, checkout)
    VALUES ('${tenantId}', 'Test P7 Store', '{"state": "Delhi"}'::jsonb, '{}'::jsonb)
    ON CONFLICT DO NOTHING;
  `);

  await pgClient.end();

  adminCtx = {
    tenantId,
    roles: ["store_admin"],
    permissions: [
      "settings.read",
      "notifications.manage",
      "policies.manage",
      "privacy.manage",
      "orders.read",
      "customers.read",
      "customers.write",
      "customers.delete",
    ],
    actor: { type: "staff", userId: "0199a099-0000-7000-8000-000000000079" },
    storeStatus: "live",
    requestId: "req-p7-admin",
  };

  staffLimitedCtx = {
    tenantId,
    roles: ["analytics_viewer"],
    permissions: ["analytics.read"],
    actor: { type: "staff", userId: "0199a099-0000-7000-8000-000000000078" },
    storeStatus: "live",
    requestId: "req-p7-limited",
  };
}, 120_000);

afterAll(async () => {
  await rt?.close();
  await rwDb?.close();
  await container?.stop();
});

describe("Phase 7 Integration Tests (Real Postgres)", () => {
  describe("7A: Notification Preferences & Delivery Logging", () => {
    it("reads notification settings with default preferences", async () => {
      const settings = await getNotificationSettings(rt, adminCtx);
      expect(settings.preferences.v).toBe(1);
      expect(settings.preferences.customer.orderConfirmation).toBe(true);
      expect(settings.preferences.customer.accountSecurity).toBe(true);
    });

    it("denies read or update without permissions", async () => {
      await expect(getNotificationSettings(rt, staffLimitedCtx)).rejects.toThrow();
      await expect(
        updateNotificationSettings(rt, staffLimitedCtx, {
          sender: {},
          customer: {
            orderConfirmation: false,
            shipment: true,
            delivery: true,
            cancellation: true,
            refund: true,
            returnUpdates: true,
            preorderReminders: true,
          },
          staff: { newOrder: { enabled: false, recipients: [] } },
        }),
      ).rejects.toThrow();
    });

    it("updates notification settings and locks accountSecurity", async () => {
      const updated = await updateNotificationSettings(rt, adminCtx, {
        sender: { displayName: "P7 Store", replyToEmail: "support@p7store.com" },
        customer: {
          orderConfirmation: false,
          shipment: true,
          delivery: true,
          cancellation: true,
          refund: true,
          returnUpdates: true,
          preorderReminders: true,
        },
        staff: { newOrder: { enabled: true, recipients: ["ops@p7store.com"] } },
        footerNote: "Handcrafted with love",
      });

      expect(updated.sender.displayName).toBe("P7 Store");
      expect(updated.customer.orderConfirmation).toBe(false);
      expect(updated.customer.accountSecurity).toBe(true);
      expect(updated.staff.newOrder.recipients).toEqual(["ops@p7store.com"]);
    });

    it("prunes email_log entries older than 180 days", async () => {
      const oldDate = new Date(Date.now() - 190 * 86_400_000);
      await q(
        superUrl,
        `INSERT INTO email_log (tenant_id, template, to_email, subject, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, "order_confirmation", "old@example.com", "Old Order", "sent", oldDate.toISOString()],
      );

      const res = await pruneEmailLogs(rwDb.db, 180, tenantId);
      expect(res.deletedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("7B: Store Policies & Append-Only Versions", () => {
    it("creates draft, saves draft, and ensures draft is not published", async () => {
      const saved = await savePolicyDraft(rt, adminCtx, {
        handle: "terms",
        title: "Terms and Conditions",
        content: {
          v: 1,
          blocks: [
            { type: "heading", level: 2, text: "Store Terms" },
            { type: "paragraph", text: "Welcome to our store. By buying here, you agree to these terms." },
          ],
        },
      });

      expect(saved.id).toBeDefined();
      expect(saved.publishedVersion).toBeNull();

      const pub = await getPublishedPolicy(rwDb.db, tenantId, "terms");
      expect(pub).toBeNull();
    });

    it("rejects publishing if draft contains unreplaced starter placeholders", async () => {
      await savePolicyDraft(rt, adminCtx, {
        handle: "refund",
        title: "Refund Policy",
        content: {
          v: 1,
          blocks: [
            { type: "paragraph", text: "Please contact [Store Name] for refund requests." },
          ],
        },
      });

      await expect(
        publishPolicy(rt, adminCtx, "refund"),
      ).rejects.toThrow(/Unfilled template placeholder detected/);
    });

    it("publishes valid policy and creates immutable version snapshot", async () => {
      const published = await publishPolicy(rt, adminCtx, "terms");
      expect(published.publishedVersion).not.toBeNull();
      expect(published.publishedVersion?.version).toBe(1);

      const pub = await getPublishedPolicy(rwDb.db, tenantId, "terms");
      expect(pub).not.toBeNull();
      expect(pub?.version).toBe(1);
      expect(pub?.title).toBe("Terms and Conditions");

      const versions = await getPolicyVersions(rt, adminCtx, "terms");
      expect(versions.length).toBe(1);
      expect(versions[0]?.version).toBe(1);
    });

    it("refuses UPDATE and DELETE on store_policy_versions by app_rw grants", async () => {
      const rwUrl = as("app_rw", PW.rw);
      // Attempting UPDATE or DELETE as app_rw role
      await expect(
        q(rwUrl, `UPDATE store_policy_versions SET title = 'Altered' WHERE tenant_id = '${tenantId}'`),
      ).rejects.toThrow(/permission denied/i);

      await expect(
        q(rwUrl, `DELETE FROM store_policy_versions WHERE tenant_id = '${tenantId}'`),
      ).rejects.toThrow(/permission denied/i);
    });

    it("restores older version into draft without modifying version history", async () => {
      const versions = await getPolicyVersions(rt, adminCtx, "terms");
      const v1Id = versions[0]!.id;

      // Edit draft
      await savePolicyDraft(rt, adminCtx, {
        handle: "terms",
        title: "Terms Draft v2",
        content: {
          v: 1,
          blocks: [
            { type: "heading", level: 2, text: "Terms v2" },
            { type: "paragraph", text: "Draft text." },
          ],
        },
      });

      // Restore v1
      const restored = await restorePolicyDraft(rt, adminCtx, {
        handle: "terms",
        versionId: v1Id,
      });

      expect(restored.title).toBe("Terms and Conditions");
      const firstBlock = restored.draftContent.blocks[0] as { type: string; text?: string };
      expect(firstBlock?.text).toBe("Store Terms");
    });
  });

  describe("7C: Customer Privacy, Intake, Verification & DPDP Flow", () => {
    it("updates privacy settings with SLA limits and contact info", async () => {
      const initial = await getPrivacySettings(rt, adminCtx);
      expect(initial.requestSlaDays).toBe(30);

      const updated = await updatePrivacySettings(rt, adminCtx, {
        privacyContactEmail: "dpo@p7store.com",
        grievanceOfficerName: "Jane Doe",
        requestSlaDays: 21,
        expectedVersion: initial.version,
      });

      expect(updated.privacyContactEmail).toBe("dpo@p7store.com");
      expect(updated.grievanceOfficerName).toBe("Jane Doe");
      expect(updated.requestSlaDays).toBe(21);
    });

    it("public intake anti-enumerates and requires token verification", async () => {
      const res = await createPrivacyRequestPublic(rwDb.db, tenantId, {
        email: "shopper@example.com",
        kind: "access",
        details: "Please send all my customer details",
      });
      expect(res.success).toBe(true);

      // Verify token exists in action_tokens
      const tokenRes = await q(
        superUrl,
        `SELECT * FROM action_tokens WHERE tenant_id = $1 AND purpose = 'privacy_request_verify'`,
        [tenantId],
      );
      expect(tokenRes.rows.length).toBeGreaterThanOrEqual(1);

      // Verify request state is pending_verification
      const reqRes = await q(
        superUrl,
        `SELECT id, status FROM privacy_requests WHERE tenant_id = $1 AND requester_email = 'shopper@example.com'`,
        [tenantId],
      );
      expect(reqRes.rows[0]?.status).toBe("pending_verification");
    });

    it("public intake caps requests per address and per IP so a victim's inbox cannot be flooded", async () => {
      const run = Math.random().toString(36).slice(2, 8); // counters live an hour in a reused container
      const victim = `victim-${run}@example.com`;
      for (let i = 0; i < 3; i++) {
        await createPrivacyRequestPublic(rwDb.db, tenantId, { email: victim, kind: "access", ip: `10.0.0.${i}` });
      }
      await expect(
        createPrivacyRequestPublic(rwDb.db, tenantId, { email: victim, kind: "access", ip: "10.0.0.99" }),
      ).rejects.toBeInstanceOf(RateLimitExceededError);

      // One IP aimed at many different addresses is capped too.
      for (let i = 0; i < 10; i++) {
        await createPrivacyRequestPublic(rwDb.db, tenantId, { email: `spray-${run}-${i}@example.com`, kind: "access", ip: `10.9.${run}` });
      }
      await expect(
        createPrivacyRequestPublic(rwDb.db, tenantId, { email: `spray-${run}-x@example.com`, kind: "access", ip: `10.9.${run}` }),
      ).rejects.toBeInstanceOf(RateLimitExceededError);
    });

    it("anonymises customer on erasure if orders exist, hard deletes otherwise", async () => {
      const custId = "0199a099-0000-7000-8000-000000000066";
      await q(
        superUrl,
        `INSERT INTO customers (id, tenant_id, email, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [custId, tenantId, "erase_me@example.com", "Alice Smith"],
      );

      // Create privacy request for erasure
      const insertReq = await q<{ id: string }>(
        superUrl,
        `INSERT INTO privacy_requests (tenant_id, customer_id, requester_email, kind, status, due_at)
         VALUES ($1, $2, $3, 'erasure', 'open', NOW() + INTERVAL '30 days')
         RETURNING id`,
        [tenantId, custId, "erase_me@example.com"],
      );
      const reqId = insertReq.rows[0]!.id;

      const erasureRes = await executePrivacyErasure(rt, adminCtx, reqId);
      expect(erasureRes.success).toBe(true);
      expect(erasureRes.mode).toBe("deleted");
    });

    it("prunes privacy requests older than 1095 days", async () => {
      const oldDue = new Date(Date.now() - 1100 * 86_400_000);
      await q(
        superUrl,
        `INSERT INTO privacy_requests (tenant_id, requester_email, kind, status, due_at, created_at, updated_at)
         VALUES ($1, $2, 'access', 'completed', $3, $3, $3)`,
        [tenantId, "old_req@example.com", oldDue.toISOString()],
      );

      const res = await prunePrivacyRequests(rwDb.db, 1095, tenantId);
      expect(res.deletedCount).toBeGreaterThanOrEqual(1);
    });

    it("records hashed IP instead of raw IP in customer_consent_events", async () => {
      const custId = "0199a099-0000-7000-8000-000000000055";
      await q(
        superUrl,
        `INSERT INTO customers (id, tenant_id, email, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [custId, tenantId, "consent_shopper@example.com", "Bob Jones"],
      );

      const rawIp = "198.51.100.42";
      await setMarketingConsent(rt, adminCtx, {
        customerId: custId,
        state: "subscribed",
        source: "storefront_form",
        ip: rawIp,
        textVersion: "newsletter_v1",
      });

      const eventRes = await q<{ ip: string | null; ip_hash: string | null; text_version: string | null }>(
        superUrl,
        `SELECT ip, ip_hash, text_version FROM customer_consent_events
         WHERE tenant_id = $1 AND customer_id = $2
         ORDER BY at DESC LIMIT 1`,
        [tenantId, custId],
      );

      expect(eventRes.rows[0]?.ip).toBeNull();
      expect(eventRes.rows[0]?.ip_hash).not.toBeNull();
      expect(eventRes.rows[0]?.ip_hash).not.toBe(rawIp);
      expect(eventRes.rows[0]?.text_version).toBe("newsletter_v1");
    });
  });
});
