import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  DEFAULT_BRAND,
  createRuntime,
  getPlatformBrand,
  getPublicPlatformBrand,
  listPlatformBrandVersions,
  restorePlatformBrand,
  updatePlatformBrand,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let admin: string;
let support: string;

/** CI runs every test file against one shared database: start from no brand and leave none behind. */
async function reset() {
  await rt._db.db.execute(sql`DELETE FROM platform_branding_versions`);
  await rt._db.db.execute(sql`DELETE FROM platform_branding`);
}
const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;
const withPrimary = (primary: string) => ({ ...structuredClone(DEFAULT_BRAND), color: { primary, secondary: DEFAULT_BRAND.color.secondary } });

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  admin = (await seedPlatformStaff(rt._db.db, { email: "brand-admin@platform.test", role: "platform_admin" })).userId;
  support = (await seedPlatformStaff(rt._db.db, { email: "brand-support@platform.test", role: "platform_support" })).userId;
  await reset();
}, 180_000);

afterAll(async () => {
  await reset();
  await rt?.close();
  await env?.stop();
});

describe("platform branding", () => {
  it("is not explicit until saved, then round-trips and bumps the version", async () => {
    expect((await getPublicPlatformBrand(rt)).explicit).toBe(false);
    const saved = await updatePlatformBrand(rt, admin, withPrimary("#112233"));
    expect(saved.version).toBe(1);
    const read = await getPlatformBrand(rt, support);
    expect(read.tokens.color.primary).toBe("#112233");
    expect(read.explicit).toBe(true);
    expect(read.css).toContain("--brand-primary:#112233");
    expect((await getPublicPlatformBrand(rt)).version).toBe(1);
  });

  it("lets support read but not write or restore", async () => {
    expect(await errorOf(updatePlatformBrand(rt, support, withPrimary("#445566")))).toMatch(/platform_admin|permission|role/i);
    expect(await errorOf(restorePlatformBrand(rt, support, 1))).toMatch(/platform_admin|permission|role/i);
    expect((await listPlatformBrandVersions(rt, support)).length).toBeGreaterThan(0);
  });

  it("refuses invalid input whole and writes nothing", async () => {
    const before = (await getPlatformBrand(rt, admin)).version;
    expect(await errorOf(updatePlatformBrand(rt, admin, { ...withPrimary("#112233"), font: "comic" }))).toMatch(/font/);
    expect(await errorOf(updatePlatformBrand(rt, admin, withPrimary("not-a-colour")))).toMatch(/color\.primary/);
    expect((await getPlatformBrand(rt, admin)).version).toBe(before);
  });

  it("restores an earlier version as a NEW version and records both in history", async () => {
    await updatePlatformBrand(rt, admin, withPrimary("#aa0000"));
    const versions = await listPlatformBrandVersions(rt, admin);
    const first = versions.find((v) => v.tokens.color.primary === "#112233");
    expect(first).toBeTruthy();
    const restored = await restorePlatformBrand(rt, admin, first!.version);
    expect(restored.version).toBeGreaterThan(versions[0]!.version);
    expect((await getPlatformBrand(rt, admin)).tokens.color.primary).toBe("#112233");
    const after = await listPlatformBrandVersions(rt, admin);
    expect(after[0]?.action).toBe("restore");
    expect(after.length).toBe(versions.length + 1);
  });

  it("errors on an unknown version and keeps only the last 20", async () => {
    expect(await errorOf(restorePlatformBrand(rt, admin, 99999))).toMatch(/not found/i);
    for (let i = 0; i < 24; i++) await updatePlatformBrand(rt, admin, withPrimary(`#0000${(i + 16).toString(16).padStart(2, "0")}`));
    expect((await listPlatformBrandVersions(rt, admin)).length).toBe(20);
  });
});
