import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "@orpc/server";
import { platformContract } from "@bs/contracts";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createLogger, createRuntime, provisionTenant, startSupportSession, type Runtime } from "@bs/domain";
import { platformRouter, type PlatformContext } from "../src/app.ts";

let env: TestDb;
let rt: Runtime;
let context: PlatformContext;
let tenantId: string;

/**
 * Every read (GET) procedure of the platform API, called through the real router against a database that has data.
 * The router validates each response against its contract, so a mismatch between what the code returns and what the
 * Super Admin expects fails here instead of as an HTTP 500 in the browser.
 */
const INPUTS: Record<string, () => unknown> = {
  "system.health": () => undefined,
  "system.data": () => undefined,
  "overview.get": () => undefined,
  "tenants.list": () => ({}),
  "tenants.get": () => ({ id: tenantId }),
  "tenants.getDetail": () => ({ id: tenantId }),
  "domains.list": () => ({}),
  "plans.list": () => undefined,
  "plans.invoices": () => ({}),
  "signups.list": () => ({}),
  "templates.list": () => undefined,
  "support.list": () => ({}),
  "quotas.list": () => undefined,
  "features.list": () => undefined,
  "staff.list": () => undefined,
  "audit.list": () => ({}),
  "audit.exportCsv": () => ({}),
};

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const staff = await seedPlatformStaff(rt._db.db, { email: "owner@platform.test", role: "platform_owner" });
  context = { rt, log: createLogger("read-endpoints-test"), session: { user: { id: staff.userId }, type: "platform_staff", createdAt: staff.freshSessionAt }, meta: {} };
  const r = await provisionTenant(rt, { storeName: "Read Test", slug: "read-test", owner: { email: "owner@read-test.test", name: "Owner" }, planCode: "growth", source: "platform_admin", actorUserId: staff.userId });
  tenantId = r.tenantId;
  await startSupportSession(rt, staff.userId, { tenantId, reason: "read endpoint check", ticketRef: "R-1", consent: "emergency" });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

function readProcedures(): string[] {
  const out: string[] = [];
  for (const [ns, procs] of Object.entries(platformContract as unknown as Record<string, Record<string, { "~orpc": { route: { method?: string } } }>>)) {
    for (const [name, def] of Object.entries(procs)) {
      if ((def["~orpc"].route.method ?? "POST") === "GET") out.push(`${ns}.${name}`);
    }
  }
  return out.sort();
}

describe("platform read endpoints return what their contracts promise", () => {
  it("has a case for every GET procedure in the contract", () => {
    expect(Object.keys(INPUTS).sort()).toEqual(readProcedures());
  });

  for (const path of Object.keys(INPUTS)) {
    it(`${path} returns a valid response`, async () => {
      const [ns, name] = path.split(".") as [string, string];
      const proc = (platformRouter as unknown as Record<string, Record<string, never>>)[ns]![name]!;
      await expect(call(proc, INPUTS[path]!() as never, { context } as never)).resolves.toBeDefined();
    });
  }

  it("the tenant detail shows the real store: owner, subscription, tier, members, audit trail and no open deletion", async () => {
    const detail = (await call(platformRouter.tenants.getDetail, { id: tenantId } as never, { context } as never)) as {
      overview: { slug: string; tier: string; owner: { email: string } | null };
      billing: { subscription: { status: string } | null };
      audit: Array<{ action: string }>;
      deletion: unknown;
    };
    expect(detail.overview).toMatchObject({ slug: "read-test", tier: "M", owner: { email: "owner@read-test.test" } });
    expect(detail.billing.subscription?.status).toBe("trialing");
    expect(detail.audit.map((a) => a.action)).toEqual(expect.arrayContaining(["tenant.provisioned", "support_session.emergency_start"]));
    expect(detail.deletion).toBeNull();
  });
});
