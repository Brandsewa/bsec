import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createLogger, createRuntime, type Runtime } from "@bs/domain";
import { platformRouter, type PlatformContext } from "../src/app.ts";

let env: TestDb;
let rt: Runtime;
let context: PlatformContext;
let seq = 0;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const staff = await seedPlatformStaff(rt._db.db, { email: "admin@platform.test", role: "platform_admin" });
  context = { rt, log: createLogger("create-store-test"), session: { user: { id: staff.userId }, type: "platform_staff", createdAt: staff.freshSessionAt }, meta: {} };
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

const create = (input: Record<string, unknown>) =>
  call(platformRouter.tenants.create, { storeName: "Client Store", clientEmail: `client${++seq}@client.test`, planCode: "growth", themeTemplate: "starter-minimal", ...input } as never, { context } as never) as Promise<{
    tenantId: string;
    inviteToken: string;
    inviteUrl: string;
    customDomain?: { hostname: string; status: string; error: string | null };
  }>;

const subscriptionOf = async (tenantId: string) => (await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)))[0]!;

describe("Create store on behalf of a client (Super Admin)", () => {
  it("state 'trial' starts a 14-day trial that can lapse", async () => {
    const r = await create({ slug: "cs-trial", state: "trial" });
    const sub = await subscriptionOf(r.tenantId);
    expect(sub.status).toBe("trialing");
    expect(sub.currentPeriodEnd).not.toBeNull();
    expect(sub.currentPeriodEnd!.getTime() - Date.now()).toBeGreaterThan(13 * 24 * 3600_000);
  });

  it("state 'comped' and 'active' create a subscription with no automatic expiry, marked by how it is billed", async () => {
    const comped = await subscriptionOf((await create({ slug: "cs-comped", state: "comped" })).tenantId);
    expect(comped).toMatchObject({ status: "active", provider: "comped", currentPeriodEnd: null });
    const active = await subscriptionOf((await create({ slug: "cs-active", state: "active" })).tenantId);
    expect(active).toMatchObject({ status: "active", provider: "manual", currentPeriodEnd: null });
  });

  it("gives the client a single-use invite and records the staff member as the actor of the whole creation", async () => {
    const r = await create({ slug: "cs-invite", clientName: "Client" });
    expect(r.inviteUrl).toContain(`/accept-invite?token=${r.inviteToken}`);
    const audit = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.tenantId, r.tenantId));
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["tenant.provisioned", "tenant.invite_created"]));
    expect(audit.every((a) => a.actorUserId === context.session!.user.id)).toBe(true);
  });

  it("requests the custom domain honestly: 'requested / not configured' without Cloudflare, and an error (not a fake success) for a reserved host", async () => {
    const ok = await create({ slug: "cs-domain", customDomain: "shop.clientbrand.in" });
    expect(ok.customDomain).toMatchObject({ hostname: "shop.clientbrand.in", error: null });
    const [row] = await rt._db.db.select().from(schema.domains).where(eq(schema.domains.hostname, "shop.clientbrand.in"));
    expect(row).toMatchObject({ type: "custom", tenantId: ok.tenantId });
    expect(row!.status).not.toBe("active"); // never active without a real DNS/SSL check

    const bad = await create({ slug: "cs-baddomain", customDomain: "bcom.si" });
    expect(bad.customDomain).toMatchObject({ hostname: "bcom.si", status: "not_added" });
    expect(bad.customDomain!.error).toMatch(/cannot be added as custom domains/);
    // the store itself was still created
    const [t] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, bad.tenantId));
    expect(t!.slug).toBe("cs-baddomain");
  });

  it("refuses a duplicate subdomain and creates nothing", async () => {
    await create({ slug: "cs-dup" });
    await expect(create({ slug: "cs-dup" })).rejects.toThrow();
    const rows = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.slug, "cs-dup"));
    expect(rows).toHaveLength(1);
  });
});
