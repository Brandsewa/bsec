import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, ORPCError } from "@orpc/server";
import { platformContract } from "@bs/contracts";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createLogger, createRuntime, type Runtime } from "@bs/domain";
import { platformRouter, type PlatformContext } from "../src/app.ts";

type Role = "platform_owner" | "platform_admin" | "platform_support";

let env: TestDb;
let rt: Runtime;

const U = "0199a000-0000-7000-8000-00000000abcd";

/** The least-privileged role allowed to call each procedure. Every procedure in the contract must be listed. */
const MIN_ROLE: Record<string, Role | "public"> = {
  "system.health": "public",
  "system.data": "platform_support",
  "system.retryJob": "platform_admin",
  "system.retryWebhook": "platform_admin",
  "overview.get": "platform_support",
  "tenants.list": "platform_support",
  "tenants.get": "platform_support",
  "tenants.getDetail": "platform_support",
  "tenants.create": "platform_admin",
  "tenants.resendOwnerInvite": "platform_admin",
  "tenants.suspend": "platform_admin",
  "tenants.restore": "platform_admin",
  "tenants.archive": "platform_admin",
  "tenants.changePlan": "platform_admin",
  "tenants.extendTrial": "platform_admin",
  "tenants.transferOwnership": "platform_admin",
  "tenants.addNote": "platform_support",
  "tenants.bulkSuspend": "platform_admin",
  "tenants.bulkChangeTier": "platform_admin",
  "tenants.requestDeletion": "platform_admin",
  "tenants.cancelDeletion": "platform_admin",
  "tenants.export": "platform_admin",
  "domains.list": "platform_support",
  "plans.list": "platform_support",
  "plans.invoices": "platform_support",
  "plans.listRequests": "platform_support",
  "plans.decideRequest": "platform_admin",
  "signups.list": "platform_support",
  "templates.list": "platform_support",
  "templates.get": "platform_support",
  "templates.create": "platform_admin",
  "templates.saveDraft": "platform_admin",
  "templates.publish": "platform_admin",
  "templates.updateMeta": "platform_admin",
  "templates.createPreview": "platform_admin",
  "templates.delete": "platform_admin",
  "support.list": "platform_support",
  "support.start": "platform_support",
  "support.extend": "platform_support",
  "support.elevateWrite": "platform_admin",
  "support.end": "platform_support",
  "quotas.list": "platform_support",
  "quotas.matrix": "platform_support",
  "quotas.createTier": "platform_admin",
  "quotas.updateTier": "platform_admin",
  "quotas.deactivateTier": "platform_admin",
  "quotas.updateLimits": "platform_admin",
  "quotas.updateDefinition": "platform_admin",
  "features.list": "platform_support",
  "features.update": "platform_admin",
  "staff.list": "platform_admin",
  "staff.invite": "platform_admin",
  "staff.updateRole": "platform_owner",
  "staff.deactivate": "platform_admin",
  "staff.reactivate": "platform_owner",
  "audit.list": "platform_support",
  "audit.exportCsv": "platform_admin",
  "email.get": "platform_support",
  "email.update": "platform_admin",
  "email.sendTest": "platform_admin",
  "email.recentDeliveries": "platform_support",
  "storage.list": "platform_support",
  "storage.get": "platform_support",
  "storage.create": "platform_admin",
  "storage.update": "platform_admin",
  "storage.activate": "platform_admin",
  "storage.test": "platform_admin",
  "storage.delete": "platform_admin",
};

