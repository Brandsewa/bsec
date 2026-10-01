import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  approveStoreSupportSession,
  buildTenantContext,
  confirmSupportSessionWriteAccess,
  createRuntime,
  denyStoreSupportSession,
  endSupportSession,
  extendSupportSession,
  listPlatformSupportSessions,
  listStoreSupportSessions,
  provisionTenant,
  setStandingSupportConsent,
  startSupportSession,
  SUPPORT_READ_PERMISSIONS,
  SUPPORT_WRITE_PERMISSIONS,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime; // platform service
let rtWeb: Runtime; // tenant runtime (app_rw), like apps/web
let storeA: { tenantId: string; ownerId: string };
let storeB: { tenantId: string; ownerId: string };
let owner: { userId: string };
let admin: { userId: string };
let support: { userId: string };
let support2: { userId: string };

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

const ownerCtx = (s: { tenantId: string; ownerId: string }): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions: ["settings.write"],
  requestId: "req-test",
});

/** What the store admin API does with an X-Support-Token header. */
const adminCtx = (tenantId: string, token: string, path = "/api/rpc/admin/products/list") =>
  buildTenantContext(rtWeb, {
    entryPath: "admin",
    headers: new Headers({ "x-store-id": tenantId, "x-support-token": token }),
    session: null,
    request: { method: "POST", path },
  });

