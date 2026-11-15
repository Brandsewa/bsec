/**
 * getStorefrontBrandAssets (docs/SEO-GEO-AEO-PLAN.md Phase 2): logo, favicon and the default share image for the page head,
 * resolved to public URLs, and never read across stores. Real Postgres: both tables are forced-RLS tenant tables.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, getStorefrontBrandAssets, provisionTenant, type Runtime } from "../src/index.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let storeA: string;
let storeB: string;
const prev = process.env.MEDIA_PUBLIC_URL;

async function mkStore(prefix: string): Promise<string> {
  const slug = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await provisionTenant(rtPlatform, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  return r.tenantId;
}

async function addMedia(tenantId: string, key: string, w = 1200, h = 630, alt?: string): Promise<string> {
  return withTenant(rtWeb._db.db, tenantId, async (tx) => {
    const [m] = await tx.insert(schema.media).values({ tenantId, storageKey: key, mime: "image/png", bytes: 1000, width: w, height: h, folder: "branding", ...(alt ? { alt } : {}) }).returning();
    return m!.id;
  });
}

beforeAll(async () => {
  process.env.MEDIA_PUBLIC_URL = "https://media.example.test";
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  storeA = await mkStore("assets-a");
  storeB = await mkStore("assets-b");
}, 180_000);

afterAll(async () => {
  if (prev === undefined) delete process.env.MEDIA_PUBLIC_URL;
  else process.env.MEDIA_PUBLIC_URL = prev;
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("getStorefrontBrandAssets", () => {
  it("returns nothing for a store with no brand images", async () => {
    expect(await getStorefrontBrandAssets(rtWeb, storeB)).toEqual({ logoUrl: null, faviconUrl: null, appleTouchIconUrl: null, shareImage: null });
  });

  it("falls back from the SEO default image to the social image to the logo, and stays inside its own store", async () => {
    const logo = await addMedia(storeA, "tenants/a/logo.png", 400, 200);
    const fav = await addMedia(storeA, "tenants/a/fav.png", 64, 64);
    await withTenant(rtWeb._db.db, storeA, async (tx) => {
      await tx.insert(schema.brandSettings).values({ tenantId: storeA, logoMediaId: logo, faviconMediaId: fav });
    });
    // Logo only: the logo is the share image.
    const a1 = await getStorefrontBrandAssets(rtWeb, storeA);
    expect(a1.logoUrl).toBe("https://media.example.test/tenants/a/logo.png");
    expect(a1.faviconUrl).toBe("https://media.example.test/tenants/a/fav.png");
    expect(a1.shareImage?.url).toBe("https://media.example.test/tenants/a/logo.png");

    // A social image beats the logo; the SEO default image beats both.
    const social = await addMedia(storeA, "tenants/a/social.png");
    await withTenant(rtWeb._db.db, storeA, async (tx) => {
      await tx.update(schema.brandSettings).set({ socialImageMediaId: social });
    });
    expect((await getStorefrontBrandAssets(rtWeb, storeA)).shareImage?.url).toBe("https://media.example.test/tenants/a/social.png");

    const og = await addMedia(storeA, "tenants/a/og.png", 1200, 630, "The shop");
    await withTenant(rtWeb._db.db, storeA, async (tx) => {
      await tx.insert(schema.seoSettings).values({ tenantId: storeA, defaultOgImageMediaId: og });
    });
    const a2 = await getStorefrontBrandAssets(rtWeb, storeA);
    expect(a2.shareImage).toEqual({ url: "https://media.example.test/tenants/a/og.png", width: 1200, height: 630, alt: "The shop" });

    // Store B still has none: nothing leaked across stores.
    expect((await getStorefrontBrandAssets(rtWeb, storeB)).shareImage).toBeNull();
  });
});
