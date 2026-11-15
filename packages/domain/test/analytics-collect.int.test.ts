import { beforeAll, describe, expect, it } from "vitest";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, provisionTenant, recordAnalyticsEvent, type Runtime } from "../src/index.ts";

const SECRET = "test-secret";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const base = { ip: "203.0.113.9", userAgent: UA, ownHost: "a-store.test" };

let env: TestDb;
let platform: Runtime;
let web: Runtime;
let tenantA: string;
let tenantB: string;

async function rows(tenantId: string) {
  return withTenant(web._db.db, tenantId, (tx) => tx.select().from(schema.analyticsEvents));
}

beforeAll(async () => {
  env = await startTestDb();
  platform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  web = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const r = Math.random().toString(36).slice(2, 7);
  const mk = (n: string) =>
    provisionTenant(platform, {
      storeName: `Analytics ${n}`,
      slug: `an-${n}-${r}`,
      owner: { email: `o-${n}-${r}@analytics.test`, name: n },
      planCode: "starter",
      source: "platform_admin",
    });
  tenantA = (await mk("a")).tenantId;
  tenantB = (await mk("b")).tenantId;
});

describe("recordAnalyticsEvent (real database)", () => {
  it("stores a pageview with the path only, referrer host, lowercased utm, device and no raw IP", async () => {
    const res = await recordAnalyticsEvent(
      web,
      tenantA,
      {
        ...base,
        type: "pageview",
        path: "/products/blue-mug?secret=1#frag",
        referrer: "https://www.Instagram.com/some/post",
        search: "?utm_source=Instagram&utm_medium=Social&utm_campaign=Diwali&x=1",
        country: "in",
      },
      { secret: SECRET },
    );
    expect(res).toBe("recorded");
    const [e] = await rows(tenantA);
    expect(e).toMatchObject({
      eventType: "pageview",
      path: "/products/blue-mug",
      productSlug: "blue-mug",
      referrerHost: "instagram.com",
      utmSource: "instagram",
      utmMedium: "social",
      utmCampaign: "diwali",
      country: "IN",
      device: "mobile",
    });
    expect(JSON.stringify(e)).not.toContain("203.0.113.9");
  });

  it("does not count the store's own pages as a referrer", async () => {
    await recordAnalyticsEvent(web, tenantA, { ...base, type: "pageview", path: "/", referrer: "https://a-store.test/cart" }, { secret: SECRET });
    const own = (await rows(tenantA)).find((r) => r.path === "/");
    expect(own?.referrerHost).toBeNull();
  });

  it("ignores bots, Do Not Track, unknown types and bad paths", async () => {
    const before = (await rows(tenantA)).length;
    const results = await Promise.all([
      recordAnalyticsEvent(web, tenantA, { ...base, userAgent: "Googlebot/2.1", type: "pageview", path: "/" }, { secret: SECRET }),
      recordAnalyticsEvent(web, tenantA, { ...base, doNotTrack: true, type: "pageview", path: "/" }, { secret: SECRET }),
      recordAnalyticsEvent(web, tenantA, { ...base, type: "purchase", path: "/" }, { secret: SECRET }),
      recordAnalyticsEvent(web, tenantA, { ...base, type: "pageview", path: "https://evil.test/" }, { secret: SECRET }),
    ]);
    expect(results).toEqual(["ignored", "ignored", "ignored", "ignored"]);
    expect((await rows(tenantA)).length).toBe(before);
  });

  it("is invisible to another store (RLS) and the same shopper hashes differently per store", async () => {
    await recordAnalyticsEvent(web, tenantB, { ...base, type: "pageview", path: "/" }, { secret: SECRET });
    const a = await rows(tenantA);
    const b = await rows(tenantB);
    expect(b).toHaveLength(1);
    expect(a.every((r) => r.tenantId === tenantA)).toBe(true);
    expect(b[0]!.visitorHash).not.toBe(a.find((r) => r.path === "/")!.visitorHash);
  });
});
