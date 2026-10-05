import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDb,
  type DbHandle,
  schema,
  withTenant,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  provisionTenant,
  getPlanAndBilling,
  listAvailablePlans,
  requestPlanChange,
  cancelPlanChangeRequest,
  listPaymentMethods,
  updateCodMethod,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { listPlatformPlanChangeRequests, decidePlatformPlanChangeRequest } from "../src/platform/plan-change-requests.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let platformDb: DbHandle;
let rt: Runtime;
let rtPlatform: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

let tenantId = "0199a0d5-0000-7000-8000-000000000001";
const OWNER_EMAIL = "p5-owner@test.example";
let ownerUserId = "";
let ownerCtx: TenantContext;
let staffUserId = "";
let staffCtx: TenantContext;
let platformStaffId = "";

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
  platformDb = createDb(as("app_platform", PW.platform), { max: 10 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 10 });
  rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 10 });

  // Clean and seed
  await platformDb.db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM plan_change_requests WHERE tenant_id = '${tenantId}'`);
    await tx.execute(`DELETE FROM payment_methods WHERE tenant_id = '${tenantId}'`);
    await tx.execute(`DELETE FROM memberships WHERE tenant_id = '${tenantId}'`);
    await tx.execute(`DELETE FROM roles WHERE tenant_id = '${tenantId}'`);
    await tx.execute(`DELETE FROM subscriptions WHERE tenant_id = '${tenantId}'`);
    await tx.execute(`DELETE FROM tenants WHERE id = '${tenantId}'`);
  });

  const slug = `p5-test-${Date.now()}`;
  const owner = await provisionTenant(rtPlatform, {
    storeName: "Phase 5 Test Store",
    slug,
    owner: { email: OWNER_EMAIL, name: "Owner P5" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = owner.tenantId;
  ownerUserId = owner.ownerId;

  // Add a non-owner staff member
  const [staffUser] = await platformDb.db
    .insert(schema.users)
    .values({
      email: `staff-${Date.now()}@p5.test`,
      name: "Staff P5",
      emailVerified: true,
    })
    .returning({ id: schema.users.id });
  staffUserId = staffUser!.id;

  // provisionTenant already created system roles including store_admin; update its permissions or create a custom role
  const existingRole = await platformDb.db.query.roles.findFirst({
    where: (r, { and, eq }) => and(eq(r.tenantId, tenantId), eq(r.name, "store_admin")),
  });

  let staffRoleId: string;
  if (existingRole) {
    staffRoleId = existingRole.id;
    await platformDb.db
      .update(schema.roles)
      .set({ permissions: ["settings.read", "settings.write", "payments.manage"] })
      .where(eq(schema.roles.id, existingRole.id));
  } else {
    const [createdRole] = await platformDb.db
      .insert(schema.roles)
      .values({
        tenantId,
        name: "staff_manager",
        isSystem: false,
        permissions: ["settings.read", "settings.write", "payments.manage"],
      })
      .returning({ id: schema.roles.id });
    staffRoleId = createdRole!.id;
  }

  await platformDb.db.insert(schema.memberships).values({
    tenantId,
    userId: staffUserId,
    roleId: staffRoleId,
    status: "active",
  });

  // Seed a platform staff member
  const [pUser] = await platformDb.db
    .insert(schema.users)
    .values({
      email: `platform-${Date.now()}@platform.test`,
      name: "Platform Admin",
      emailVerified: true,
      twoFactorEnabled: true,
    })
    .returning({ id: schema.users.id });
  platformStaffId = pUser!.id;

  await platformDb.db.insert(schema.twoFactors).values({
    id: `2fa-${Date.now()}`,
    userId: platformStaffId,
    secret: "testsecret",
    backupCodes: "[]",
    verified: true,
  });

  await platformDb.db.insert(schema.platformStaff).values({
    userId: platformStaffId,
    role: "platform_admin",
    isActive: true,
    mfaVerifiedAt: new Date(Date.now() - 3600_000),
  });

  ownerCtx = {
    tenantId,
    actor: { type: "staff", userId: ownerUserId },
    roles: ["store_owner"],
    permissions: ["settings.read", "settings.write", "payments.manage"],
    storeStatus: "live",
    requestId: "test-req-owner",
  };

  staffCtx = {
    tenantId,
    actor: { type: "staff", userId: staffUserId },
    roles: ["store_admin"],
    permissions: ["settings.read", "settings.write", "payments.manage"],
    storeStatus: "live",
    requestId: "test-req-staff",
  };
}, 60_000);

afterAll(async () => {
  await rt?.close();
  await rtPlatform?.close();
  await rwDb?.close();
  await platformDb?.close();
  await container?.stop();
});

describe("Settings Phase 5: Payment Methods Catalogue & Dual-Read", () => {
  it("lists payment methods catalogue and dual-reads COD from store_settings fallback or payment_methods table", async () => {
    const methods = await listPaymentMethods(rt, staffCtx);
    expect(methods.length).toBeGreaterThanOrEqual(2);
    const cod = methods.find((m) => m.provider === "cod");
    expect(cod).toBeDefined();
    expect(cod?.provider).toBe("cod");
    expect(["active", "disabled"]).toContain(cod?.status);

    const rzp = methods.find((m) => m.provider === "razorpay");
    expect(rzp).toBeDefined();
    expect(rzp?.status).toBe("unavailable"); // live adapter disabled
  });

  it("updates COD via updateCodMethod, enforces payments.manage, and dual-writes to store_settings", async () => {
    const res = await updateCodMethod(rt, staffCtx, {
      enabled: true,
      displayName: "Cash On Delivery (Express)",
      feePaise: 4500,
      minOrderPaise: 50000,
      maxOrderPaise: 500000,
    });
    expect(res.status).toBe("active");
    const publicConfig = res.publicConfig as Record<string, unknown>;
    expect(publicConfig.feePaise).toBe(4500);
    expect(publicConfig.minOrderPaise).toBe(50000);
    expect(publicConfig.maxOrderPaise).toBe(500000);

    // Verify dual-write in store_settings
    const [ss] = await withTenant(rwDb.db, tenantId, (tx) =>
      tx.select().from(schema.storeSettings).where(eq(schema.storeSettings.tenantId, tenantId)).limit(1),
    );
    const checkoutObj = ss?.checkout as Record<string, unknown> | undefined;
    expect(checkoutObj?.cod).toMatchObject({
      enabled: true,
      feePaise: 4500,
    });

    // Verify written to payment_methods table
    const [pm] = await withTenant(rwDb.db, tenantId, (tx) =>
      tx.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.tenantId, tenantId)).limit(1),
    );
    expect(pm?.displayName).toBe("Cash On Delivery (Express)");
    expect(pm?.status).toBe("active");
  });

  it("rejects non-staff or unauthorized calls to updateCodMethod", async () => {
    const unauthedCtx: TenantContext = {
      tenantId,
      actor: { type: "customer", customerId: "0199a000-0000-7000-8000-000000009999" },
      roles: [],
      permissions: [],
      storeStatus: "live",
      requestId: "test-req-unauth",
    };
    await expect(
      updateCodMethod(rt, unauthedCtx, { enabled: true, feePaise: 0 }),
    ).rejects.toThrow();
  });
});

describe("Settings Phase 5: Plan and Billing Flow", () => {
  it("returns plan, usage counters, and invoices view for store staff", async () => {
    const view = await getPlanAndBilling(rt, staffCtx);
    expect(view.plan).toBeDefined();
    expect(view.usage).toBeDefined();
    expect(Array.isArray(view.usage)).toBe(true);
    expect(view.usage.some((u) => u.key === "products")).toBe(true);
    expect(Array.isArray(view.invoices)).toBe(true);
  });

  it("lists available plans with current plan flag", async () => {
    const plans = await listAvailablePlans(rt, staffCtx);
    expect(plans.length).toBeGreaterThan(0);
    const current = plans.find((p) => p.isCurrent);
    expect(current).toBeDefined();
  });

  it("allows ONLY the store owner to submit a plan change request", async () => {
    const plans = await listAvailablePlans(rt, staffCtx);
    const target = plans.find((p) => !p.isCurrent) ?? plans[0]!;

    // Non-owner staff should be rejected
    await expect(
      requestPlanChange(rt, staffCtx, {
        toPlanId: target.id,
        interval: "monthly",
        note: "Staff request",
      }),
    ).rejects.toThrow(/Only the store owner can request a plan change/);

    // Owner succeeds
    const req = await requestPlanChange(rt, ownerCtx, {
      toPlanId: target.id,
      interval: "monthly",
      note: "Need more capacity",
    });
    expect(req.status).toBe("open");
    expect(req.id).toBeDefined();

    // Re-requesting while open request exists is rejected (single open invariant)
    await expect(
      requestPlanChange(rt, ownerCtx, {
        toPlanId: target.id,
        interval: "monthly",
      }),
    ).rejects.toThrow(/already have an open plan change request/);

    // Open request visible in getPlanAndBilling
    const view = await getPlanAndBilling(rt, ownerCtx);
    expect(view.openPlanChangeRequest).not.toBeNull();
    expect(view.openPlanChangeRequest?.id).toBe(req.id);

    // Owner cancels request
    const cancelRes = await cancelPlanChangeRequest(rt, ownerCtx, { id: req.id });
    expect(cancelRes.ok).toBe(true);

    const viewAfterCancel = await getPlanAndBilling(rt, ownerCtx);
    expect(viewAfterCancel.openPlanChangeRequest).toBeNull();
  });

  it("platform staff can list and decide (approve/decline) requests with audit log", async () => {
    const plans = await listAvailablePlans(rt, staffCtx);
    const target = plans.find((p) => !p.isCurrent) ?? plans[0]!;

    const req = await requestPlanChange(rt, ownerCtx, {
      toPlanId: target.id,
      interval: "yearly",
      note: "Platform decision test",
    });

    const requests = await listPlatformPlanChangeRequests(rtPlatform, platformStaffId, "open");
    const found = requests.find((r) => r.id === req.id);
    expect(found).toBeDefined();
    expect(found?.tenantId).toBe(tenantId);
    expect(found?.toPlanId).toBe(target.id);

    // Decide request
    const decision = await decidePlatformPlanChangeRequest(rtPlatform, platformStaffId, {
      id: req.id,
      decision: "approved",
      note: "Approved by platform admin",
    });
    expect(decision.status).toBe("approved");

    // Verify audited in platform_audit_logs
    const auditRows = await platformDb.db
      .select()
      .from(schema.platformAuditLogs)
      .where(eq(schema.platformAuditLogs.targetId, req.id));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows[0]?.action).toBe("plan_change_request.approved");
  });
});