async function mkStore(slug: string) {
  const r = await provisionTenant(rt, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  return { tenantId: r.tenantId, ownerId: r.ownerId };
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  owner = await seedPlatformStaff(rt._db.db, { email: "owner@platform.test", role: "platform_owner" });
  admin = await seedPlatformStaff(rt._db.db, { email: "admin@platform.test", role: "platform_admin" });
  support = await seedPlatformStaff(rt._db.db, { email: "support@platform.test", role: "platform_support" });
  support2 = await seedPlatformStaff(rt._db.db, { email: "support2@platform.test", role: "platform_support" });
  storeA = await mkStore("supp-a");
  storeB = await mkStore("supp-b");
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

const startOwnerApproved = (staff = support, tenant = storeA) =>
  startSupportSession(rt, staff.userId, { tenantId: tenant.tenantId, reason: "Checkout not working", ticketRef: "TCK-1", consent: "owner_approved" });

describe("owner-approved support sessions", () => {
  it("cannot be used until the store owner approves; then it is read-only, counted and audited on every request", async () => {
    const s = await startOwnerApproved();
    expect(s.status).toBe("pending_owner_approval");
    expect(s.scope).toBe("read_only");
    expect(s.token).toMatch(/^sup_[0-9a-f]{64}$/);

    // only a hash is stored: the raw token is nowhere in the row and never in a listing
    const [row] = await rt._db.db.select().from(schema.supportSessions).where(eq(schema.supportSessions.id, s.id));
    expect(JSON.stringify(row)).not.toContain(s.token!);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await listPlatformSupportSessions(rt))).not.toContain(s.token!);

    // not approved yet: refused by the store API
    expect(await errorOf(adminCtx(storeA.tenantId, s.token!))).toMatch(/has not approved this support session yet/);

    // the store owner sees the request and approves it
    const pending = (await listStoreSupportSessions(rtWeb, ownerCtx(storeA))).find((x) => x.id === s.id);
    expect(pending).toMatchObject({ status: "pending_owner_approval", ticketRef: "TCK-1", staffEmail: "support@platform.test" });
    await approveStoreSupportSession(rtWeb, ownerCtx(storeA), s.id);

    const ctx = await adminCtx(storeA.tenantId, s.token!, "/api/rpc/admin/orders/list");
    expect(ctx!.actor).toMatchObject({ type: "platform_support", userId: support.userId, supportSessionId: s.id });
    expect(ctx!.roles).toEqual(["support"]);
    expect([...ctx!.permissions].sort()).toEqual([...SUPPORT_READ_PERMISSIONS].sort());
    expect(ctx!.permissions).not.toContain("products.write");

    const [after] = await rt._db.db.select().from(schema.supportSessions).where(eq(schema.supportSessions.id, s.id));
    expect(after!.actionsCount).toBe(1);
    expect(after!.approvedByUserId).toBe(storeA.ownerId);
    const audit = (await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.targetId, s.id))).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["support_session.start", "support_session.approved", "support_session.request"]));
    const req = (await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.targetId, s.id))).find((a) => a.action === "support_session.request");
    expect(req!.diff).toMatchObject({ method: "POST", path: "/api/rpc/admin/orders/list", scope: "read_only" });
  });

  it("write access needs a second confirmation by a platform admin, and never includes team, settings, refunds or exports", async () => {
    const s = await startOwnerApproved();
    await approveStoreSupportSession(rtWeb, ownerCtx(storeA), s.id);
    expect(await errorOf(confirmSupportSessionWriteAccess(rt, support.userId, s.id))).toMatch(/platform_admin/);
    // asking for "write" at start does not skip the confirmation
    const asked = await startSupportSession(rt, support.userId, { tenantId: storeA.tenantId, reason: "x y z", ticketRef: "T2", consent: "owner_approved", scope: "write" });
    expect(asked.scope).toBe("read_only");
    expect(asked.writeConfirmedAt).toBeNull();

    const elevated = await confirmSupportSessionWriteAccess(rt, admin.userId, s.id);
    expect(elevated).toMatchObject({ scope: "write" });
    const ctx = await adminCtx(storeA.tenantId, s.token!);
    expect([...ctx!.permissions].sort()).toEqual([...SUPPORT_WRITE_PERMISSIONS].sort());
    for (const denied of ["staff.manage", "settings.write", "exports.run", "orders.refund"]) expect(ctx!.permissions).not.toContain(denied);
    expect(ctx!.permissions).toContain("products.write");
  });

  it("a token can never reach another store", async () => {
    const s = await startOwnerApproved();
    await approveStoreSupportSession(rtWeb, ownerCtx(storeA), s.id);
    expect(await errorOf(adminCtx(storeB.tenantId, s.token!))).toMatch(/not authorized for this store/);
    // and the other store's owner cannot approve or see it
    expect(await errorOf(approveStoreSupportSession(rtWeb, ownerCtx(storeB), s.id))).toMatch(/no pending support request/);
    expect((await listStoreSupportSessions(rtWeb, ownerCtx(storeB))).map((x) => x.id)).not.toContain(s.id);
  });

  it("only the store owner (not an admin, not support) can approve, deny or change standing consent", async () => {
    const s = await startOwnerApproved();
    const adminCtxStore: TenantContext = { ...ownerCtx(storeA), roles: ["store_admin"] };
    const supportActor: TenantContext = { ...ownerCtx(storeA), actor: { type: "platform_support", userId: support.userId, supportSessionId: s.id }, roles: ["support"] };
    for (const ctx of [adminCtxStore, supportActor]) {
      expect(await errorOf(approveStoreSupportSession(rtWeb, ctx, s.id))).toMatch(/only the store owner/);
      expect(await errorOf(denyStoreSupportSession(rtWeb, ctx, s.id))).toMatch(/only the store owner/);
      expect(await errorOf(setStandingSupportConsent(rtWeb, ctx, true))).toMatch(/only the store owner/);
    }
  });

  it("a denied request is dead for good", async () => {
    const s = await startOwnerApproved();
    await denyStoreSupportSession(rtWeb, ownerCtx(storeA), s.id);
    expect((await listStoreSupportSessions(rtWeb, ownerCtx(storeA))).find((x) => x.id === s.id)!.status).toBe("denied");
    expect(await errorOf(adminCtx(storeA.tenantId, s.token!))).toMatch(/invalid or expired/);
    expect(await errorOf(approveStoreSupportSession(rtWeb, ownerCtx(storeA), s.id))).toMatch(/no pending support request/);
  });
});

