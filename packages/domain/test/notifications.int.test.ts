import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createDb, withTenant, schema, type DbHandle } from "@bs/db";
import {
  createRuntime,
  dispatchNotification,
  getNotificationMatrix,
  getStoreNotificationRules,
  isEmailEventEnabled,
  listPlatformInbox,
  listStoreInbox,
  markStoreInbox,
  pruneNotifications,
  updateNotificationRule,
  updateStoreNotificationRule,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

/**
 * Notification manager against a real database (docs/NOTIFICATION-MANAGER-PLAN.md, ADR-039): rules, recipients, the
 * in-app inbox, tenant isolation, the narrow platform-staff function and retention.
 */

let env: TestDb;
let rtApp: Runtime;
let rtPlatform: Runtime;
let rwDb: DbHandle;
let platformDb: DbHandle;

const run = randomUUID().slice(0, 8); // a shared test database keeps rows between runs
const orgId = randomUUID();
const tenantA = randomUUID();
const tenantB = randomUUID();
const ownerA = randomUUID();
const ownerB = randomUUID();
let staffOwner = "";
let staffSupport = "";

const ctxFor = (tenantId: string, userId: string): TenantContext => ({
  tenantId,
  actor: { type: "staff", userId },
  roles: ["store_owner"],
  permissions: ["settings.read", "notifications.manage"],
} as unknown as TenantContext);

async function sql(text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: env.superUrl });
  await c.connect();
  try {
    return await c.query(text, params);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  env = await startTestDb();
  rwDb = createDb(env.as("app_rw"), { max: 5 });
  platformDb = createDb(env.as("app_platform"), { max: 5 });
  rtApp = createRuntime({ service: "worker", databaseUrl: env.as("app_rw"), poolMax: 5 });
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });

  // A shared test database may hold mail settings from other suites; this suite checks routing, not delivery.
  await sql(`UPDATE platform_email_settings SET enabled = false`);
  await sql(`INSERT INTO organizations (id, name) VALUES ($1, 'Notify Org')`, [orgId]);
  for (const [id, slug] of [[tenantA, `notify-a-${run}`], [tenantB, `notify-b-${run}`]] as const) {
    await sql(`INSERT INTO tenants (id, organization_id, slug, name) VALUES ($1, $2, $3, $4)`, [id, orgId, slug, `Store ${slug}`]);
  }
  for (const [id, email] of [[ownerA, `owner-a-${run}@notify.test`], [ownerB, `owner-b-${run}@notify.test`]] as const) {
    await sql(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, true)`, [id, email, email]);
  }
  const su = createDb(env.superUrl, { max: 2 });
  staffOwner = (await seedPlatformStaff(su.db, { email: `staff-owner-${run}@notify.test`, role: "platform_owner" })).userId;
  staffSupport = (await seedPlatformStaff(su.db, { email: `staff-support-${run}@notify.test`, role: "platform_support" })).userId;
  await su.close?.();
  for (const [tenant, user] of [[tenantA, ownerA], [tenantB, ownerB]] as const) {
    const roleId = randomUUID();
    await sql(`SELECT set_config('app.tenant_id', $1, false)`, [tenant]);
    // Super user bypasses RLS, so the rows can be written directly.
    await sql(`INSERT INTO roles (id, tenant_id, name, is_system, permissions) VALUES ($1, $2, 'store_owner', true, '{}')`, [roleId, tenant]);
    await sql(`INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'active')`, [tenant, user, roleId]);
  }
}, 180_000);

afterAll(async () => {
  await rwDb?.close?.();
  await platformDb?.close?.();
  await env?.stop();
});

describe("store events: dispatcher", () => {
  it("adds an in-app card for the store's owner, once, however often the job is retried", async () => {
    const input = { eventKey: "store_new_order", tenantId: tenantA, eventRef: "order_1", title: "New order ORD-1", body: "Asha placed an order", link: "/orders/1" };
    const first = await dispatchNotification(rwDb.db, input);
    const again = await dispatchNotification(rwDb.db, input);
    expect(first.inApp).toBe(1);
    expect(again.inApp).toBe(0);
    const inbox = await listStoreInbox(rtApp, ctxFor(tenantA, ownerA));
    expect(inbox.items.filter((i) => i.title === "New order ORD-1")).toHaveLength(1);
    expect(inbox.unread.orders).toBeGreaterThanOrEqual(1);
  });

  it("never shows one store's notifications to another store", async () => {
    await dispatchNotification(rwDb.db, { eventKey: "store_new_order", tenantId: tenantA, eventRef: "order_secret", title: "Secret order of store A" });
    const b = await listStoreInbox(rtApp, ctxFor(tenantB, ownerB));
    expect(b.items.some((i) => i.title.includes("store A"))).toBe(false);
    // Even with the other store's user id, row level security hides the rows.
    const crossed = await withTenant(rwDb.db, tenantB, (tx) => tx.select().from(schema.notifications));
    expect(crossed.every((r) => r.tenantId === tenantB)).toBe(true);
  });

  it("marks read and clears only the caller's own cards", async () => {
    await markStoreInbox(rtApp, ctxFor(tenantA, ownerA), { all: true });
    expect((await listStoreInbox(rtApp, ctxFor(tenantA, ownerA))).unreadTotal).toBe(0);
    await markStoreInbox(rtApp, ctxFor(tenantA, ownerA), { all: true, clear: true });
    expect((await listStoreInbox(rtApp, ctxFor(tenantA, ownerA))).items).toHaveLength(0);
  });

  it("honours the store's own switch, but never for a locked event", async () => {
    await updateStoreNotificationRule(rtApp, ctxFor(tenantB, ownerB), { eventKey: "store_new_order", channel: "in_app", enabled: false });
    const off = await dispatchNotification(rwDb.db, { eventKey: "store_new_order", tenantId: tenantB, eventRef: "order_off", title: "Should not appear" });
    expect(off.inApp).toBe(0);
    await expect(updateStoreNotificationRule(rtApp, ctxFor(tenantB, ownerB), { eventKey: "billing_failed", channel: "in_app", enabled: false })).rejects.toThrow(/required/i);
    const locked = await dispatchNotification(rwDb.db, { eventKey: "billing_failed", tenantId: tenantB, eventRef: "bill_1", title: "Payment failed" });
    expect(locked.inApp).toBe(1);
  });

  it("validates the extra recipient list (valid addresses, at most five) and refuses it for customer emails", async () => {
    await expect(updateStoreNotificationRule(rtApp, ctxFor(tenantA, ownerA), { eventKey: "store_new_order", channel: "email", extraEmails: ["not-an-email"] })).rejects.toThrow(/valid email/i);
    await expect(updateStoreNotificationRule(rtApp, ctxFor(tenantA, ownerA), { eventKey: "store_new_order", channel: "email", extraEmails: Array.from({ length: 6 }, (_, i) => `a${i}@x.test`) })).rejects.toThrow(/At most 5/);
    await expect(updateStoreNotificationRule(rtApp, ctxFor(tenantA, ownerA), { eventKey: "order_confirmation", channel: "email", extraEmails: ["a@x.test"] })).rejects.toThrow(/customer emails/i);
    await updateStoreNotificationRule(rtApp, ctxFor(tenantA, ownerA), { eventKey: "store_new_order", channel: "email", extraEmails: ["Warehouse@Notify.test"] });
    const rules = await getStoreNotificationRules(rtApp, ctxFor(tenantA, ownerA));
    expect(rules.events.find((e) => e.key === "store_new_order")?.extraEmails).toEqual(["warehouse@notify.test"]);
  });

  it("requires notifications.manage to change a rule", async () => {
    const readOnly = { ...ctxFor(tenantA, ownerA), permissions: ["settings.read"] } as unknown as TenantContext;
    await expect(updateStoreNotificationRule(rtApp, readOnly, { eventKey: "store_new_order", channel: "in_app", enabled: false })).rejects.toThrow();
  });
});

describe("customer emails: the sender consults the rules", () => {
  it("is enabled by default, off when Super Admin turns the event off, and a locked security email cannot be turned off", async () => {
    const check = () => withTenant(rwDb.db, tenantA, (tx) => isEmailEventEnabled(tx, tenantA, "order_shipped"));
    expect(await check()).toBe(true);
    await updateNotificationRule(rtPlatform, staffOwner, { eventKey: "order_shipped", channel: "email", enabled: false });
    expect(await check()).toBe(false);
    await updateNotificationRule(rtPlatform, staffOwner, { eventKey: "order_shipped", channel: "email", enabled: true });
    expect(await check()).toBe(true);
    await expect(updateNotificationRule(rtPlatform, staffOwner, { eventKey: "customer_password_reset", channel: "email", enabled: false })).rejects.toThrow(/cannot be switched off/i);
    expect(await withTenant(rwDb.db, tenantA, (tx) => isEmailEventEnabled(tx, tenantA, "an_unknown_template"))).toBe(true);
  });

  it("only a platform admin or owner may change rules", async () => {
    await expect(updateNotificationRule(rtPlatform, staffSupport, { eventKey: "order_shipped", channel: "email", enabled: false })).rejects.toThrow(/platform_admin/);
  });
});

describe("platform events: Super Admin recipients", () => {
  it("reaches the staff holding the configured roles through the narrow function, and nobody else", async () => {
    await updateNotificationRule(rtPlatform, staffOwner, { eventKey: "platform_store_signup", channel: "in_app", roleRecipients: ["platform_owner"] });
    const res = await dispatchNotification(rwDb.db, { eventKey: "platform_store_signup", tenantId: tenantA, eventRef: "signup_1", title: "New store: Notify A" });
    expect(res.inApp).toBeGreaterThanOrEqual(1); // every active platform owner, including ones other runs left behind
    expect((await listPlatformInbox(rtPlatform, staffOwner)).items.some((i) => i.title === "New store: Notify A")).toBe(true);
    expect((await listPlatformInbox(rtPlatform, staffSupport)).items.some((i) => i.title === "New store: Notify A")).toBe(false);
  });

  it("the tenant runtime cannot change Super Admin rules or branding, and cannot read cards", async () => {
    await expect(sqlAs("app_rw", "update notification_rules set enabled = false")).rejects.toThrow(/permission denied/i);
    await expect(sqlAs("app_rw", "insert into platform_email_branding (id) values ('x')")).rejects.toThrow(/permission denied/i);
    await expect(sqlAs("app_rw", "select title from platform_notifications")).rejects.toThrow(/permission denied/i);
  });

  it("the tenant runtime still cannot read the staff table directly", async () => {
    await expect(sqlAs("app_rw", "select * from platform_staff")).rejects.toThrow(/permission denied/i);
  });

  it("the matrix lists every event with its channels and the retention window", async () => {
    const m = await getNotificationMatrix(rtPlatform, staffSupport);
    const signup = m.events.find((e) => e.key === "platform_store_signup");
    expect(signup?.channels.in_app.enabled).toBe(true);
    expect(signup?.channels.sms.offered).toBe(false);
    expect(m.events.find((e) => e.key === "order_confirmation")?.channels.sms.connected).toBe(false);
    expect(m.retentionDays).toBe(30);
  });
});

describe("retention", () => {
  it("removes in-app cards older than the window and keeps recent ones", async () => {
    await dispatchNotification(rwDb.db, { eventKey: "store_new_order", tenantId: tenantA, eventRef: "order_old", title: "Old card" });
    await dispatchNotification(rwDb.db, { eventKey: "store_new_order", tenantId: tenantA, eventRef: "order_new", title: "Fresh card" });
    await sql(`UPDATE notifications SET created_at = now() - interval '45 days' WHERE title = 'Old card'`);
    const res = await pruneNotifications(rwDb.db, 30);
    expect(res.deletedCount).toBeGreaterThanOrEqual(1);
    const titles = (await listStoreInbox(rtApp, ctxFor(tenantA, ownerA))).items.map((i) => i.title);
    expect(titles).toContain("Fresh card");
    expect(titles).not.toContain("Old card");
  });
});

async function sqlAs(role: "app_rw", text: string) {
  const c = new pg.Client({ connectionString: env.as(role) });
  await c.connect();
  try {
    return await c.query(text);
  } finally {
    await c.end();
  }
}
