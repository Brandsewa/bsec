import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createRuntime, DEFAULT_LOGIN_PANEL, getLoginPanelForStaff, getPublicLoginPanel, normaliseLoginPanel, updateLoginPanel, type Runtime } from "../src/index.ts";

// The content panel beside the admin sign-in form: text, colours, optional picture (Super Admin edits, the page reads).
let env: TestDb;
let rt: Runtime;
let adminId: string;
let supportId: string;

const VALID = { heading: "Hello merchants", body: "Sell more.", textColor: "#FFFFFF", backgroundFrom: "#111111", backgroundTo: "#333333", imageUrl: null, verticalAlign: "top" as const };

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  adminId = (await seedPlatformStaff(rt._db.db, { email: "lp-admin@platform.test", role: "platform_admin" })).userId;
  supportId = (await seedPlatformStaff(rt._db.db, { email: "lp-support@platform.test", role: "platform_support" })).userId;
}, 120_000);

afterAll(async () => {
  await rt?._db.close?.();
  await env?.stop?.();
});

describe("login panel", () => {
  it("falls back to the built-in panel until one is saved", async () => {
    expect(await getPublicLoginPanel(rt._db.db)).toEqual(DEFAULT_LOGIN_PANEL);
    expect((await getLoginPanelForStaff(rt, adminId)).explicit).toBe(false);
  });

  it("saves, lowercases colours, reads back publicly and audits the change", async () => {
    await updateLoginPanel(rt, adminId, VALID);
    expect(await getPublicLoginPanel(rt._db.db)).toMatchObject({ heading: "Hello merchants", textColor: "#ffffff", verticalAlign: "top" });
    expect((await getLoginPanelForStaff(rt, supportId)).explicit).toBe(true);
    const audit = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "platform_settings.login_panel"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses support staff", async () => {
    await expect(updateLoginPanel(rt, supportId, VALID)).rejects.toThrow(/Forbidden|platform_admin/i);
  });

  it("defaults the position to middle for a saved panel without one", () => {
    const { verticalAlign: _v, ...legacy } = VALID;
    expect(normaliseLoginPanel(legacy).verticalAlign).toBe("middle");
    expect(normaliseLoginPanel({ ...VALID, verticalAlign: "sideways" }).verticalAlign).toBe("middle");
  });

  it("rejects bad input", () => {
    expect(() => normaliseLoginPanel({ ...VALID, heading: "  " })).toThrow(/Heading/);
    expect(() => normaliseLoginPanel({ ...VALID, textColor: "white" })).toThrow(/colour/);
    expect(() => normaliseLoginPanel({ ...VALID, imageUrl: "http://example.com/a.png" })).toThrow(/https/);
    expect(normaliseLoginPanel({ ...VALID, imageUrl: "http://demo-store.localhost:3000/media/a.png" }).imageUrl).toContain("demo-store.localhost");
    expect(() => normaliseLoginPanel({ ...VALID, imageUrl: "javascript:alert(1)" })).toThrow();
    expect(normaliseLoginPanel({ ...VALID, imageUrl: "https://example.com/a.png" }).imageUrl).toBe("https://example.com/a.png");
  });
});
