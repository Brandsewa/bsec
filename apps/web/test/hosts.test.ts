import { describe, expect, it } from "vitest";
import { hostnameOf, isPlatformMarketingHost, platformMarketingHostnames } from "../src/server/hosts.ts";

describe("which hosts show the platform's own site", () => {
  it("bcom.si and www.bcom.si are the marketing site by default, ports and case ignored", () => {
    expect(isPlatformMarketingHost("bcom.si", {})).toBe(true);
    expect(isPlatformMarketingHost("WWW.BCOM.SI:443", {})).toBe(true);
    expect(isPlatformMarketingHost("bcom.si, proxy.internal", {})).toBe(true);
  });

  it("stores, the admin and every other subdomain are not the marketing site", () => {
    for (const h of ["tasteofhills.bcom.si", "admin.bcom.si", "platform.bcom.si", "superadmin.bcom.si", "media.bcom.si", "mystore.com", "bcom.si.evil.com", "localhost"]) {
      expect(isPlatformMarketingHost(h, {})).toBe(false);
    }
  });

  it("follows PLATFORM_DOMAIN and an explicit MARKETING_HOST", () => {
    expect(platformMarketingHostnames({ PLATFORM_DOMAIN: "example.test" })).toEqual(["example.test", "www.example.test"]);
    expect(isPlatformMarketingHost("example.test", { PLATFORM_DOMAIN: "example.test" })).toBe(true);
    expect(isPlatformMarketingHost("bcom.si", { PLATFORM_DOMAIN: "example.test" })).toBe(false);
    expect(isPlatformMarketingHost("landing.example.test", { PLATFORM_DOMAIN: "example.test", MARKETING_HOST: "landing.example.test" })).toBe(true);
  });

  it("extracts the hostname from a header value", () => {
    expect(hostnameOf(undefined)).toBe("localhost");
    expect(hostnameOf("Store.Bcom.Si:3000")).toBe("store.bcom.si");
  });
});
