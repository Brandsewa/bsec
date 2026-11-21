import { afterEach, describe, expect, it, vi } from "vitest";
import { getCheckoutTurnstileSiteKey, verifyCheckoutChallenge } from "../src/saas/abuse-protection.ts";

const keys = () => {
  vi.stubEnv("TURNSTILE_SITE_KEY", "site-key-public");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key-private");
};

describe("Checkout bot check (audit A3-04)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is off, and never blocks checkout, unless BOTH keys are set", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(getCheckoutTurnstileSiteKey()).toBeNull();
    expect(await verifyCheckoutChallenge(undefined)).toEqual({ ok: true, skipped: true });

    vi.stubEnv("TURNSTILE_SITE_KEY", "site-only");
    expect(getCheckoutTurnstileSiteKey()).toBeNull();
    expect(await verifyCheckoutChallenge(undefined)).toMatchObject({ ok: true, skipped: true });

    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-only");
    expect(getCheckoutTurnstileSiteKey()).toBeNull();
  });

  it("returns only the public site key when both keys are set", () => {
    keys();
    expect(getCheckoutTurnstileSiteKey()).toBe("site-key-public");
  });

  it("refuses a missing or empty token without calling Cloudflare", async () => {
    keys();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await verifyCheckoutChallenge(undefined)).ok).toBe(false);
    expect((await verifyCheckoutChallenge("   ")).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never accepts the non-production bypass tokens that signup allows", async () => {
    keys();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    expect((await verifyCheckoutChallenge("test-bypass")).ok).toBe(false);
    expect((await verifyCheckoutChallenge("cf-turnstile-bypass")).ok).toBe(false);
  });

  it("accepts a token Cloudflare confirms and sends the secret, token and IP", async () => {
    keys();
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body);
      expect(body).toContain("secret=secret-key-private");
      expect(body).toContain("response=tok123");
      expect(body).toContain("remoteip=203.0.113.9");
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verifyCheckoutChallenge("tok123", "203.0.113.9")).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses a token Cloudflare rejects (expired, reused or forged)", async () => {
    keys();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }), { status: 200 })));
    const res = await verifyCheckoutChallenge("reused-token");
    expect(res.ok).toBe(false);
    expect(res.unreachable).toBeUndefined();
  });

  it("refuses a 4xx answer from Cloudflare", async () => {
    keys();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    expect((await verifyCheckoutChallenge("tok")).ok).toBe(false);
  });

  it("lets the order through when Cloudflare cannot be reached (network error, timeout, 5xx)", async () => {
    keys();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await verifyCheckoutChallenge("tok")).toEqual({ ok: true, unreachable: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 503 })));
    expect(await verifyCheckoutChallenge("tok")).toEqual({ ok: true, unreachable: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not let an unreachable Cloudflare excuse a MISSING token", async () => {
    keys();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect((await verifyCheckoutChallenge(undefined)).ok).toBe(false);
  });
});
