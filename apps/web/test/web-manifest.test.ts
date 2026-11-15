import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildStoreWebManifest } from "../src/lib/web-manifest.ts";

describe("buildStoreWebManifest", () => {
  it("uses the store name, valid hex colours and the icons the merchant uploaded with their real sizes", () => {
    const m = buildStoreWebManifest({
      name: "Ricwell Tea Company",
      assets: { faviconUrl: "https://m.x/fav.png", faviconSizes: "64x64", appleTouchIconUrl: "https://m.x/apple.png", appleTouchIconSizes: "180x180" },
      themeColor: "#1f6f4a",
      backgroundColor: "red",
    });
    expect(m).toMatchObject({ name: "Ricwell Tea Company", short_name: "Ricwell Tea", start_url: "/", display: "browser", theme_color: "#1f6f4a" });
    expect(m).not.toHaveProperty("background_color");
    expect(m["icons"]).toEqual([
      { src: "https://m.x/apple.png", sizes: "180x180", type: "image/png" },
      { src: "https://m.x/fav.png", sizes: "64x64", type: "image/png" },
    ]);
  });
  it("omits icons it cannot describe", () => {
    expect(buildStoreWebManifest({ name: "R", assets: { faviconUrl: "https://m.x/f.png", faviconSizes: null, appleTouchIconUrl: null, appleTouchIconSizes: null } })).not.toHaveProperty("icons");
    expect(buildStoreWebManifest({ name: "R", assets: null })).toMatchObject({ name: "R" });
  });
});
