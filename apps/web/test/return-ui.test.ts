import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString as render } from "react-dom/server";

const renderToString = (el: React.ReactElement) => render(el).replace(/<!-- -->/g, "");

vi.mock("server-only", () => ({}));
process.env.DATABASE_URL_RW = process.env.DATABASE_URL_RW ?? "postgres://x:y@127.0.0.1:1/none";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/o/tok",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: vi.fn(),
}));

const requestReturnByToken = vi.fn(async (_rt: unknown, _ctx: unknown, input: { reason: string }) => {
  if (input.reason === "late") throw new Error("Precondition: The 7-day return window has passed");
  return { returnId: "r1", number: "RET-0001" };
});

vi.mock("@bs/domain", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    evaluateStorefrontAccess: vi.fn(async () => ({ tenantId: "tenant-test-1", mode: "live", allowed: true })),
    checkStorefrontRateLimit: vi.fn(async () => {}),
    requestReturnByToken,
  };
});

import { ReturnRequestForm } from "../src/components/orders/ReturnRequestForm.tsx";

describe("return request form", () => {
  it("shows nothing when no item can be returned", () => {
    expect(renderToString(React.createElement(ReturnRequestForm, { token: "t", items: [{ id: "i", title: "Pickle", variant: null, returnable: 0 }] }))).toBe("");
  });

  it("offers the button when something can be returned", () => {
    expect(renderToString(React.createElement(ReturnRequestForm, { token: "t", items: [{ id: "i", title: "Pickle", variant: null, returnable: 2 }] }))).toContain("Request a return");
  });
});

describe("POST /api/storefront/orders/[token]/return", () => {
  const url = "https://demo.gobs.cloud/api/storefront/orders/tok/return";
  const post = async (body: unknown) => {
    const { POST } = await import("../src/app/api/storefront/orders/[token]/return/route.ts");
    return POST(new Request(url, { method: "POST", headers: { host: "demo.gobs.cloud", "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ token: "tok" }),
    });
  };
  const item = { orderItemId: "01a0f000-0000-7000-8000-000000000001", quantity: 1 };

  it("accepts a request and returns the return number", async () => {
    const res = await post({ reason: "arrived broken", items: [item] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ number: "RET-0001" });
  });

  it("rejects missing reason or items before touching the database", async () => {
    expect((await post({ reason: "", items: [item] })).status).toBe(400);
    expect((await post({ reason: "arrived broken", items: [] })).status).toBe(400);
  });

  it("explains a business refusal without the internal prefix", async () => {
    const res = await post({ reason: "late", items: [item] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("The 7-day return window has passed");
  });
});
