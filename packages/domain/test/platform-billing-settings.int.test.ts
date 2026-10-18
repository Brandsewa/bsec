import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, createDb } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  createRuntime,
  getPlatformBillingSettings,
  loadPlatformBillingCredentials,
  testPlatformBillingConnection,
  updatePlatformBillingSettings,
  resolveBillingProvider,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let owner: string;
let admin: string;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;
// drizzle wraps driver errors ("Failed query"); the Postgres message is on the cause.
const dbErrorOf = async (p: Promise<unknown>) => {
  const e = (await p.then(() => null, (err: Error & { cause?: Error }) => err)) as (Error & { cause?: Error }) | null;
  return e ? `${e.message} ${e.cause?.message ?? ""}` : null;
};
const SECRET = "test_secret_value_1234";

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  owner = (await seedPlatformStaff(rt._db.db, { email: "billing-owner@platform.test", role: "platform_owner" })).userId;
  admin = (await seedPlatformStaff(rt._db.db, { email: "billing-admin@platform.test", role: "platform_admin" })).userId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("platform billing settings (ADR-036)", () => {
  it("starts disabled in test mode with nothing configured", async () => {
    delete process.env.RAZORPAY_PLATFORM_KEY_ID;
    delete process.env.RAZORPAY_PLATFORM_KEY_SECRET;
    const v = await getPlatformBillingSettings(rt, admin);
    expect(v).toMatchObject({ mode: "test", enabled: false, graceDays: 7, usingEnvFallback: false });
    expect(v.test).toMatchObject({ keyId: null, secretConfigured: false });
    expect(v.webhookUrl).toMatch(/\/api\/webhooks\/platform-billing$/);
    expect(await loadPlatformBillingCredentials(rt._db.db)).toBeNull();
  });

  it("only the platform owner can change or test billing settings", async () => {
    expect(await errorOf(updatePlatformBillingSettings(rt, admin, { graceDays: 3 }))).toMatch(/platform_owner|Forbidden/i);
    expect(await errorOf(testPlatformBillingConnection(rt, admin))).toMatch(/platform_owner|Forbidden/i);
  });

  it("validates key prefixes and refuses to enable or go live without keys", async () => {
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { test: { keyId: "rzp_live_abc" } }))).toMatch(/rzp_test_/);
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { enabled: true }))).toMatch(/save the test key id and secret/);
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { mode: "live" }))).toMatch(/live key id and secret/);
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { graceDays: 99 }))).toMatch(/0 to 30/);
  });

  it("stores secrets encrypted, never returns them, and audits field names only", async () => {
    await updatePlatformBillingSettings(rt, owner, { test: { keyId: "rzp_test_abc123", keySecret: SECRET, webhookSecret: "whsec_test_9999" } });
    const [row] = await rt._db.db.select().from(schema.platformBillingSettings).where(eq(schema.platformBillingSettings.id, "default"));
    expect(row!.testSecretCiphertext).toBeTruthy();
    expect(row!.testSecretCiphertext).not.toContain(SECRET);
    expect(JSON.stringify(row)).not.toContain(SECRET);

    const v = await getPlatformBillingSettings(rt, admin);
    expect(v.test).toEqual({ keyId: "rzp_test_abc123", secretConfigured: true, secretLastFour: "1234", webhookSecretConfigured: true });
    expect(JSON.stringify(v)).not.toContain(SECRET);

    const audits = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "platform_billing.updated"));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(SECRET);
    expect(JSON.stringify(audits)).not.toContain("whsec_test_9999");
    expect(JSON.stringify(audits)).toContain("test.keySecret");
  });

  it("uses the saved keys only once billing is enabled, then falls back to the environment", async () => {
    expect(await loadPlatformBillingCredentials(rt._db.db)).toBeNull(); // saved but not enabled
    await updatePlatformBillingSettings(rt, owner, { enabled: true });
    const creds = await loadPlatformBillingCredentials(rt._db.db);
    expect(creds).toMatchObject({ keyId: "rzp_test_abc123", keySecret: SECRET, webhookSecret: "whsec_test_9999", mode: "test", source: "database" });
    expect((await resolveBillingProvider(rt._db.db)).isConfigured()).toBe(true);

    await updatePlatformBillingSettings(rt, owner, { enabled: false });
    process.env.RAZORPAY_PLATFORM_KEY_ID = "rzp_test_env";
    process.env.RAZORPAY_PLATFORM_KEY_SECRET = "env_secret";
    expect(await loadPlatformBillingCredentials(rt._db.db)).toMatchObject({ keyId: "rzp_test_env", source: "env" });
    expect((await getPlatformBillingSettings(rt, admin)).usingEnvFallback).toBe(true);
    delete process.env.RAZORPAY_PLATFORM_KEY_ID;
    delete process.env.RAZORPAY_PLATFORM_KEY_SECRET;
  });

  it("tests the connection with the saved keys and records the result (no network)", async () => {
    const seen: string[] = [];
    const ok = await testPlatformBillingConnection(rt, owner, { mode: "test" }, undefined, (async (_url: unknown, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>).Authorization));
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    expect(ok).toEqual({ ok: true, mode: "test" });
    expect(seen[0]).toBe(`Basic ${Buffer.from(`rzp_test_abc123:${SECRET}`).toString("base64")}`);
    expect((await getPlatformBillingSettings(rt, admin)).lastTestStatus).toBe("success");

    const bad = await testPlatformBillingConnection(rt, owner, { mode: "test" }, undefined, (async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/401/);
    expect((await getPlatformBillingSettings(rt, admin)).lastTestStatus).toBe("failed");

    const noLive = await testPlatformBillingConnection(rt, owner, { mode: "live" }, undefined, (async () => new Response("{}")) as unknown as typeof fetch);
    expect(noLive).toMatchObject({ ok: false, error: expect.stringMatching(/Save the live key/) });
  });

  it("only app_platform writes the table; the self-service role reads it; the store runtime cannot", async () => {
    const saas = createDb(env.as("app_saas"), { max: 2 });
    const rw = createDb(env.as("app_rw"), { max: 2 });
    try {
      const rows = await saas.db.select({ id: schema.platformBillingSettings.id }).from(schema.platformBillingSettings);
      expect(rows).toHaveLength(1);
      expect(await dbErrorOf(saas.db.update(schema.platformBillingSettings).set({ graceDays: 1 }))).toMatch(/permission denied/i);
      expect(await dbErrorOf(rw.db.select().from(schema.platformBillingSettings))).toMatch(/permission denied/i);
    } finally {
      await saas.close();
      await rw.close();
    }
  });
});
