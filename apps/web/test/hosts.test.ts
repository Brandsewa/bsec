import { describe, expect, it } from "vitest";
import { hostnameOf, isPlatformMarketingHost, platformMarketingHostnames } from "../src/server/hosts.ts";

describe("which hosts show the platform's own site", () => {
  it("gobs.cloud and www.gobs.cloud are the marketing site by default, ports and case ignored", () => {
    expect(isPlatformMarketingHost("gobs.cloud", {})).toBe(true);
    expect(isPlatformMarketingHost("WWW.GOBS.CLOUD:443", {})).toBe(true);
    expect(isPlatformMarketingHost("gobs.cloud, proxy.internal", {})).toBe(true);
  });

  it("stores, the admin and every other subdomain are not the marketing site", () => {
    for (const h of ["tasteofhills.gobs.cloud", "admin.gobs.cloud", "platform.gobs.cloud", "superadmin.gobs.cloud", "media.gobs.cloud", "mystore.com", "gobs.cloud.evil.com", "localhost"]) {
      expect(isPlatformMarketingHost(h, {})).toBe(false);
    }
  });

  it("follows PLATFORM_DOMAIN and an explicit MARKETING_HOST", () => {
    expect(platformMarketingHostnames({ PLATFORM_DOMAIN: "example.test" })).toEqual(["example.test", "www.example.test"]);
    expect(isPlatformMarketingHost("example.test", { PLATFORM_DOMAIN: "example.test" })).toBe(true);
    expect(isPlatformMarketingHost("gobs.cloud", { PLATFORM_DOMAIN: "example.test" })).toBe(false);
    expect(isPlatformMarketingHost("landing.example.test", { PLATFORM_DOMAIN: "example.test", MARKETING_HOST: "landing.example.test" })).toBe(true);
  });

  it("extracts the hostname from a header value", () => {
    expect(hostnameOf(undefined)).toBe("localhost");
    expect(hostnameOf("Store.Gobs.Cloud:3000")).toBe("store.gobs.cloud");
  });
});
