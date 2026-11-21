/**
 * Integration: Super Admin pincode directory upload (ADR-044): role check, validation, load, re-load, audit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createRuntime, getPincodeDirectoryStatus, importPincodesFromJson, lookupStateByPincode, type Runtime } from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let admin: string;
let support: string;

const directory = (state: string, extra: Record<string, { state: string }> = {}) =>
  JSON.stringify({
    ...Object.fromEntries(Array.from({ length: 150 }, (_, i) => [String(560001 + i), { state, district: "x" }])),
    ...extra,
  });

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  admin = (await seedPlatformStaff(rt._db.db, { email: "pin-admin@platform.test", role: "platform_admin" })).userId;
  support = (await seedPlatformStaff(rt._db.db, { email: "pin-support@platform.test", role: "platform_support" })).userId;
}, 240_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("importPincodesFromJson", () => {
  it("refuses support staff and bad files", async () => {
    await expect(importPincodesFromJson(rt, support, directory("Karnataka"))).rejects.toThrow(/Forbidden|requires/i);
    await expect(importPincodesFromJson(rt, admin, "not json")).rejects.toThrow(/not valid JSON/);
    await expect(importPincodesFromJson(rt, admin, "[]")).rejects.toThrow(/keyed by pincode/);
    await expect(importPincodesFromJson(rt, admin, JSON.stringify({ "560001": { state: "Karnataka" } }))).rejects.toThrow(/too few/);
    expect((await getPincodeDirectoryStatus(rt, support)).count).toBe(0);
  });

  it("loads the directory, applies the pinned corrections, reports skipped rows and audits", async () => {
    const res = await importPincodesFromJson(rt, admin, directory("Karnataka", { "799001": { state: "Telangana" }, "999990": { state: "" } }));
    expect(res).toMatchObject({ imported: 151, skipped: 1 });
    expect(res.skippedSample[0]).toMatch(/no state for 999990/);
    expect(await lookupStateByPincode(rt, "560001")).toBe("KA");
    expect(await lookupStateByPincode(rt, "799001")).toBe("TR");
    expect(await lookupStateByPincode(rt, "999990")).toBeNull();
    expect((await getPincodeDirectoryStatus(rt, support)).count).toBe(151);
    const audit = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "marketplace.pincodes.import"));
    expect(audit).toHaveLength(1);
  });

  it("can be loaded again and updates existing pincodes", async () => {
    await importPincodesFromJson(rt, admin, directory("Tamil Nadu"));
    expect(await lookupStateByPincode(rt, "560001")).toBe("TN");
    expect((await getPincodeDirectoryStatus(rt, admin)).count).toBe(151);
  });
});
