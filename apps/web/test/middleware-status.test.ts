import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock evaluateStorefrontAccess
const mockEvaluateStorefrontAccess = vi.fn();

// Mock global fetch for middleware status evaluation
globalThis.fetch = vi.fn(async (url: unknown) => {
  const urlStr = String(url);
  if (urlStr.includes("/api/storefront/status/evaluate")) {
    const data = await mockEvaluateStorefrontAccess();
    return {
      ok: true,
      status: 200,
      json: async () => data,
    } as unknown as Response;
  }
  return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
});

import { middleware } from "../src/middleware.ts";

describe("Storefront Status Middleware (PLAN §8.2, §8.3 & M3 Status Pipeline)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns HTTP 503 with Retry-After and X-Robots-Tag headers during maintenance mode", async () => {
    mockEvaluateStorefrontAccess.mockResolvedValueOnce({
      allowed: false,
      httpStatus: 503,
      reason: "maintenance",
      mode: "maintenance",
      tenantId: "t-1",
      retryAfterSeconds: 7200,
      noindex: true,
      message: "Scheduled system upgrade in progress.",
    });

    const req = new NextRequest("https://mystore.test.com/", {
      headers: { host: "mystore.test.com" },
    });

    const res = await middleware(req);

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("7200");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const bodyText = await res.text();
    expect(bodyText).toContain("Store Maintenance");
    expect(bodyText).toContain("Scheduled system upgrade in progress.");
  });

  it("does not apply the storefront gate to admin API, staff sign-in, webhooks or CORS preflights", async () => {
    // Even if the host would be blocked as a storefront (maintenance / unknown), these must pass through.
    mockEvaluateStorefrontAccess.mockResolvedValue({ allowed: false, httpStatus: 404, reason: "not_found" });
    const cases: Array<[string, string]> = [
      ["POST", "https://platform-root.test/api/rpc/admin/orders/list"],
      ["POST", "https://platform-root.test/api/auth/sign-in/email"],
      ["POST", "https://platform-root.test/api/webhooks/razorpay"],
      ["GET", "https://platform-root.test/api/admin/orders"],
      ["OPTIONS", "https://platform-root.test/api/rpc/admin/me/get"],
    ];
    for (const [method, url] of cases) {
      const res = await middleware(new NextRequest(url, { method, headers: { host: "platform-root.test" } }));
      expect(res.status, `${method} ${url}`).toBe(200);
    }
    // ...while an ordinary storefront request on the same unknown host is still blocked.
    const blocked = await middleware(new NextRequest("https://platform-root.test/products", { headers: { host: "platform-root.test" } }));
    expect(blocked.status).toBe(404);
    mockEvaluateStorefrontAccess.mockReset();
  });

  it("returns HTTP 503 during tenant provisioning", async () => {
    mockEvaluateStorefrontAccess.mockResolvedValueOnce({
      allowed: false,
      httpStatus: 503,
      reason: "provisioning",
      tenantId: "t-1",
      tenantStatus: "provisioning",
      noindex: true,
      message: "Store is being provisioned",
    });

    const req = new NextRequest("https://mystore.test.com/", {
      headers: { host: "mystore.test.com" },
    });

    const res = await middleware(req);

    expect(res.status).toBe(503);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const bodyText = await res.text();
    expect(bodyText).toContain("Store is being provisioned");
  });

  it("returns HTTP 404 for archived, deleted, or unmapped tenant hosts", async () => {
    mockEvaluateStorefrontAccess.mockResolvedValueOnce({
      allowed: false,
      httpStatus: 404,
      reason: "not_found",
      tenantStatus: "deleted",
      noindex: true,
    });

    const req = new NextRequest("https://deleted-store.test.com/", {
      headers: { host: "deleted-store.test.com" },
    });

    const res = await middleware(req);

    expect(res.status).toBe(404);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const bodyText = await res.text();
    expect(bodyText).toBe("Store Not Found");
  });

  it("sets X-Robots-Tag: noindex, nofollow and renders page (HTTP 200) for coming_soon mode", async () => {
    mockEvaluateStorefrontAccess.mockResolvedValueOnce({
      allowed: false,
      httpStatus: 200,
      mode: "coming_soon",
      reason: "coming_soon",
      tenantId: "t-1",
      noindex: true,
      headline: "Grand Opening Soon",
    });

    const req = new NextRequest("https://mystore.test.com/", {
      headers: { host: "mystore.test.com" },
    });

    const res = await middleware(req);

    // NextResponse.next() defaults to status 200
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("sets X-Robots-Tag: noindex, nofollow for password-protected store", async () => {
    mockEvaluateStorefrontAccess.mockResolvedValueOnce({
      allowed: false,
      httpStatus: 200,
      mode: "password",
      reason: "password_required",
      tenantId: "t-1",
      noindex: true,
    });

    const req = new NextRequest("https://mystore.test.com/products/pro-keyboard", {
      headers: { host: "mystore.test.com" },
    });

    const res = await middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("permits normal live store traffic without noindex header when indexing is enabled", async () => {
    mockEvaluateStorefrontAccess.mockResolvedValueOnce({
      allowed: true,
      httpStatus: 200,
      mode: "live",
      tenantId: "t-1",
      noindex: false,
    });

    const req = new NextRequest("https://mystore.test.com/products/pro-keyboard", {
      headers: { host: "mystore.test.com" },
    });

    const res = await middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("permits staff or preview token bypass to view maintenance store", async () => {
    mockEvaluateStorefrontAccess.mockResolvedValueOnce({
      allowed: true,
      httpStatus: 200,
      mode: "maintenance",
      tenantId: "t-1",
      isBypass: true,
      noindex: true,
    });

    const req = new NextRequest("https://mystore.test.com/?preview_token=valid_token", {
      headers: { host: "mystore.test.com" },
    });

    const res = await middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("fails open and permits traffic if evaluation route times out or encounters network error", async () => {
    mockEvaluateStorefrontAccess.mockRejectedValueOnce(new Error("Timeout waiting for response"));

    const req = new NextRequest("https://mystore.test.com/products/pro-keyboard", {
      headers: { host: "mystore.test.com" },
    });

    const res = await middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });
});
