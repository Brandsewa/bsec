import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  cancelTenantDeletion,
  createRuntime,
  executeTenantDeletionWorkflow,
  provisionTenant,
  readExportArchive,
  runDueTenantDeletions,
  runStoreExport,
  scheduleTenantDeletion,
  signExportDownloadUrl,
  verifyExportSignature,
  type Runtime,
} from "../src/index.ts";

process.env.BETTER_AUTH_SECRET = "test-export-signing-secret-0123456789abcdef";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let staffId: string;

/** Drivers wrap database errors ("Failed query"); the permission message is on `cause`. */
const denied = async (p: Promise<unknown>) => {
  const e = (await p.then(() => null, (x: Error & { cause?: Error }) => x)) as (Error & { cause?: Error }) | null;
  return `${e?.cause?.message ?? ""} ${e?.message ?? ""}`;
};
const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;
const later = () => new Date(Date.now() + 30 * 24 * 3600_000);

async function makeStore(slug: string, opts: { withData?: boolean } = {}) {
  const res = await provisionTenant(rt, {
    storeName: `Store ${slug}`,
    slug,
    owner: { email: `owner@${slug}.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  if (opts.withData) {
    await rt._db.db.execute(sql`
      INSERT INTO products (tenant_id, title, slug, status) VALUES (${res.tenantId}, 'Secret Sauce', ${`sauce-${slug}`}, 'active');
    `);
    await rt._db.db.execute(sql`
      INSERT INTO tenant_secrets (tenant_id, provider, key_name, ciphertext, iv) VALUES (${res.tenantId}, 'razorpay', 'key_secret', 'CIPHERTEXT-MUST-NOT-LEAK', 'iv');
    `);
    const [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, res.tenantId));
    await rt._db.db.insert(schema.platformInvoices).values({
      tenantId: res.tenantId,
      subscriptionId: sub!.id,
      number: `INV-TEST-${slug}`,
      amountPaise: 99900,
      taxPaise: 15237,
      status: "paid",
    });
  }
  return res;
}

const count = async (table: string, tenantId: string) =>
  Number((await rt._db.db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`)).rows[0]!.n);

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 8 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 3 });
  staffId = (await seedPlatformStaff(rt._db.db, { email: "deletion-owner@platform.test" })).userId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("store export", () => {
  it("produces a real archive with only this store's data and no credentials", async () => {
    const a = await makeStore("exp-a", { withData: true });
    const b = await makeStore("exp-b", { withData: true });

    const exp = await runStoreExport(rt, a.tenantId, staffId);
    expect(exp.totalRecords).toBeGreaterThan(5);

    const file = await readExportArchive(rt, exp.id);
    expect(file).not.toBeNull();
    expect(createHash("sha256").update(file!.data).digest("hex")).toBe(file!.sha256);
    const archive = JSON.parse(gunzipSync(file!.data).toString("utf8")) as {
      tenant: { id: string };
      data: Record<string, Array<Record<string, unknown>>>;
      counts: Record<string, number>;
    };

    expect(archive.tenant.id).toBe(a.tenantId);
    // only A's rows: every exported row carries A's tenant id; B's product is nowhere in it
    for (const [table, rows] of Object.entries(archive.data)) {
      for (const row of rows) expect(row.tenant_id ?? a.tenantId, table).toBe(a.tenantId);
    }
    const text = JSON.stringify(archive);
    expect(text).toContain("Secret Sauce");
    expect(text).not.toContain("sauce-exp-b");
    expect(text).not.toContain(b.tenantId);
    // credentials never leave: the secrets table is not exported and no credential-like column survives
    expect(archive.data.tenant_secrets).toBeUndefined();
    expect(text).not.toContain("CIPHERTEXT-MUST-NOT-LEAK");
    const badKey = /(password|secret|token|hash|otp|api_?key|access_?key|refresh|signature)/i;
    const walk = (v: unknown): string[] =>
      v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => (badKey.test(k) ? [k] : walk(x))) : [];
    expect(walk(archive.data)).toEqual([]);

    // the export and its audit row exist; the tenant runtime cannot read archives
    const audit = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.tenantId, a.tenantId));
    expect(audit.map((r) => r.action)).toContain("tenant.export_generated");
    expect(await denied(rtWeb._db.db.select().from(schema.exportFiles))).toMatch(/permission denied/i);
  });

  it("signs download links: valid, expired, tampered and wrong-export links behave", () => {
    const soon = Date.now() + 60_000;
    const url = new URL(signExportDownloadUrl("11111111-1111-1111-1111-111111111111", soon), "http://x");
    const sig = url.searchParams.get("signature")!;
    expect(verifyExportSignature("11111111-1111-1111-1111-111111111111", soon, sig)).toBe(true);
    expect(verifyExportSignature("11111111-1111-1111-1111-111111111111", soon, sig.replace(/.$/, sig.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(verifyExportSignature("22222222-2222-2222-2222-222222222222", soon, sig)).toBe(false);
    expect(verifyExportSignature("11111111-1111-1111-1111-111111111111", soon + 1, sig)).toBe(false);
    const past = Date.now() - 1000;
    expect(verifyExportSignature("11111111-1111-1111-1111-111111111111", past, new URL(signExportDownloadUrl("11111111-1111-1111-1111-111111111111", past), "http://x").searchParams.get("signature")!)).toBe(false);
    expect(verifyExportSignature("11111111-1111-1111-1111-111111111111", soon, "short")).toBe(false);
  });
});

describe("tenant deletion workflow", () => {
  it("waits out the grace period, then runs every step, purging only the target store", async () => {
    const a = await makeStore("del-a", { withData: true });
    const b = await makeStore("del-b", { withData: true });
    const bBefore = { products: await count("products", b.tenantId), pages: await count("pages", b.tenantId), roles: await count("roles", b.tenantId) };
    expect(bBefore.products).toBeGreaterThan(0);

    expect(await errorOf(scheduleTenantDeletion(rt, staffId, { tenantId: a.tenantId, confirmSlug: "wrong" }))).toMatch(/type the store's slug/);
    const dr = await scheduleTenantDeletion(rt, staffId, { tenantId: a.tenantId, confirmSlug: "del-a", graceDays: 7, reason: "client left" });
    const [t] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, a.tenantId));
    expect(t!.status).toBe("deletion_requested");
    expect(await errorOf(scheduleTenantDeletion(rt, staffId, { tenantId: a.tenantId, confirmSlug: "del-a" }))).toMatch(/already scheduled/);

    // grace period not over: neither a direct run nor the sweep touches it
    expect(await errorOf(executeTenantDeletionWorkflow(rt, dr.id))).toMatch(/grace period is not over/);
    expect((await runDueTenantDeletions(rt)).completed).toBe(0);
    expect(await count("products", a.tenantId)).toBeGreaterThan(0);

    // after the grace period the sweep runs the whole workflow; two sweeps at once take turns (advisory lock)
    const results = await Promise.all([runDueTenantDeletions(rt, { deps: { now: later() } }), runDueTenantDeletions(rt, { deps: { now: later() } })]);
    expect(results.reduce((n, r) => n + r.completed, 0)).toBe(1);

    const [done] = await rt._db.db.select().from(schema.tenantDeletions).where(eq(schema.tenantDeletions.id, dr.id));
    expect(done).toMatchObject({ step: "deleted" });
    expect(done!.completedAt).not.toBeNull();
    const [gone] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, a.tenantId));
    expect(gone!.status).toBe("deleted");

    // A's data is gone, A's invoices and audit trail and the deletion evidence (export) remain
    for (const table of ["products", "pages", "roles", "memberships", "store_settings", "tenant_secrets", "locations"]) {
      expect(await count(table, a.tenantId), table).toBe(0);
    }
    expect(await count("platform_invoices", a.tenantId)).toBe(1);
    expect(await count("exports", a.tenantId)).toBe(1);
    expect(await count("export_files", a.tenantId)).toBe(1);
    expect(done!.exportId).not.toBeNull();
    const file = await readExportArchive(rt, done!.exportId!);
    expect(JSON.stringify(JSON.parse(gunzipSync(file!.data).toString("utf8")).data.products)).toContain("Secret Sauce");

    // the other store is untouched
    expect({ products: await count("products", b.tenantId), pages: await count("pages", b.tenantId), roles: await count("roles", b.tenantId) }).toEqual(bBefore);
    const [bRow] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, b.tenantId));
    expect(bRow!.status).not.toBe("deleted");

    // every step and the final deletion are in the audit trail, once each
    const actions = (await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.tenantId, a.tenantId))).map((r) => r.action);
    for (const a of ["tenant.deletion_scheduled", "tenant.deletion_step.exported", "tenant.deletion_step.billing_stopped", "tenant.deletion_step.domains_disconnected", "tenant.deletion_step.media_scheduled", "tenant.deletion_step.db_purged", "tenant.deletion_step.verified", "tenant.deleted"]) {
      expect(actions.filter((x) => x === a), a).toHaveLength(1);
    }
    // a finished deletion cannot be cancelled or re-run
    expect(await errorOf(cancelTenantDeletion(rt, staffId, a.tenantId))).toMatch(/no open deletion/);
  });

  it("survives a crash mid-workflow: the failed step is retried, nothing is duplicated, the export is kept", async () => {
    const c = await makeStore("del-crash", { withData: true });
    await rt._db.db.update(schema.subscriptions).set({ providerSubscriptionId: "sub_crash_1" }).where(eq(schema.subscriptions.tenantId, c.tenantId));
    const dr = await scheduleTenantDeletion(rt, staffId, { tenantId: c.tenantId, confirmSlug: "del-crash", graceDays: 0 });

    const cancelSubscription = vi.fn().mockRejectedValueOnce(new Error("provider unreachable")).mockResolvedValue({ status: "cancelled" });
    const billing = { isConfigured: () => true, cancelSubscription } as never;

    expect(await errorOf(executeTenantDeletionWorkflow(rt, dr.id, { billing, now: later() }))).toMatch(/provider unreachable/);
    const [mid] = await rt._db.db.select().from(schema.tenantDeletions).where(eq(schema.tenantDeletions.id, dr.id));
    expect(mid).toMatchObject({ step: "exported" });
    expect(mid!.error).toMatch(/provider unreachable/);
    expect(await count("products", c.tenantId)).toBeGreaterThan(0); // nothing was purged yet
    expect(await count("exports", c.tenantId)).toBe(1);

    const finished = await executeTenantDeletionWorkflow(rt, dr.id, { billing, now: later() });
    expect(finished.step).toBe("deleted");
    expect(cancelSubscription).toHaveBeenCalledTimes(2);
    expect(await count("products", c.tenantId)).toBe(0);
    expect(await count("exports", c.tenantId)).toBe(1); // resumed, did not export again
    const steps = (await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.tenantId, c.tenantId))).filter((r) => r.action.startsWith("tenant.deletion_step."));
    expect(new Set(steps.map((r) => r.action)).size).toBe(steps.length);
  });

  it("a failed export blocks the deletion: nothing is deleted without an archive", async () => {
    const e = await makeStore("del-noexport", { withData: true });
    const dr = await scheduleTenantDeletion(rt, staffId, { tenantId: e.tenantId, confirmSlug: "del-noexport", graceDays: 0 });
    const runExport = vi.fn().mockRejectedValue(new Error("archive storage unavailable"));
    expect(await errorOf(executeTenantDeletionWorkflow(rt, dr.id, { runExport, now: later() }))).toMatch(/archive storage unavailable/);
    expect(await count("products", e.tenantId)).toBeGreaterThan(0);
    const [row] = await rt._db.db.select().from(schema.tenantDeletions).where(eq(schema.tenantDeletions.id, dr.id));
    expect(row).toMatchObject({ step: "requested" });
    expect(row!.error).toMatch(/archive storage unavailable/);
  });

  it("cancel restores the exact previous status during the grace period and is refused once the workflow started", async () => {
    const s = await makeStore("del-cancel", { withData: true });
    await rt._db.db.update(schema.tenants).set({ status: "suspended", suspendedReason: "unpaid" }).where(eq(schema.tenants.id, s.tenantId));
    const dr = await scheduleTenantDeletion(rt, staffId, { tenantId: s.tenantId, confirmSlug: "del-cancel", graceDays: 7 });
    await cancelTenantDeletion(rt, staffId, s.tenantId);
    const [t] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId));
    expect(t!.status).toBe("suspended"); // not silently "active"
    expect(await errorOf(executeTenantDeletionWorkflow(rt, dr.id, { now: later() }))).toMatch(/cancelled/);
    await runDueTenantDeletions(rt, { deps: { now: later() } }); // other due deletions may run; this cancelled one must not
    expect(await count("products", s.tenantId)).toBeGreaterThan(0);
    const [stillSuspended] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId));
    expect(stillSuspended!.status).toBe("suspended");
    const actions = (await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.tenantId, s.tenantId))).map((r) => r.action);
    expect(actions).toContain("tenant.deletion_cancelled");

    // once billing was stopped and domains are being released the deletion can no longer be cancelled
    const r = await makeStore("del-started", { withData: true });
    const dr2 = await scheduleTenantDeletion(rt, staffId, { tenantId: r.tenantId, confirmSlug: "del-started", graceDays: 0 });
    const domains = { isConfigured: () => true, deleteCustomHostname: vi.fn().mockRejectedValue(new Error("cloudflare down")) } as never;
    await rt._db.db.insert(schema.domains).values({ tenantId: r.tenantId, hostname: "shop.started.example", type: "custom", status: "active", cfCustomHostnameId: "cf_1" });
    expect(await errorOf(executeTenantDeletionWorkflow(rt, dr2.id, { domains, now: later() }))).toMatch(/cloudflare down/);
    expect(await errorOf(cancelTenantDeletion(rt, staffId, r.tenantId))).toMatch(/already started \(billing_stopped\)/);
  });
});