/** Valid-shaped inputs, so the role check (which runs first) is what decides the outcome. */
const INPUT: Record<string, unknown> = {
  "system.retryJob": { jobId: "x" },
  "system.retryWebhook": { webhookId: U },
  "tenants.get": { id: U },
  "tenants.getDetail": { id: U },
  "tenants.create": { storeName: "S", slug: "rbac-store", clientEmail: "c@x.test", planCode: "starter", state: "trial" },
  "tenants.resendOwnerInvite": { id: U },
  "tenants.suspend": { id: U, reason: "r" },
  "tenants.restore": { id: U },
  "tenants.archive": { id: U },
  "tenants.changePlan": { id: U, planCode: "growth" },
  "tenants.extendTrial": { id: U, additionalDays: 3 },
  "tenants.transferOwnership": { id: U, newOwnerEmail: "n@x.test" },
  "tenants.addNote": { id: U, body: "b" },
  "tenants.bulkSuspend": { tenantIds: [U], reason: "r", confirmation: "SUSPEND 1" },
  "tenants.bulkChangeTier": { tenantIds: [U], tier: "M", confirmation: "TIER M 1" },
  "tenants.requestDeletion": { id: U, confirmSlug: "x" },
  "tenants.cancelDeletion": { id: U },
  "tenants.export": { id: U },
  "support.start": { tenantId: U, reason: "reason", ticketRef: "T", scope: "read_only", consent: "owner_approved" },
  "support.extend": { id: U },
  "support.elevateWrite": { id: U },
  "support.end": { id: U },
  "templates.get": { code: "essential-commerce" },
  "templates.create": { name: "Rbac Theme" },
  "templates.saveDraft": { code: "essential-commerce", pages: { home: [] } },
  "templates.publish": { code: "essential-commerce" },
  "templates.updateMeta": { code: "essential-commerce", name: "Renamed" },
  "templates.createPreview": { code: "essential-commerce" },
  "templates.delete": { code: "rbac-missing-theme" },
  "features.update": { featureKey: "k", defaultOn: true },
  "plans.decideRequest": { id: U, decision: "declined" },
  "staff.invite": { email: "i@x.test", role: "platform_support" },
  "staff.updateRole": { userId: U, role: "platform_admin" },
  "staff.deactivate": { userId: U },
  "staff.reactivate": { userId: U },
  "email.update": {
    provider: "zoho_zeptomail",
    host: "smtp.zeptomail.in",
    port: 587,
    secureMode: "starttls",
    username: "emailapikey",
    fromEmail: "no-reply@bcom.si",
    fromName: "Brand Sewa",
    enabled: true,
  },
  "email.sendTest": { toEmail: "admin@platform.test" },
  "storage.list": {},
  "storage.get": { id: U },
  "storage.create": { name: "Rbac Storage", driver: "local", purpose: "public_media" },
  "storage.update": { id: U, name: "Renamed Storage" },
  "storage.activate": { id: U },
  "storage.test": { id: U },
  "storage.delete": { id: U },
  "quotas.matrix": {},
  "quotas.createTier": { code: "RBAC_TIER", name: "RBAC Tier" },
  "quotas.updateTier": { code: "XS", name: "Renamed XS" },
  "quotas.deactivateTier": { code: "NON_EXISTENT" },
  "quotas.updateLimits": { updates: [{ tierCode: "XS", quotaKey: "products", value: 50 }] },
  "quotas.updateDefinition": { key: "products", description: "Desc" },
};

const RANK: Record<Role, number> = { platform_support: 1, platform_admin: 2, platform_owner: 3 };

const ctx = (session: PlatformContext["session"]): PlatformContext => ({ rt, log: createLogger("rbac-test"), session, meta: {} });

