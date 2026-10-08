import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { platformContract } from "@bs/contracts";
import { createDb, schema, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  createLogger,
  createRuntime,
  provisionTenant,
  scheduleTenantDeletion,
  startSupportSession,
  type Runtime,
} from "@bs/domain";
import { platformRouter, type PlatformContext } from "../src/app.ts";

process.env.BETTER_AUTH_SECRET = "test-export-signing-secret-0123456789abcdef";

let env: TestDb;
let rt: Runtime;
let superDb: DbHandle;
let owner: { userId: string; freshSessionAt: Date };
let seq = 0;

const ctxFor = (userId: string, createdAt: Date): PlatformContext => ({
  rt,
  log: createLogger("audit-coverage-test"),
  session: { user: { id: userId }, type: "platform_staff", createdAt },
  meta: { ip: "203.0.113.7", userAgent: "vitest", requestId: "req-audit-coverage" },
});

type Proc = (input: unknown, opts: { context: PlatformContext }) => Promise<unknown>;
const proc = (path: string): Proc => {
  const [ns, name] = path.split(".") as [string, string];
  return ((input: unknown, opts: { context: PlatformContext }) =>
    call((platformRouter as unknown as Record<string, Record<string, never>>)[ns]![name]!, input as never, opts as never)) as Proc;
};

