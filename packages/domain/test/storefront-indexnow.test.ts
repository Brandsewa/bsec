import { describe, expect, it } from "vitest";
import { buildIndexNowPayload, changedUrls, indexNowEnabled, indexNowKey } from "../src/storefront/indexnow.ts";

describe("indexNowKey", () => {
  it("is a stable 32-character hex key per tenant, different between tenants and secrets", () => {
    const env = { TENANT_SECRETS_KEY: "s1" };
    const a = indexNowKey("tenant-a", env)!;
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(indexNowKey("tenant-a", env)).toBe(a);
    expect(indexNowKey("tenant-b", env)).not.toBe(a);
    expect(indexNowKey("tenant-a", { TENANT_SECRETS_KEY: "s2" })).not.toBe(a);
  });
  it("is null without a server secret, and falls back to ENCRYPTION_KEY", () => {
    expect(indexNowKey("t", {})).toBeNull();
    expect(indexNowKey("t", { ENCRYPTION_KEY: "e" })).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("indexNowEnabled", () => {
  it("is on only for the exact value true", () => {
    expect(indexNowEnabled({ INDEXNOW_ENABLED: "true" })).toBe(true);
    for (const v of [undefined, "", "1", "TRUE", "false"]) expect(indexNowEnabled({ INDEXNOW_ENABLED: v })).toBe(false);
  });
});

describe("changedUrls", () => {
  const since = new Date("2026-11-10T00:00:00Z");
  it("keeps only pages changed after the watermark, on the notified host, once each", () => {
    const urls = changedUrls(
      [
        { loc: "https://s.com/products/new", lastmod: "2026-11-11T00:00:00Z" },
        { loc: "https://s.com/products/new", lastmod: "2026-11-12T00:00:00Z" },
        { loc: "https://s.com/products/old", lastmod: "2026-11-09T00:00:00Z" },
        { loc: "https://s.com/products/same", lastmod: "2026-11-10T00:00:00Z" },
        { loc: "https://s.com/pages/unknown-time" },
        { loc: "https://other.com/products/x", lastmod: "2026-11-12T00:00:00Z" },
        { loc: "not a url", lastmod: "2026-11-12T00:00:00Z" },
        { loc: "https://s.com/bad-date", lastmod: "yesterday" },
      ],
      since,
      "s.com",
    );
    expect(urls).toEqual(["https://s.com/products/new"]);
  });
  it("caps the list", () => {
    const items = Array.from({ length: 800 }, (_, i) => ({ loc: `https://s.com/p/${i}`, lastmod: "2026-11-12T00:00:00Z" }));
    expect(changedUrls(items, since, "s.com")).toHaveLength(500);
  });
});

describe("buildIndexNowPayload", () => {
  it("points keyLocation at the root of the host", () => {
    expect(buildIndexNowPayload("s.com", "k".repeat(32), ["https://s.com/a"])).toEqual({ host: "s.com", key: "k".repeat(32), keyLocation: `https://s.com/${"k".repeat(32)}.txt`, urlList: ["https://s.com/a"] });
  });
});
