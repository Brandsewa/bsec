import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, desc } from "drizzle-orm";
import { createDb, schema, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  provisionTenant,
  type Runtime,
  type TenantContext,
  updateStoreStatus,
  scheduleMaintenance,
  cancelScheduledMaintenance,
  endMaintenance,
  updateCheckoutSettings,
  updateCustomerAccountSettings,
  updateCodMethod,
  updateTaxSettings,
  createTaxClass,
  updateTaxClass,
  deleteTaxClass,
  updateNotificationSettings,
  savePolicyDraft,
  publishPolicy,
  restorePolicyDraft,
  updatePrivacySettings,
  updateOrderSettings,
  updateAdminShippingSettings,
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

let tenantId: string;
let ownerUserId: string;
let ownerCtx: TenantContext;

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 10 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 10 });

  const p = await provisionTenant(rt, {
    storeName: "Settings Audit Tenant",
    slug: "settings-audit-test",
    owner: { email: "audit-owner@test.example", name: "Audit Owner" },
    planCode: "starter",
  });
  tenantId = p.tenantId;
  ownerUserId = p.ownerId;

  ownerCtx = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: ownerUserId },
    roles: ["store_owner"],
    permissions: ["*"],
    requestId: crypto.randomUUID(),
  };
});

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

/** Asserts that a diff or object tree contains no raw secrets or hashes. */
function assertNoSecretsInDiff(obj: unknown, forbiddenPatterns: RegExp[] = [
  /password123/i,
  /secret_key/i,
  /\$scrypt\$/i,
  /super-secret-token/i,
]) {
  if (!obj || typeof obj !== "object") return;
  const str = JSON.stringify(obj);
  for (const pat of forbiddenPatterns) {
    expect(str).not.toMatch(pat);
  }
}