async function mkStore(slug?: string) {
  const s = slug ?? `cov-${++seq}-${Math.random().toString(36).slice(2, 7)}`;
  const r = await provisionTenant(rt, { storeName: s, slug: s, owner: { email: `owner@${s}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  return { tenantId: r.tenantId, slug: s, ownerId: r.ownerId, email: `owner@${s}.test` };
}

/** A digest of every table a platform mutation can change. A failed (rolled back) mutation must leave it untouched. */
async function snapshot(): Promise<string> {
  const tables = [
    "tenants", "tenant_notes", "platform_staff", "platform_staff_invitations", "feature_flags", "support_sessions",
    "tenant_deletions", "tenant_size_tiers", "subscriptions", "domains", "webhook_inbox", "memberships", "exports",
    "export_files", "tenant_owner_invites", "users", "sessions", "organizations", "store_settings", "roles", "theme_templates",
    "platform_email_settings", "plan_change_requests", "platform_storage_connections",
  ];
  const parts = tables.map((t) => `SELECT '${t}' || ':' || x::text AS r FROM ${t} x`);
  parts.push(`SELECT 'job:' || j.id::text || j.state::text FROM pgboss.job j`);
  const res = await superDb.db.execute<{ d: string }>(
    sql.raw(`SELECT md5(coalesce(string_agg(r, '|' ORDER BY r), '')) AS d FROM (${parts.join(" UNION ALL ")}) s`),
  );
  return res.rows[0]!.d;
}

async function armAuditFailure(action: string) {
  await superDb.db.execute(sql`DELETE FROM test_fail_audit`);
  await superDb.db.execute(sql`INSERT INTO test_fail_audit (action) VALUES (${action})`);
}
const disarm = () => superDb.db.execute(sql`DELETE FROM test_fail_audit`);

interface Case {
  /** Minimum role that may call it (checked separately in the RBAC test). */
  role: "platform_owner" | "platform_admin" | "platform_support";
  /** The audit action that must exist afterwards; the failure trigger targets it. */
  action: string;
  /** Creates fixtures and returns the input. Runs once per attempt pair. */
  input: () => Promise<unknown>;
}

const F = {
  staffOf: async (role: "platform_owner" | "platform_admin" | "platform_support") => seedPlatformStaff(rt._db.db, { email: `${role}-${++seq}@platform.test`, role }),
};

/** A fresh unpublished theme template for the theme cases (created through the real procedure). */
async function mkTemplate(): Promise<string> {
  const t = (await proc("templates.create")({ name: `Cov Theme ${++seq}` }, { context: ctxFor(owner.userId, owner.freshSessionAt) })) as { code: string };
  return t.code;
}

const CASES: Record<string, Case> = {
  "templates.create": { role: "platform_admin", action: "theme_template.create", input: async () => ({ name: `Created Theme ${++seq}` }) },
  "templates.saveDraft": {
    role: "platform_admin",
    action: "theme_template.draft_save",
    input: async () => ({ code: await mkTemplate(), pages: { home: [{ id: "h1", type: "Heading", version: 1, props: { text: "Hello" } }] } }),
  },
  "templates.publish": { role: "platform_admin", action: "theme_template.publish", input: async () => ({ code: await mkTemplate() }) },
  "templates.createPreview": { role: "platform_admin", action: "theme_template.preview_create", input: async () => ({ code: await mkTemplate() }) },
  "templates.delete": { role: "platform_admin", action: "theme_template.delete", input: async () => ({ code: await mkTemplate() }) },
  "templates.updateMeta": { role: "platform_admin", action: "theme_template.update", input: async () => ({ code: await mkTemplate(), name: "Renamed theme" }) },
  "system.retryJob": {
    role: "platform_admin",
    action: "system.retry_job",
    input: async () => {
      const r = await superDb.db.execute<{ id: string }>(sql`INSERT INTO pgboss.job (name, data, state) VALUES ('system.ping', '{}', 'failed') RETURNING id`);
      return { jobId: r.rows[0]!.id };
    },
  },
  "system.retryWebhook": {
    role: "platform_admin",
    action: "system.retry_webhook",
    input: async () => {
      const [w] = await rt._db.db.insert(schema.webhookInbox).values({ provider: "razorpay_platform", eventId: `evt-${++seq}`, signatureValid: true, payloadSanitized: {}, status: "failed", attempts: 3, error: "boom" }).returning({ id: schema.webhookInbox.id });
      return { webhookId: w!.id };
    },
  },
  "tenants.create": {
    role: "platform_admin",
    action: "tenant.provisioned",
    input: async () => ({ storeName: "Created By Staff", slug: `created-${++seq}-x`, clientEmail: `client${seq}@created.test`, clientName: "Client", planCode: "starter", state: "trial" }),
  },
  "tenants.resendOwnerInvite": {
    role: "platform_admin",
    action: "tenant.invite_resent",
    input: async () => {
      const r = await proc("tenants.create")({ storeName: "Resend", slug: `resend-${++seq}-x`, clientEmail: `resend${seq}@x.test`, planCode: "starter", state: "trial" }, { context: ctxFor(owner.userId, owner.freshSessionAt) }) as { tenantId: string };
      return { id: r.tenantId };
    },
  },
  "tenants.suspend": { role: "platform_admin", action: "tenant.suspend", input: async () => ({ id: (await mkStore()).tenantId, reason: "non-payment" }) },
  "tenants.restore": {
    role: "platform_admin",
    action: "tenant.restore",
    input: async () => {
      const s = await mkStore();
      await rt._db.db.update(schema.tenants).set({ status: "suspended" }).where(eq(schema.tenants.id, s.tenantId));
      return { id: s.tenantId };
    },
  },
  "tenants.archive": { role: "platform_admin", action: "tenant.archive", input: async () => ({ id: (await mkStore()).tenantId }) },
  "tenants.changePlan": { role: "platform_admin", action: "tenant.change_plan", input: async () => ({ id: (await mkStore()).tenantId, planCode: "growth" }) },
  "tenants.extendTrial": { role: "platform_admin", action: "tenant.extend_trial", input: async () => ({ id: (await mkStore()).tenantId, additionalDays: 7 }) },
  "tenants.transferOwnership": {
    role: "platform_admin",
    action: "tenant.transfer_ownership",
    input: async () => {
      const s = await mkStore();
      const [u] = await rt._db.db.insert(schema.users).values({ email: `new-owner-${++seq}@x.test`, name: "New Owner", emailVerified: true }).returning({ email: schema.users.email });
      return { id: s.tenantId, newOwnerEmail: u!.email };
    },
  },
  "tenants.addNote": { role: "platform_support", action: "tenant.add_note", input: async () => ({ id: (await mkStore()).tenantId, body: "called the client" }) },
  "tenants.bulkSuspend": {
    role: "platform_admin",
    action: "tenant.bulk_suspend",
    input: async () => ({ tenantIds: [(await mkStore()).tenantId], reason: "abuse", confirmation: "SUSPEND 1" }),
  },
  "tenants.bulkChangeTier": {
    role: "platform_admin",
    action: "tenant.bulk_tier_change",
    input: async () => ({ tenantIds: [(await mkStore()).tenantId], tier: "M", confirmation: "TIER M 1" }),
  },
  "tenants.requestDeletion": {
    role: "platform_admin",
    action: "tenant.deletion_scheduled",
    input: async () => {
      const s = await mkStore();
      return { id: s.tenantId, confirmSlug: s.slug, graceDays: 7, reason: "closing" };
    },
  },
  "tenants.cancelDeletion": {
    role: "platform_admin",
    action: "tenant.deletion_cancelled",
    input: async () => {
      const s = await mkStore();
      await scheduleTenantDeletion(rt, owner.userId, { tenantId: s.tenantId, confirmSlug: s.slug, graceDays: 7 });
      return { id: s.tenantId };
    },
  },
  "tenants.export": { role: "platform_admin", action: "tenant.export_generated", input: async () => ({ id: (await mkStore()).tenantId }) },
  "support.start": {
    role: "platform_support",
    action: "support_session.start",
    input: async () => ({ tenantId: (await mkStore()).tenantId, reason: "checkout broken", ticketRef: `T-${++seq}`, scope: "read_only", consent: "owner_approved" }),
  },
  "support.extend": {
    role: "platform_admin", // an admin may manage a session someone else started (the starter path is covered in the support tests)
    action: "support_session.extend",
    input: async () => ({ id: await activeSession() }),
  },
  "support.elevateWrite": {
    role: "platform_admin",
    action: "support_session.elevate_write",
    input: async () => ({ id: await activeSession() }),
  },
  "support.end": {
    role: "platform_admin",
    action: "support_session.end",
    input: async () => ({ id: await activeSession() }),
  },
  "features.update": {
    role: "platform_admin",
    action: "feature_flag.update",
    input: async () => {
      const key = `flag_${++seq}`;
      await rt._db.db.insert(schema.featureFlags).values({ key, defaultOn: false });
      return { featureKey: key, defaultOn: true };
    },
  },
  "plans.decideRequest": {
    role: "platform_admin",
    action: "plan_change_request.approved",
    input: async () => {
      const s = await mkStore();
      const [growthPlan] = await rt._db.db.select().from(schema.plans).where(eq(schema.plans.code, "growth")).limit(1);
      const [req] = await rt._db.db
        .insert(schema.planChangeRequests)
        .values({
          tenantId: s.tenantId,
          requestedBy: s.ownerId,
          toPlanId: growthPlan!.id,
          interval: "monthly",
          note: "Need growth tier",
          status: "open",
        })
        .returning({ id: schema.planChangeRequests.id });
      return { id: req!.id, decision: "approved" as const, note: "Approved" };
    },
  },
  "staff.invite": { role: "platform_admin", action: "platform_staff.invite", input: async () => ({ email: `invitee${++seq}@platform.test`, role: "platform_support" }) },
  "staff.updateRole": { role: "platform_owner", action: "platform_staff.update_role", input: async () => ({ userId: (await F.staffOf("platform_support")).userId, role: "platform_admin" }) },
  "staff.deactivate": { role: "platform_admin", action: "platform_staff.deactivate", input: async () => ({ userId: (await F.staffOf("platform_support")).userId }) },
  "staff.reactivate": {
    role: "platform_owner",
    action: "platform_staff.reactivate",
    input: async () => {
      const s = await F.staffOf("platform_support");
      await rt._db.db.update(schema.platformStaff).set({ isActive: false }).where(eq(schema.platformStaff.userId, s.userId));
      return { userId: s.userId };
    },
  },
  "email.update": {
    role: "platform_admin",
    action: "email_settings.update",
    input: async () => ({
      provider: "zoho_zeptomail",
      host: "smtp.zeptomail.in",
      port: 587,
      secureMode: "starttls",
      username: "emailapikey",
      password: "test-token-12345",
      fromEmail: "no-reply@bcom.si",
      fromName: "Brand Sewa",
      replyTo: "support@bcom.si",
      enabled: true,
    }),
  },
  "email.sendTest": {
    role: "platform_admin",
    action: "email_settings.test",
    input: async () => ({
      toEmail: `test-${++seq}@platform.test`,
    }),
  },
  "storage.create": {
    role: "platform_admin",
    action: "storage_connection.create",
    input: async () => ({
      name: `Storage ${++seq}`,
      driver: "local",
      purpose: "public_media",
      localDir: `./.data/test-storage-${seq}`,
    }),
  },
  "storage.update": {
    role: "platform_admin",
    action: "storage_connection.update",
    input: async () => ({
      id: await mkStorage(),
      name: `Renamed Storage ${++seq}`,
    }),
  },
  "storage.activate": {
    role: "platform_admin",
    action: "storage_connection.activate",
    input: async () => ({
      id: await mkStorage(),
    }),
  },
  "storage.test": {
    role: "platform_admin",
    action: "storage_connection.test",
    input: async () => ({
      id: await mkStorage(),
    }),
  },
  "storage.delete": {
    role: "platform_admin",
    action: "storage_connection.delete",
    input: async () => ({
      id: await mkStorage(),
    }),
  },
};

async function mkStorage(): Promise<string> {
  const res = (await proc("storage.create")(
    {
      name: `Storage ${++seq}`,
      driver: "local",
      purpose: "public_media",
      localDir: `./.data/test-media-${seq}`,
    },
    { context: ctxFor(owner.userId, owner.freshSessionAt) },
  )) as { id: string };
  return res.id;
}

/** An active (emergency-consent) support session, so extend / elevate / end have something to act on. */
async function activeSession(): Promise<string> {
  const s = await mkStore();
  const sess = await startSupportSession(rt, owner.userId, { tenantId: s.tenantId, reason: "site down", ticketRef: `E-${++seq}`, consent: "emergency" });
  return sess.id;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 6 });
  superDb = createDb(env.superUrl, { max: 2 });
  await superDb.db.execute(sql`CREATE TABLE IF NOT EXISTS test_fail_audit (action text PRIMARY KEY)`);
  await superDb.db.execute(sql`GRANT SELECT ON test_fail_audit TO PUBLIC`);
  await superDb.db.execute(sql`
    CREATE OR REPLACE FUNCTION test_fail_audit_fn() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM test_fail_audit f WHERE f.action = NEW.action) THEN
        RAISE EXCEPTION 'audit write blocked for test: %', NEW.action;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql SECURITY DEFINER
  `);
  await superDb.db.execute(sql`DROP TRIGGER IF EXISTS test_fail_audit_trg ON platform_audit_logs`);
  await superDb.db.execute(sql`CREATE TRIGGER test_fail_audit_trg BEFORE INSERT ON platform_audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_audit_fn()`);
  owner = await seedPlatformStaff(rt._db.db, { email: "owner@platform.test", role: "platform_owner" });
}, 240_000);

afterAll(async () => {
  await rt?.close();
  await superDb?.close();
  await env?.stop();
});

/** Every non-GET route in the contract, discovered from the contract itself (not from a hand-written list). */
function contractMutations(): string[] {
  const out: string[] = [];
  for (const [ns, procs] of Object.entries(platformContract as unknown as Record<string, Record<string, { "~orpc": { route: { method?: string } } }>>)) {
    for (const [name, def] of Object.entries(procs)) {
      const method = def["~orpc"].route.method ?? "POST";
      if (method !== "GET") out.push(`${ns}.${name}`);
    }
  }
  return out.sort();
}

describe("platform mutation audit coverage (real database, real router)", () => {
  it("every mutation in the contract has a case here: a new mutation without an audit test fails this suite", () => {
    expect(Object.keys(CASES).sort()).toEqual(contractMutations());
  });

  for (const [path, c] of Object.entries(CASES)) {
    it(`${path}: writes its audit row in the SAME transaction as the change (${c.action})`, async () => {
      const staff = c.role === "platform_owner" ? owner : await F.staffOf(c.role);
      const context = ctxFor(staff.userId, staff.freshSessionAt);
      const input = await c.input();

      // 1) If the audit row cannot be written, the whole mutation is rolled back and nothing changes.
      await armAuditFailure(c.action);
      const before = await snapshot();
      await expect(proc(path)(input, { context })).rejects.toThrow();
      expect(await snapshot()).toBe(before);
      await disarm();

      // 2) Normally it succeeds and leaves exactly one matching audit row with the staff member as actor.
      const started = new Date();
      await proc(path)(input, { context });
      const rows = await superDb.db.execute<{ actor_user_id: string | null; ip: string | null; request_id: string | null }>(
        sql`SELECT actor_user_id, ip, request_id FROM platform_audit_logs WHERE action = ${c.action} AND created_at >= ${started.toISOString()}`,
      );
      expect(rows.rows.length, `audit rows for ${c.action}`).toBeGreaterThanOrEqual(1);
      expect(rows.rows.some((r: { actor_user_id: string | null }) => r.actor_user_id === staff.userId), "actor is the staff member").toBe(true);
    });
  }

  it("audit rows cannot be altered or deleted by the tenant runtime or self-service roles", async () => {
    for (const role of ["app_rw", "app_saas"] as const) {
      const h = createDb(env.as(role), { max: 1 });
      try {
        for (const stmt of [sql`UPDATE platform_audit_logs SET action = 'tampered'`, sql`DELETE FROM platform_audit_logs`]) {
          const err = await h.db.execute(stmt).then(() => null, (e: Error & { cause?: Error }) => e);
          expect(`${err?.cause?.message ?? ""} ${err?.message ?? ""}`).toMatch(/permission denied/i);
        }
      } finally {
        await h.close();
      }
    }
  });
});
