import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import type { StorefrontCart } from "@bs/domain";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/checkout",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: vi.fn(),
}));

import { BRIDGE_MESSAGE_TYPE, checkoutChallengeMode, parseBridgeMessage, toOrigin } from "../src/lib/turnstile-bridge.ts";
import { GET as frame } from "../src/app/challenge-frame/route.ts";
import { CheckoutForm } from "../src/components/checkout/CheckoutForm.tsx";

const BS = String.fromCharCode(92);
const ORIGIN = "https://bcom.si";

describe("checkoutChallengeMode: which hosts need the bridge", () => {
  it("renders the widget directly only in local development", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "shop.localhost:3000"]) {
      expect(checkoutChallengeMode(host, {})).toEqual({ mode: "direct" });
    }
  });

  it("uses the bridge for every store: platform subdomains and custom domains alike", () => {
    for (const host of ["tasteofhills.bcom.si", "tasteofhills.bcom.si:443", "darjeelinghoney.com", "www.darjeelinghoney.com"]) {
      expect(checkoutChallengeMode(host, {})).toEqual({ mode: "bridge", origin: "https://bcom.si" });
    }
  });

  it("follows PLATFORM_DOMAIN and an explicit CHECKOUT_CHALLENGE_ORIGIN, ignoring a bad one", () => {
    expect(checkoutChallengeMode("shop.example.com", { PLATFORM_DOMAIN: "stores.test" })).toEqual({ mode: "bridge", origin: "https://stores.test" });
    expect(checkoutChallengeMode("shop.example.com", { CHECKOUT_CHALLENGE_ORIGIN: "https://challenge.bcom.si/x" })).toEqual({ mode: "bridge", origin: "https://challenge.bcom.si" });
    expect(checkoutChallengeMode("shop.example.com", { CHECKOUT_CHALLENGE_ORIGIN: "javascript:alert(1)" })).toEqual({ mode: "bridge", origin: "https://bcom.si" });
  });
});

describe("toOrigin", () => {
  it("keeps only an http(s) origin", () => {
    expect(toOrigin("https://shop.example.com/some/path?q=1")).toBe("https://shop.example.com");
    expect(toOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "not a url", "", null, undefined, "ftp://x.test"]) expect(toOrigin(bad)).toBeNull();
  });
});

describe("parseBridgeMessage: the checkout page believes only the frame", () => {
  const ok = (data: unknown) => parseBridgeMessage(data, ORIGIN, ORIGIN, true);

  it("accepts the four message kinds from the frame at the expected origin", () => {
    expect(ok({ type: BRIDGE_MESSAGE_TYPE, kind: "token", token: "abc" })).toEqual({ kind: "token", token: "abc" });
    expect(ok({ type: BRIDGE_MESSAGE_TYPE, kind: "expired" })).toEqual({ kind: "expired" });
    expect(ok({ type: BRIDGE_MESSAGE_TYPE, kind: "failed" })).toEqual({ kind: "failed" });
    expect(ok({ type: BRIDGE_MESSAGE_TYPE, kind: "height", height: 65 })).toEqual({ kind: "height", height: 65 });
  });

  it("ignores a message from another origin or from a window that is not the frame", () => {
    const m = { type: BRIDGE_MESSAGE_TYPE, kind: "token", token: "abc" };
    expect(parseBridgeMessage(m, "https://evil.example", ORIGIN, true)).toBeNull();
    expect(parseBridgeMessage(m, ORIGIN, ORIGIN, false)).toBeNull();
  });

  it("ignores malformed messages and clamps the frame height", () => {
    const bad: unknown[] = [
      null,
      "token",
      5,
      {},
      { type: "other", kind: "token", token: "x" },
      { type: BRIDGE_MESSAGE_TYPE, kind: "token" },
      { type: BRIDGE_MESSAGE_TYPE, kind: "token", token: "" },
      { type: BRIDGE_MESSAGE_TYPE, kind: "token", token: "x".repeat(5000) },
      { type: BRIDGE_MESSAGE_TYPE, kind: "nope" },
      { type: BRIDGE_MESSAGE_TYPE, kind: "height", height: "tall" },
      { type: BRIDGE_MESSAGE_TYPE, kind: "height", height: Number.NaN },
    ];
    for (const b of bad) expect(ok(b)).toBeNull();
    expect(ok({ type: BRIDGE_MESSAGE_TYPE, kind: "height", height: 99999 })).toEqual({ kind: "height", height: 400 });
    expect(ok({ type: BRIDGE_MESSAGE_TYPE, kind: "height", height: -5 })).toEqual({ kind: "height", height: 0 });
  });
});

describe("GET /challenge-frame", () => {
  afterEach(() => vi.unstubAllEnvs());
  const keys = (site = "site-key-public") => {
    vi.stubEnv("TURNSTILE_SITE_KEY", site);
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key-private");
  };
  const get = (qs: string) => frame(new Request(`https://bcom.si/challenge-frame${qs}`));

  it("serves the widget page, posting only to the named parent origin and never to *", async () => {
    keys();
    const res = get("?parent=" + encodeURIComponent("https://darjeelinghoney.com"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBeNull();
    const html = await res.text();
    expect(html).toContain('"https://darjeelinghoney.com"');
    expect(html).toContain('"site-key-public"');
    expect(html).toContain("challenges.cloudflare.com/turnstile/v0/api.js");
    expect(html).not.toContain("secret-key-private");
    expect(html).not.toMatch(/postMessage\([^)]*"\*"/);
  });

  it("answers 404 when the bot check is off or the parent is missing or not an origin", () => {
    keys();
    expect(get("").status).toBe(404);
    expect(get("?parent=javascript:alert(1)").status).toBe(404);
    expect(get("?parent=nonsense").status).toBe(404);
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    expect(get("?parent=" + encodeURIComponent("https://darjeelinghoney.com")).status).toBe(404);
  });

  it("cannot be broken out of the inline script by a hostile key", async () => {
    keys("</script><script>alert(1)</script>");
    const html = await get("?parent=" + encodeURIComponent("https://x.test")).text();
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain(BS + "u003c/script>");
  });
});

describe("CheckoutForm with the bridge", () => {
  const cart = { id: "c", token: "t", currency: "INR", items: [], itemCount: 0, subtotal: 100000, lastActivityAt: "2026-09-29T00:00:00.000Z", createdAt: "2026-09-29T00:00:00.000Z" } as unknown as StorefrontCart;
  const base = {
    cart,
    shippingRates: [{ method: "standard", title: "Standard", description: "3-7 days", estimatedDays: "3-7 days", amount: 9900 }],
    paymentOptions: { codEnabled: true, codFeePaise: 0, onlineAvailable: false },
    consent: { termsRequired: false, marketing: null },
  };

  it("mounts the frame holder, holds the button, and shows no frame before the browser knows its origin", () => {
    const html = renderToString(React.createElement(CheckoutForm, { ...base, turnstileSiteKey: "site-key-public", turnstileBridgeOrigin: ORIGIN }));
    expect(html).toContain("data-turnstile-bridge");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Checking security...");
  });

  it("renders the widget directly when no bridge origin is given (local development)", () => {
    const html = renderToString(React.createElement(CheckoutForm, { ...base, turnstileSiteKey: "site-key-public" }));
    expect(html).not.toContain("data-turnstile-bridge");
    expect(html).toContain("Checking security...");
  });
});