describe("Slice 8D: Settings Audit Coverage & Sanitization Invariant", () => {
  describe("Storefront & Maintenance Mutations", () => {
    it("writes audit row with sanitized diff on updateStoreStatus", async () => {
      const TEST_PASSWORD = "Password123!Sensitive";
      await updateStoreStatus(rt, ownerCtx, {
        mode: "password",
        headline: "Coming Soon Holding Page",
        password: TEST_PASSWORD,
        bypassToken: "super-secret-token-preview-xyz",
      });

      const [latest] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);

      expect(latest).toBeDefined();
      expect(latest?.action).toBe("store_status.update");
      expect(latest?.actorType).toBe("staff");
      expect(latest?.actorId).toBe(ownerUserId);

      // Verify sanitized diff: password and bypassToken MUST ONLY be logged as "set" / "cleared"
      const diff = latest?.diff as Record<string, { before: unknown; after: unknown }>;
      expect(diff.password?.after).toBe("set");
      expect(diff.bypassToken?.after).toBe("set");
      assertNoSecretsInDiff(diff);
    });

    it("writes audit row on scheduleMaintenance, cancelScheduledMaintenance, and endMaintenance", async () => {
      const startsAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const endsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

      // 1. Schedule
      await scheduleMaintenance(rt, ownerCtx, { startsAt, endsAt, allowStaffPreview: true });
      const [schedLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(schedLog?.action).toBe("store_status.schedule_maintenance");
      expect(schedLog?.diff).toBeDefined();

      // 2. Cancel schedule
      await cancelScheduledMaintenance(rt, ownerCtx);
      const [cancelLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(cancelLog?.action).toBe("store_status.cancel_scheduled_maintenance");

      // 3. Set maintenance and end it
      await updateStoreStatus(rt, ownerCtx, { mode: "maintenance" });
      await endMaintenance(rt, ownerCtx);
      const [endLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(endLog?.action).toBe("store_status.end_maintenance");
    });
  });

  describe("Checkout & Customer Account Settings Mutations", () => {
    it("writes audit row on updateCheckoutSettings", async () => {
      await updateCheckoutSettings(rt, ownerCtx, {
        guestCheckout: true,
        phoneRequired: true,
        companyName: "optional",
      });

      const [latest] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);

      expect(latest?.action).toBe("checkout_settings.update");
      expect(latest?.actorId).toBe(ownerUserId);
      assertNoSecretsInDiff(latest?.diff);
    });

    it("writes audit row on updateCustomerAccountSettings", async () => {
      await updateCustomerAccountSettings(rt, ownerCtx, {
        showSignInLinks: true,
        emailPasswordEnabled: true,
        allowSelfServeReturns: true,
      });

      const [latest] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);

      expect(latest?.action).toBe("customer_account_settings.update");
      assertNoSecretsInDiff(latest?.diff);
    });
  });

  describe("Payments, Shipping & Order Settings Mutations", () => {
    it("writes audit row on updateCodMethod", async () => {
      await updateCodMethod(rt, ownerCtx, {
        enabled: true,
        feePaise: 5000,
        minOrderPaise: 10000,
        maxOrderPaise: 500000,
      });

      const [latest] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);

      expect(latest?.action).toBe("payments.cod_update");
      assertNoSecretsInDiff(latest?.diff);
    });

    it("writes audit row on updateOrderSettings", async () => {
      await updateOrderSettings(rt, ownerCtx, {
        stockHoldMinutes: 45,
        minimumOrderPaise: 20000,
      });

      const [latest] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);

      expect(latest?.action).toBe("order_settings.update");
      assertNoSecretsInDiff(latest?.diff);
    });

    it("writes audit row on updateAdminShippingSettings", async () => {
      await updateAdminShippingSettings(rt, ownerCtx, {
        zoneName: "India All",
        standardRatePaise: 5000,
        expressRatePaise: 15000,
        freeShippingThresholdPaise: null,
      });

      const [latest] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);

      expect(latest?.action).toBe("shipping_settings.update");
      assertNoSecretsInDiff(latest?.diff);
    });
  });

  describe("Taxes & Notifications Mutations", () => {
    it("writes audit row on updateTaxSettings and tax classes", async () => {
      await updateTaxSettings(rt, ownerCtx, {
        taxCollection: true,
        gstin: "27AABCU9603R1ZM",
        sellerState: "Maharashtra",
        pricesIncludeTax: true,
      });

      const [latestTax] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(latestTax?.action).toBe("tax_settings.update");

      const created = await createTaxClass(rt, ownerCtx, {
        name: "Luxury Tax",
        rateBps: 2800,
        defaultHsn: "9999",
        isDefault: false,
      });
      const [createLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(createLog?.action).toBe("tax_class.create");

      await updateTaxClass(rt, ownerCtx, {
        id: created.id,
        name: "Ultra Luxury",
        rateBps: 2800,
      });
      const [updateLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(updateLog?.action).toBe("tax_class.update");

      await deleteTaxClass(rt, ownerCtx, created.id);
      const [deleteLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(deleteLog?.action).toBe("tax_class.delete");
    });

    it("writes audit row on updateNotificationSettings", async () => {
      await updateNotificationSettings(rt, ownerCtx, {
        staff: {
          newOrder: { enabled: true, recipients: ["ops@test.example"] },
        },
      });

      const [latest] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);

      expect(latest?.action).toBe("notification_settings.update");
      assertNoSecretsInDiff(latest?.diff);
    });
  });

  describe("Policies & Customer Privacy Mutations", () => {
    it("writes audit row on savePolicyDraft, publishPolicy, and restorePolicyDraft", async () => {
      await savePolicyDraft(rt, ownerCtx, {
        handle: "privacy",
        title: "Privacy Policy",
        content: {
          v: 1,
          blocks: [
            { type: "heading", level: 2, text: "Privacy Policy Draft" },
            { type: "paragraph", text: "We value and protect customer data privacy." },
          ],
        },
      });
      const [saveLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(saveLog?.action).toBe("policy.draft_saved");

      const pub = await publishPolicy(rt, ownerCtx, "privacy");
      const [pubLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(pubLog?.action).toBe("policy.published");

      await restorePolicyDraft(rt, ownerCtx, {
        handle: "privacy",
        versionId: pub.publishedVersion!.id,
      });
      const [resLog] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);
      expect(resLog?.action).toBe("policy.draft_restored");
    });

    it("writes audit row on updatePrivacySettings", async () => {
      await updatePrivacySettings(rt, ownerCtx, {
        privacyContactEmail: "privacy@test.example",
        grievanceOfficerName: "Grievance Officer",
        requestSlaDays: 30,
      });

      const [latest] = await rt._db.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1);

      expect(latest?.action).toBe("privacy_settings.update");
      assertNoSecretsInDiff(latest?.diff);
    });
  });
});
