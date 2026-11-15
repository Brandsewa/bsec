import { beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { DEFAULT_CONSENT_SETTINGS, type ConsentSettings } from "@bs/contracts";
import {
  createRuntime,
  getPrivacySettings,
  getStorefrontConsentConfig,
  provisionTenant,
  updatePrivacySettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let platform: Runtime;
let web: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;

const on = (over: Partial<ConsentSettings> = {}): ConsentSettings => ({ ...DEFAULT_CONSENT_SETTINGS, enabled: true, ...over });

beforeAll(async () => {
  env = await startTestDb();
  platform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  web = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const r = Math.random().toString(36).slice(2, 7);
  const mk = async (name: string): Promise<TenantContext> => {
    const t = await provisionTenant(platform, {
      storeName: `Consent ${name}`,
      slug: `con-${name}-${r}`,
      owner: { email: `o-${name}-${r}@consent.test`, name },
      planCode: "starter",
      source: "platform_admin",
    });
    return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
  };
  ctxA = await mk("a");
  ctxB = await mk("b");
});

describe("cookie banner settings (real database)", () => {
  it("a new store has the banner off and the storefront gets no config", async () => {
    const s = await getPrivacySettings(web, ctxA);
    expect(s.consent).toEqual(DEFAULT_CONSENT_SETTINGS);
    expect(await getStorefrontConsentConfig(web, ctxA.tenantId)).toBeNull();
  });

  it("saves the banner and tracking ids, and the storefront config carries them and a revision", async () => {
    const saved = await updatePrivacySettings(web, ctxA, {
      consent: on({ title: "Cookies", integrations: { ga4MeasurementId: "G-ABC123XYZ", metaPixelId: "1234567890123456", metaTestEventCode: null } }),
    });
    expect(saved.consent.integrations).toEqual({ ga4MeasurementId: "G-ABC123XYZ", metaPixelId: "1234567890123456", metaTestEventCode: null });
    const cfg = await getStorefrontConsentConfig(web, ctxA.tenantId);
    expect(cfg).toMatchObject({ v: 1, title: "Cookies", ga4: "G-ABC123XYZ", pixel: "1234567890123456", position: "bottom" });
    expect(cfg?.rev).toMatch(/^[0-9a-f]{8}$/);

    // New wording or new ids mean a new revision, so earlier choices are asked again; unrelated edits keep it.
    const before = cfg!.rev;
    await updatePrivacySettings(web, ctxA, { consent: on({ title: "Cookies", acceptLabel: "Yes", integrations: { ga4MeasurementId: "G-ABC123XYZ", metaPixelId: "1234567890123456", metaTestEventCode: null } }) });
    expect((await getStorefrontConsentConfig(web, ctxA.tenantId))?.rev).toBe(before);
    await updatePrivacySettings(web, ctxA, { consent: on({ title: "Cookies", integrations: { ga4MeasurementId: "G-ZZZ999AAA", metaPixelId: null, metaTestEventCode: null } }) });
    expect((await getStorefrontConsentConfig(web, ctxA.tenantId))?.rev).not.toBe(before);
  });

  it("refuses tracking ids while the banner is off, and malformed ids", async () => {
    await expect(
      updatePrivacySettings(web, ctxA, { consent: { ...DEFAULT_CONSENT_SETTINGS, enabled: false, integrations: { ga4MeasurementId: "G-ABC123XYZ", metaPixelId: null, metaTestEventCode: null } } }),
    ).rejects.toThrow(/banner on/i);
    for (const bad of ["UA-12345-1", "G-ab", "<script>", "G-ABC123XYZ\"onload=\"x"]) {
      await expect(updatePrivacySettings(web, ctxA, { consent: on({ integrations: { ga4MeasurementId: bad, metaPixelId: null, metaTestEventCode: null } }) })).rejects.toThrow(/Bad Request/);
    }
    await expect(updatePrivacySettings(web, ctxA, { consent: on({ integrations: { ga4MeasurementId: null, metaPixelId: "12ab", metaTestEventCode: null } }) })).rejects.toThrow(/Bad Request/);
    await expect(updatePrivacySettings(web, ctxA, { consent: on({ policyPath: "https://evil.test" }) })).rejects.toThrow(/Bad Request/);
  });

  it("switching the banner off clears the storefront config", async () => {
    await updatePrivacySettings(web, ctxA, { consent: DEFAULT_CONSENT_SETTINGS });
    expect(await getStorefrontConsentConfig(web, ctxA.tenantId)).toBeNull();
  });

  it("is per store, and writing needs privacy.manage", async () => {
    await updatePrivacySettings(web, ctxB, { consent: on({ title: "Store B banner" }) });
    expect((await getStorefrontConsentConfig(web, ctxB.tenantId))?.title).toBe("Store B banner");
    expect(await getStorefrontConsentConfig(web, ctxA.tenantId)).toBeNull();
    const noPerm = { ...ctxA, permissions: ["settings.read"] } as TenantContext;
    await expect(updatePrivacySettings(web, noPerm, { consent: on() })).rejects.toThrow(/Forbidden/);
  });
});
