import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  getBrandSettings,
  updateBrandSettings,
  publishBrandSettings,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let storeA: { tenantId: string; ownerId: string };
let storeB: { tenantId: string; ownerId: string };

const ctxFor = (s: { tenantId: string; ownerId: string }, permissions = ["branding.manage"]): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions,
  requestId: "req-brand-test",
});

async function mkStore(prefix: string) {
  const uniqueSlug = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await provisionTenant(rtPlatform, {
    storeName: uniqueSlug,
    slug: uniqueSlug,
    owner: { email: `owner@${uniqueSlug}.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  return { tenantId: r.tenantId, ownerId: r.ownerId };
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  storeA = await mkStore("brand-a");
  storeB = await mkStore("brand-b");
}, 180_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("Branding Service: Permissions, Media Validation, and Audit (ADR-020, §3.1)", () => {
  let validMediaA: string;
  let validFaviconA: string;
  let nonSquareFaviconA: string;
  let oversizeFaviconA: string;
  let oversizeLogoA: string;
  let pdfMediaA: string;
  let unsafeSvgMediaA: string;
  let safeSvgMediaA: string;
  let mediaB: string;

  beforeAll(async () => {
    // Seed media rows in Store A
    await withTenant(rtWeb._db.db, storeA.tenantId, async (tx) => {
      const [mValid] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeA.tenantId,
          storageKey: "tenants/a/logo.png",
          mime: "image/png",
          bytes: 10240,
          width: 400,
          height: 200,
          folder: "branding",
        })
        .returning();
      validMediaA = mValid!.id;

      const [mFav] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeA.tenantId,
          storageKey: "tenants/a/fav.png",
          mime: "image/png",
          bytes: 2048,
          width: 64,
          height: 64,
          folder: "branding",
        })
        .returning();
      validFaviconA = mFav!.id;

      const [mNonSquare] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeA.tenantId,
          storageKey: "tenants/a/fav-rect.png",
          mime: "image/png",
          bytes: 2048,
          width: 120,
          height: 60,
          folder: "branding",
        })
        .returning();
      nonSquareFaviconA = mNonSquare!.id;

      const [mOverFav] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeA.tenantId,
          storageKey: "tenants/a/huge-fav.png",
          mime: "image/png",
          bytes: 600 * 1024, // 600 KB > 512 KB
          width: 512,
          height: 512,
          folder: "branding",
        })
        .returning();
      oversizeFaviconA = mOverFav!.id;

      const [mOverLogo] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeA.tenantId,
          storageKey: "tenants/a/huge-logo.png",
          mime: "image/png",
          bytes: 6 * 1024 * 1024, // 6 MB > 5 MB
          width: 2000,
          height: 1000,
          folder: "branding",
        })
        .returning();
      oversizeLogoA = mOverLogo!.id;

      const [mPdf] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeA.tenantId,
          storageKey: "tenants/a/doc.pdf",
          mime: "application/pdf",
          bytes: 5000,
          folder: "branding",
        })
        .returning();
      pdfMediaA = mPdf!.id;

      const [mUnsafeSvg] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeA.tenantId,
          storageKey: "<svg onload=\"alert('xss')\"></svg>",
          alt: "<svg><script>alert(1)</script></svg>",
          mime: "image/svg+xml",
          bytes: 1024,
          folder: "branding",
        })
        .returning();
      unsafeSvgMediaA = mUnsafeSvg!.id;

      const [mSafeSvg] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeA.tenantId,
          storageKey: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
          alt: "Clean SVG Logo",
          mime: "image/svg+xml",
          bytes: 1024,
          folder: "branding",
        })
        .returning();
      safeSvgMediaA = mSafeSvg!.id;
    });

    // Seed media in Store B (for cross-tenant test)
    await withTenant(rtWeb._db.db, storeB.tenantId, async (tx) => {
      const [mB] = await tx
        .insert(schema.media)
        .values({
          tenantId: storeB.tenantId,
          storageKey: "tenants/b/logo.png",
          mime: "image/png",
          bytes: 4096,
          width: 300,
          height: 150,
          folder: "branding",
        })
        .returning();
      mediaB = mB!.id;
    });
  });

  it("enforces permission checks (settings.read for get, branding.manage for update/publish)", async () => {
    const deniedCtx = ctxFor(storeA, ["analytics.read"]);
    const readCtx = ctxFor(storeA, ["settings.read"]);
    const manageCtx = ctxFor(storeA, ["branding.manage"]);

    // getBrandSettings
    await expect(getBrandSettings(rtWeb, deniedCtx)).rejects.toThrow(/Forbidden/);
    const readRes = await getBrandSettings(rtWeb, readCtx);
    expect(readRes).toBeDefined();

    // updateBrandSettings
    await expect(updateBrandSettings(rtWeb, deniedCtx, { primaryColor: "#336699" })).rejects.toThrow(/Forbidden/);
    await expect(updateBrandSettings(rtWeb, readCtx, { primaryColor: "#336699" })).rejects.toThrow(/Forbidden/);
    const updateRes = await updateBrandSettings(rtWeb, manageCtx, { primaryColor: "#336699" });
    expect(updateRes.primaryColor).toBe("#336699");

    // publishBrandSettings
    await expect(publishBrandSettings(rtWeb, deniedCtx)).rejects.toThrow(/Forbidden/);
    await expect(publishBrandSettings(rtWeb, readCtx)).rejects.toThrow(/Forbidden/);
    const publishRes = await publishBrandSettings(rtWeb, manageCtx);
    expect(publishRes.version).toBeGreaterThan(0);
  });

  it("rejects cross-tenant media asset references", async () => {
    const ctx = ctxFor(storeA);
    await expect(
      updateBrandSettings(rtWeb, ctx, { logoLightMediaId: mediaB })
    ).rejects.toThrow(/not found for slot 'logoLight' or access denied/);

    await expect(
      updateBrandSettings(rtWeb, ctx, { faviconMediaId: mediaB })
    ).rejects.toThrow(/not found for slot 'favicon' or access denied/);
  });

  it("rejects non-image formats for media slots", async () => {
    const ctx = ctxFor(storeA);
    await expect(
      updateBrandSettings(rtWeb, ctx, { logoLightMediaId: pdfMediaA })
    ).rejects.toThrow(/Invalid media format 'application\/pdf'/);
  });

  it("rejects oversize and non-square favicons", async () => {
    const ctx = ctxFor(storeA);

    // Oversize favicon (>512 KB)
    await expect(
      updateBrandSettings(rtWeb, ctx, { faviconMediaId: oversizeFaviconA })
    ).rejects.toThrow(/exceeds maximum allowed limit of 512 KB/);

    // Non-square favicon (width !== height)
    await expect(
      updateBrandSettings(rtWeb, ctx, { faviconMediaId: nonSquareFaviconA })
    ).rejects.toThrow(/Favicon must be square/);

    // Valid square favicon succeeds
    const res = await updateBrandSettings(rtWeb, ctx, { faviconMediaId: validFaviconA });
    expect(res.faviconMediaId).toBe(validFaviconA);
  });

  it("rejects oversize logo files (>5 MB)", async () => {
    const ctx = ctxFor(storeA);
    await expect(
      updateBrandSettings(rtWeb, ctx, { logoDarkMediaId: oversizeLogoA })
    ).rejects.toThrow(/exceeds maximum allowed limit of 5 MB/);
  });

  it("rejects unsafe SVG with embedded scripts or event handlers", async () => {
    const ctx = ctxFor(storeA);
    await expect(
      updateBrandSettings(rtWeb, ctx, { logoLightMediaId: unsafeSvgMediaA })
    ).rejects.toThrow(/Unsafe SVG for slot 'logoLight'/);
  });

  it("accepts valid media and safe SVGs", async () => {
    const ctx = ctxFor(storeA);
    const res = await updateBrandSettings(rtWeb, ctx, {
      logoLightMediaId: safeSvgMediaA,
      logoDarkMediaId: validMediaA,
      socialImageMediaId: validMediaA,
    });
    expect(res.logoLightMediaId).toBe(safeSvgMediaA);
    expect(res.logoDarkMediaId).toBe(validMediaA);
    expect(res.socialImageMediaId).toBe(validMediaA);
  });

  it("writes audit logs for updateBrandSettings and publishBrandSettings with accurate diffs", async () => {
    const ctx = ctxFor(storeA);

    await updateBrandSettings(rtWeb, ctx, {
      primaryColor: "#ff0077",
      fontHeading: "Poppins",
    });

    const [updateAudit] = await rtPlatform._db.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tenantId, storeA.tenantId),
          eq(schema.auditLogs.action, "brand_settings.update")
        )
      )
      .orderBy(desc(schema.auditLogs.createdAt));

    expect(updateAudit).toBeDefined();
    expect(updateAudit!.targetType).toBe("brand_settings");
    const diff = updateAudit!.diff as Record<string, { before: unknown; after: unknown }>;
    expect(diff.primaryColor).toBeDefined();
    expect(diff.primaryColor?.after).toBe("#ff0077");

    const pubRes = await publishBrandSettings(rtWeb, ctx);

    const [pubAudit] = await rtPlatform._db.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tenantId, storeA.tenantId),
          eq(schema.auditLogs.action, "brand_settings.publish")
        )
      )
      .orderBy(desc(schema.auditLogs.createdAt));

    expect(pubAudit).toBeDefined();
    expect(pubAudit!.targetType).toBe("brand_settings");
    const pubDiff = pubAudit!.diff as { version: { before: number; after: number } };
    expect(pubDiff.version.after).toBe(pubRes.version);
  });
});