describe("session lifecycle", () => {
  it("can be extended once, only by its starter or an admin, and stops working when ended or expired", async () => {
    const s = await startOwnerApproved(support);
    await approveStoreSupportSession(rtWeb, ownerCtx(storeA), s.id);

    expect(await errorOf(extendSupportSession(rt, support2.userId, s.id))).toMatch(/started this session/);
    const ext = await extendSupportSession(rt, support.userId, s.id);
    expect(ext.isExtended).toBe(true);
    expect(await errorOf(extendSupportSession(rt, support.userId, s.id))).toMatch(/only be extended once/);
    expect(await errorOf(extendSupportSession(rt, admin.userId, s.id))).toMatch(/only be extended once/);

    expect(await errorOf(endSupportSession(rt, support2.userId, s.id))).toMatch(/started this session/);
    await endSupportSession(rt, admin.userId, s.id);
    expect(await errorOf(adminCtx(storeA.tenantId, s.token!))).toMatch(/invalid or expired/);
    expect(await errorOf(endSupportSession(rt, support.userId, s.id))).toMatch(/already ended/);

    const s2 = await startOwnerApproved(support);
    await approveStoreSupportSession(rtWeb, ownerCtx(storeA), s2.id);
    await rt._db.db.update(schema.supportSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.supportSessions.id, s2.id));
    expect(await errorOf(adminCtx(storeA.tenantId, s2.token!))).toMatch(/invalid or expired/);
    expect(await errorOf(extendSupportSession(rt, support.userId, s2.id))).toMatch(/only an active support session/);
  });

  it("the 60 minutes start at approval, not at the request", async () => {
    const s = await startOwnerApproved();
    const [pending] = await rt._db.db.select().from(schema.supportSessions).where(eq(schema.supportSessions.id, s.id));
    expect(pending!.expiresAt.getTime() - Date.now()).toBeGreaterThan(2 * 3600_000); // waiting window, not 60 minutes
    await approveStoreSupportSession(rtWeb, ownerCtx(storeA), s.id);
    const [approved] = await rt._db.db.select().from(schema.supportSessions).where(eq(schema.supportSessions.id, s.id));
    const remaining = approved!.expiresAt.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(55 * 60_000);
    expect(remaining).toBeLessThanOrEqual(60 * 60_000);
  });
});

describe("standing consent and emergency access", () => {
  it("standing consent works only while the owner has it switched on", async () => {
    const start = () => startSupportSession(rt, support.userId, { tenantId: storeB.tenantId, reason: "routine check", ticketRef: "T3", consent: "standing_consent" });
    expect(await errorOf(start())).toMatch(/has not enabled standing consent/);
    await setStandingSupportConsent(rtWeb, ownerCtx(storeB), true);
    const s = await start();
    expect(s.status).toBe("active");
    expect(s.scope).toBe("read_only");
    await expect(adminCtx(storeB.tenantId, s.token!)).resolves.toMatchObject({ actor: { type: "platform_support" } });
    await setStandingSupportConsent(rtWeb, ownerCtx(storeB), false);
    expect(await errorOf(start())).toMatch(/has not enabled standing consent/);
    const audit = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.tenantId, storeB.tenantId));
    expect(audit.map((a) => a.action)).toContain("support_access.standing_consent_changed");
  });

  it("emergency access is owner-only, immediate and flagged in the audit trail", async () => {
    const attempt = (staff: { userId: string }) => startSupportSession(rt, staff.userId, { tenantId: storeA.tenantId, reason: "site is down", ticketRef: "SEV1", consent: "emergency" });
    expect(await errorOf(attempt(support))).toMatch(/platform_owner/);
    expect(await errorOf(attempt(admin))).toMatch(/platform_owner/);
    const s = await attempt(owner);
    expect(s.status).toBe("active");
    await expect(adminCtx(storeA.tenantId, s.token!)).resolves.toBeTruthy();
    const [flag] = (await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.targetId, s.id))).filter((a) => a.action === "support_session.emergency_start");
    expect(flag!.diff).toMatchObject({ isEmergency: true, ticketRef: "SEV1" });
  });

  it("a suspended store is read-only even for a write session", async () => {
    const store = await mkStore("supp-suspended");
    const s = await startSupportSession(rt, owner.userId, { tenantId: store.tenantId, reason: "billing dispute", ticketRef: "T9", consent: "emergency" });
    await confirmSupportSessionWriteAccess(rt, admin.userId, s.id);
    await rt._db.db.execute(sql`UPDATE tenants SET status = 'suspended' WHERE id = ${store.tenantId}`);
    const ctx = await adminCtx(store.tenantId, s.token!);
    expect(ctx!.permissions.every((p) => p.endsWith(".read"))).toBe(true);
    await rt._db.db.execute(sql`UPDATE tenants SET status = 'archived' WHERE id = ${store.tenantId}`);
    expect(await errorOf(adminCtx(store.tenantId, s.token!))).toMatch(/not accessible in admin/);
  });
});
