import { afterEach, describe, expect, it } from "vitest";
import { getClientIp } from "../src/system/rate-limit.ts";

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

  it("trusts CF-Connecting-IP ONLY when TRUST_CLOUDFLARE=true is explicitly set", () => {
    process.env.TRUST_CLOUDFLARE = "true";

    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.195",
      "x-forwarded-for": "198.51.100.5",
    });

    const ip = getClientIp(headers);
    expect(ip).toBe("203.0.113.195");
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
