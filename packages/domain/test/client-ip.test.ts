import { afterEach, describe, expect, it } from "vitest";
import { getClientIp } from "../src/system/rate-limit.ts";
import { isCloudflareAddress } from "../src/system/cloudflare-ips.ts";

describe("Reverse Proxy Client IP Hop Parsing (PLAN §14 / M7)", () => {
  const originalEnv = process.env.TRUST_CLOUDFLARE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TRUST_CLOUDFLARE;
    } else {
      process.env.TRUST_CLOUDFLARE = originalEnv;
    }
  });

  it("ignores spoofed CF-Connecting-IP when TRUST_CLOUDFLARE is not enabled", () => {
    delete process.env.TRUST_CLOUDFLARE;

    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.195", // attacker spoofed header directly to origin
      "x-forwarded-for": "198.51.100.5",
    });

    const ip = getClientIp(headers);
    expect(ip).toBe("198.51.100.5");
  });

  it("trusts CF-Connecting-IP only with TRUST_CLOUDFLARE=true AND a Cloudflare peer", () => {
    process.env.TRUST_CLOUDFLARE = "true";

    // Traefik saw the connection come from a Cloudflare edge address (last hop), Cloudflare says who the visitor is.
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.195",
      "x-forwarded-for": "172.69.10.20",
    });

    expect(getClientIp(headers)).toBe("203.0.113.195");
  });

  it("SECURITY: ignores a forged CF-Connecting-IP from a direct-to-origin caller even with the flag on", () => {
    process.env.TRUST_CLOUDFLARE = "true";

    // The caller bypassed Cloudflare: the proxy recorded their own address, so the header they typed is not believed.
    const headers = new Headers({
      "cf-connecting-ip": "1.2.3.4",
      "x-forwarded-for": "198.51.100.5",
    });

    expect(getClientIp(headers)).toBe("198.51.100.5");
  });

  it("SECURITY: a forged Cloudflare-looking hop earlier in the chain does not unlock the header", () => {
    process.env.TRUST_CLOUDFLARE = "true";

    // Only the LAST hop is the real peer; an earlier hop is client-supplied.
    const headers = new Headers({
      "cf-connecting-ip": "1.2.3.4",
      "x-forwarded-for": "172.69.10.20, 198.51.100.5",
    });

    expect(getClientIp(headers)).toBe("198.51.100.5");
  });

  it("works for an IPv6 Cloudflare peer and ignores a malformed CF-Connecting-IP", () => {
    process.env.TRUST_CLOUDFLARE = "true";

    expect(
      getClientIp(new Headers({ "cf-connecting-ip": "2001:db8::7", "x-forwarded-for": "2606:4700:3030::6815:3baf" })),
    ).toBe("2001:db8::7");
    expect(
      getClientIp(new Headers({ "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "172.69.10.20" })),
    ).toBe("172.69.10.20");
  });

  it("ignores CF-Connecting-IP from a Cloudflare peer when the flag is off", () => {
    delete process.env.TRUST_CLOUDFLARE;

    const headers = new Headers({ "cf-connecting-ip": "203.0.113.195", "x-forwarded-for": "172.69.10.20" });
    expect(getClientIp(headers)).toBe("172.69.10.20");
  });

  it("takes the last untrusted hop from multiple X-Forwarded-For hops", () => {
    delete process.env.TRUST_CLOUDFLARE;

    // e.g. client sent X-Forwarded-For: 1.1.1.1, upstream proxy appended 198.51.100.25
    const headers = new Headers({
      "x-forwarded-for": "1.1.1.1, 10.0.0.1, 198.51.100.25",
    });

    const ip = getClientIp(headers);
    expect(ip).toBe("198.51.100.25");
  });

  it("falls back to X-Real-IP if X-Forwarded-For is absent", () => {
    delete process.env.TRUST_CLOUDFLARE;

    const headers = new Headers({
      "x-real-ip": "192.0.2.42",
    });

    const ip = getClientIp(headers);
    expect(ip).toBe("192.0.2.42");
  });

  it("falls back to 127.0.0.1 when no forwarding headers are present", () => {
    delete process.env.TRUST_CLOUDFLARE;

    const headers = new Headers();
    const ip = getClientIp(headers);
    expect(ip).toBe("127.0.0.1");
  });

  it("handles plain record dictionary objects as headers", () => {
    delete process.env.TRUST_CLOUDFLARE;

    const headers = {
      "x-forwarded-for": "10.0.0.5, 203.0.113.50",
    };

    const ip = getClientIp(headers);
    expect(ip).toBe("203.0.113.50");
  });
});

describe("isCloudflareAddress", () => {
  it.each(["173.245.48.1", "104.16.0.1", "104.23.255.254", "172.64.0.1", "2606:4700::1", "::ffff:104.16.0.1"])(
    "recognises %s",
    (ip) => expect(isCloudflareAddress(ip)).toBe(true),
  );
  it.each(["198.51.100.5", "104.32.0.1", "172.63.255.255", "10.0.0.1", "2001:db8::1", "garbage", ""])(
    "rejects %s",
    (ip) => expect(isCloudflareAddress(ip)).toBe(false),
  );
});