async function codeOf(path: string, context: PlatformContext): Promise<string> {
  const [ns, name] = path.split(".") as [string, string];
  const proc = (platformRouter as unknown as Record<string, Record<string, never>>)[ns]![name]!;
  try {
    await call(proc, (INPUT[path] ?? undefined) as never, { context } as never);
    return "OK";
  } catch (err) {
    return err instanceof ORPCError ? err.code : `ERR:${(err as Error).message}`;
  }
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

function everyProcedure(): string[] {
  const out: string[] = [];
  for (const [ns, procs] of Object.entries(platformContract as unknown as Record<string, Record<string, unknown>>)) {
    for (const name of Object.keys(procs)) out.push(`${ns}.${name}`);
  }
  return out.sort();
}

describe("platform authorization", () => {
  it("every procedure in the contract has a declared minimum role", () => {
    expect(Object.keys(MIN_ROLE).sort()).toEqual(everyProcedure());
  });

  it("refuses every protected procedure without a session, with a customer session, and without a MFA-fresh session", async () => {
    const stale = await seedPlatformStaff(rt._db.db, { email: "stale@platform.test", role: "platform_owner" });
    const noMfa = await seedPlatformStaff(rt._db.db, { email: "nomfa@platform.test", role: "platform_owner", mfa: "none" });
    const unfinished = await seedPlatformStaff(rt._db.db, { email: "unfinished@platform.test", role: "platform_owner", mfa: "enrolled_not_completed" });
    const inactive = await seedPlatformStaff(rt._db.db, { email: "inactive@platform.test", role: "platform_owner", active: false });

    for (const [path, min] of Object.entries(MIN_ROLE)) {
      if (min === "public") continue;
      expect(await codeOf(path, ctx(null)), `${path} without session`).toBe("UNAUTHORIZED");
      expect(await codeOf(path, ctx({ user: { id: U }, type: "customer", createdAt: new Date() })), `${path} customer`).toBe("UNAUTHORIZED");
      expect(await codeOf(path, ctx({ user: { id: stale.userId }, type: "platform_staff", createdAt: stale.staleSessionAt })), `${path} stale session`).toBe("FORBIDDEN");
      expect(await codeOf(path, ctx({ user: { id: noMfa.userId }, type: "platform_staff", createdAt: new Date() })), `${path} no MFA`).toBe("FORBIDDEN");
      expect(await codeOf(path, ctx({ user: { id: unfinished.userId }, type: "platform_staff", createdAt: new Date() })), `${path} unfinished MFA`).toBe("FORBIDDEN");
      expect(await codeOf(path, ctx({ user: { id: inactive.userId }, type: "platform_staff", createdAt: new Date() })), `${path} inactive`).toBe("FORBIDDEN");
    }
  });

  it("enforces the minimum role on every procedure: a lower role gets FORBIDDEN before anything runs", async () => {
    const staff: Record<Role, { userId: string; freshSessionAt: Date }> = {
      platform_support: await seedPlatformStaff(rt._db.db, { email: "support@platform.test", role: "platform_support" }),
      platform_admin: await seedPlatformStaff(rt._db.db, { email: "admin@platform.test", role: "platform_admin" }),
      platform_owner: await seedPlatformStaff(rt._db.db, { email: "owner@platform.test", role: "platform_owner" }),
    };
    for (const [path, min] of Object.entries(MIN_ROLE)) {
      if (min === "public") continue;
      for (const role of Object.keys(RANK) as Role[]) {
        const code = await codeOf(path, ctx({ user: { id: staff[role].userId }, type: "platform_staff", createdAt: staff[role].freshSessionAt }));
        if (RANK[role] < RANK[min]) {
          expect(code, `${role} calling ${path} (needs ${min})`).toBe("FORBIDDEN");
        } else {
          // allowed by role: it may still fail on the fake ids/business rules, but never on authorization
          expect(["UNAUTHORIZED"], `${role} calling ${path}`).not.toContain(code);
          if (code === "FORBIDDEN") {
            // the only FORBIDDEN an authorized role may get is a business rule, never the role gate
            const [ns, name] = path.split(".") as [string, string];
            const proc = (platformRouter as unknown as Record<string, Record<string, never>>)[ns]![name]!;
            const err = await call(proc, (INPUT[path] ?? undefined) as never, { context: ctx({ user: { id: staff[role].userId }, type: "platform_staff", createdAt: staff[role].freshSessionAt }) } as never).catch((e: Error) => e);
            expect((err as Error).message, `${role} calling ${path}`).not.toMatch(/requires the .* role or higher/);
          }
        }
      }
    }
  });

  it("the health check stays public", async () => {
    expect(await codeOf("system.health", ctx(null))).toBe("OK");
  });
});
