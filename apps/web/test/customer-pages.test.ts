import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString as render } from "react-dom/server";

const renderToString = (el: React.ReactElement) => render(el).replace(/<!-- -->/g, "");

vi.mock("server-only", () => ({}));
process.env.DATABASE_URL_RW = process.env.DATABASE_URL_RW ?? "postgres://x:y@127.0.0.1:1/none";

// What the "request" looks like: the host and the customer cookie. Tests change these.
const req = { host: "demo.bcom.si", cookie: undefined as string | undefined };

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: req.host }),
  cookies: async () => ({ get: (name: string) => (name === "bs_customer_token" && req.cookie ? { name, value: req.cookie } : undefined) }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/account",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const customer = { id: "c1", phone: "9876543210", email: "9876543210@customer.store", name: "Asha", phoneVerified: true };
const domain = {
  evaluateStorefrontAccess: vi.fn(async (_rt: unknown, host: string) => (host === "unknown.example" ? { tenantId: null } : { tenantId: "tenant-1", mode: "live", allowed: true })),
  checkStorefrontRateLimit: vi.fn(async () => {}),
  getCustomerBySession: vi.fn(async (_db: unknown, _tenant: string, raw?: string) => (raw === "good" ? customer : null)),
  destroyCustomerSession: vi.fn(async () => {}),
  unsubscribeByToken: vi.fn(async (_db: unknown, _t: string, token: string) => token === "unsub_ok"),
  getUnsubscribeView: vi.fn(async (_db: unknown, _t: string, token: string) =>
    token === "unsub_ok" ? { state: "subscribed", maskedEmail: "a***@x.test" } : token === "unsub_done" ? { state: "unsubscribed", maskedEmail: "a***@x.test" } : { state: "invalid" },
  ),
  getAddressUpdateView: vi.fn(async (_db: unknown, _t: string, token: string) =>
    token === "adr_ok"
      ? { orderNumber: "#1001", orderStatus: "confirmed", editable: true, address: { fullName: "Asha", addressLine1: "1 St", city: "Pune", state: "MH", pincode: "411001", country: "IN" } }
      : token === "adr_locked"
        ? { orderNumber: "#1002", orderStatus: "processing", editable: false, address: { fullName: "A", addressLine1: "1", city: "P", state: "M", pincode: "411001", country: "IN" } }
        : null,
  ),
  updateOrderAddressByToken: vi.fn(async (_db: unknown, _t: string, token: string) => {
    if (token === "adr_locked") throw new Error("Precondition: This order has already been handed over for delivery, so the address can no longer be changed");
    if (token !== "adr_ok") throw new Error("Not Found: This link is not valid any more");
    return { fullName: "Asha" };
  }),
  requestCustomerOtp: vi.fn(async () => ({ success: true, expiresAt: new Date("2030-01-01"), devOtp: "123456" })),
  verifyCustomerOtp: vi.fn(async (_db: unknown, _t: string, _phone: string, otp: string) => {
    if (otp !== "123456") throw new Error("Invalid or expired OTP");
    return { success: true, customer, token: "cs_secret_session" };
  }),
  checkCustomerOtpRequestLimit: vi.fn(async () => {}),
  checkCustomerOtpVerifyLimit: vi.fn(async () => {}),
  updateCustomerProfile: vi.fn(async (_db: unknown, _t: string, _c: string, input: { email: string }) => {
    if (input.email === "taken@x.test") throw new Error("Conflict: That email is already used by another account");
    return { ...customer, acceptsMarketing: false, emailIsPlaceholder: false };
  }),
  createCustomerAddress: vi.fn(async (_db: unknown, _t: string, _c: string, input: object) => ({ id: "a1", ...input })),
  updateCustomerAddress: vi.fn(async (_db: unknown, _t: string, _c: string, id: string) => (id === "01a0f000-0000-7000-8000-000000000001" ? { id } : null)),
  deleteCustomerAddress: vi.fn(async (_db: unknown, _t: string, _c: string, id: string) => id === "01a0f000-0000-7000-8000-000000000001"),
  mintOrderViewTokenForCustomer: vi.fn(async (_db: unknown, _t: string, _c: string, id: string) => (id === "01a0f000-0000-7000-8000-000000000001" ? "ord_minted" : null)),
  getCustomerOrders: vi.fn(async () => [
    { id: "01a0f000-0000-7000-8000-000000000001", number: "#1001", status: "confirmed", paymentStatus: "cod_pending", fulfillmentStatus: "unfulfilled", subtotal: 10000, shippingTotal: 0, grandTotal: 10000, placedAt: new Date("2026-09-30T10:00:00Z") },
  ]),
};

vi.mock("@bs/domain", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, ...domain };
});

import { UnsubscribeButton } from "../src/components/account/UnsubscribeButton.tsx";
import { AddressCorrectionForm } from "../src/components/account/AddressCorrectionForm.tsx";
import { LoginForm } from "../src/components/account/LoginForm.tsx";
import { ProfileForm } from "../src/components/account/ProfileForm.tsx";
import { AddressBook } from "../src/components/account/AddressBook.tsx";

const json = (url: string, body: unknown, method = "POST", extra: Record<string, string> = {}) =>
  new Request(url, { method, headers: { host: req.host, "content-type": "application/json", ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
const rawParams = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const ADDR_ID = "01a0f000-0000-7000-8000-000000000001";

beforeEach(() => {
  req.host = "demo.bcom.si";
  req.cookie = undefined;
  vi.clearAllMocks();
});

describe("components", () => {
  it("unsubscribe button waits for a click and shows the done state when already out", () => {
    expect(renderToString(React.createElement(UnsubscribeButton, { token: "t", alreadyDone: false }))).toContain("Unsubscribe</button>");
    expect(renderToString(React.createElement(UnsubscribeButton, { token: "t", alreadyDone: true }))).toContain("You are unsubscribed");
  });

  it("address form starts with the current address", () => {
    const html = renderToString(React.createElement(AddressCorrectionForm, { token: "t", initial: { fullName: "Asha", addressLine1: "1 St", city: "Pune", state: "MH", pincode: "411001" } }));
    expect(html).toContain('value="Asha"');
    expect(html).toContain('value="411001"');
    expect(html).toContain("Update address");
  });

  it("login form begins with the phone number step and never shows a code", () => {
    const html = renderToString(React.createElement(LoginForm));
    expect(html).toContain("Send code");
    expect(html).not.toContain("123456");
  });

  it("profile form shows the phone read-only", () => {
    const html = renderToString(React.createElement(ProfileForm, { phone: "9876543210", name: "Asha", email: "", acceptsMarketing: true }));
    expect(html).toContain("disabled");
    expect(html).toContain("9876543210");
  });

  it("address book lists saved addresses and offers add", () => {
    const html = renderToString(
      React.createElement(AddressBook, {
        phone: "9876543210",
        addresses: [{ id: "a1", name: "Home Asha", phone: "9876543210", line1: "1 St", line2: null, landmark: null, city: "Pune", stateCode: "MH", pincode: "411001", type: "home", isDefault: true }],
      }),
    );
    expect(html).toContain("Home Asha");
    expect(html).toContain("Default");
    expect(html).toContain("Add an address");
  });
});

describe("unsubscribe page and POST", () => {
  const page = async (token: string) => {
    const { default: Page } = await import("../src/app/unsubscribe/[token]/page.tsx");
    return renderToString(await Page(rawParams({ token })));
  };

  it("shows the confirm button for a good link without changing anything", async () => {
    const html = await page("unsub_ok");
    expect(html).toContain("a***@x.test");
    expect(html).toContain("Unsubscribe</button>");
    expect(domain.unsubscribeByToken).not.toHaveBeenCalled();
  });

  it("shows the done state for an already unsubscribed customer and a friendly page for a bad link", async () => {
    expect(await page("unsub_done")).toContain("You are unsubscribed");
    expect(await page("nope")).toContain("not valid or has expired");
  });

  it("404s on an unknown host", async () => {
    req.host = "unknown.example";
    await expect(page("unsub_ok")).rejects.toThrow("NOT_FOUND");
  });

  it("POST unsubscribes, repeats safely, and refuses a bad link or a cross-site post", async () => {
    const { POST } = await import("../src/app/api/storefront/unsubscribe/[token]/route.ts");
    const url = "https://demo.bcom.si/api/storefront/unsubscribe/unsub_ok";
    expect((await POST(json(url, undefined), rawParams({ token: "unsub_ok" }))).status).toBe(200);
    expect((await POST(json(url, undefined), rawParams({ token: "unsub_ok" }))).status).toBe(200);
    const bad = await POST(json(url, undefined), rawParams({ token: "unsub_bad" }));
    expect(bad.status).toBe(404);
    expect((await bad.json()).error).toMatch(/not valid/);
    const cross = await POST(json(url, undefined, "POST", { origin: "https://evil.example" }), rawParams({ token: "unsub_ok" }));
    expect(cross.status).toBe(403);
    expect(domain.unsubscribeByToken).toHaveBeenCalledTimes(3); // the cross-site call never reached the domain
  });
});

describe("address correction page and POST", () => {
  const page = async (token: string) => {
    const { default: Page } = await import("../src/app/address/[token]/page.tsx");
    return renderToString(await Page(rawParams({ token })));
  };
  const body = { fullName: "Asha", addressLine1: "2 New St", city: "Pune", state: "MH", pincode: "411002" };

  it("renders the form, the locked message or the invalid message", async () => {
    expect(await page("adr_ok")).toContain("data-testid=\"address-form\"");
    expect(await page("adr_locked")).toContain("can no longer be changed");
    expect(await page("adr_bad")).toContain("not valid or has expired");
  });

  it("POST saves, validates, and explains a locked or unknown link", async () => {
    const { POST } = await import("../src/app/api/storefront/address/[token]/route.ts");
    const url = (t: string) => `https://demo.bcom.si/api/storefront/address/${t}`;
    expect((await POST(json(url("adr_ok"), body), rawParams({ token: "adr_ok" }))).status).toBe(200);
    expect((await POST(json(url("adr_ok"), { ...body, pincode: "12" }), rawParams({ token: "adr_ok" }))).status).toBe(400);
    const locked = await POST(json(url("adr_locked"), body), rawParams({ token: "adr_locked" }));
    expect(locked.status).toBe(409);
    expect((await locked.json()).error).toMatch(/handed over for delivery/);
    expect((await POST(json(url("adr_bad"), body), rawParams({ token: "adr_bad" }))).status).toBe(404);
    expect((await POST(json(url("adr_ok"), body, "POST", { origin: "https://evil.example" }), rawParams({ token: "adr_ok" }))).status).toBe(403);
  });
});

describe("customer sign-in routes", () => {
  it("never puts the OTP in the response", async () => {
    const { POST } = await import("../src/app/api/storefront/customer/otp/request/route.ts");
    const res = await POST(json("https://demo.bcom.si/api/storefront/customer/otp/request", { phone: "9876543210" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("123456");
    expect(text).not.toContain("devOtp");
  });

  it("verify sets an httpOnly session cookie holding the opaque token", async () => {
    const { POST } = await import("../src/app/api/storefront/customer/otp/verify/route.ts");
    const url = "https://demo.bcom.si/api/storefront/customer/otp/verify";
    const res = await POST(json(url, { phone: "9876543210", otp: "123456" }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("bs_customer_token=cs_secret_session");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(JSON.stringify(await res.json())).not.toContain("cs_secret_session");

    const bad = await POST(json(url, { phone: "9876543210", otp: "000000" }));
    expect(bad.status).toBe(400);
    expect(bad.headers.get("set-cookie")).toBeNull();
    expect((await POST(json(url, { phone: "9876543210", otp: "123456" }, "POST", { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("logout forgets the session and clears the cookie", async () => {
    const { POST } = await import("../src/app/api/storefront/customer/logout/route.ts");
    req.cookie = "good";
    const res = await POST(json("https://demo.bcom.si/api/storefront/customer/logout", undefined));
    expect(res.status).toBe(200);
    expect(domain.destroyCustomerSession).toHaveBeenCalledWith(expect.anything(), "tenant-1", "good");
    expect(res.headers.get("set-cookie")).toMatch(/bs_customer_token=;/);
  });
});

describe("signed-in account endpoints", () => {
  it("refuse a visitor with no or a forged session", async () => {
    const { PUT } = await import("../src/app/api/storefront/customer/profile/route.ts");
    const url = "https://demo.bcom.si/api/storefront/customer/profile";
    const body = { name: "A", email: "a@x.test", acceptsMarketing: false };
    expect((await PUT(json(url, body, "PUT"))).status).toBe(401);
    req.cookie = "forged";
    expect((await PUT(json(url, body, "PUT"))).status).toBe(401);
    expect(domain.updateCustomerProfile).not.toHaveBeenCalled();
  });

  it("save the profile, and turn a duplicate email into a readable 409", async () => {
    const { PUT } = await import("../src/app/api/storefront/customer/profile/route.ts");
    const url = "https://demo.bcom.si/api/storefront/customer/profile";
    req.cookie = "good";
    expect((await PUT(json(url, { name: "A", email: "a@x.test", acceptsMarketing: true }, "PUT"))).status).toBe(200);
    const dup = await PUT(json(url, { name: "A", email: "taken@x.test", acceptsMarketing: true }, "PUT"));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatch(/already used/);
    expect((await PUT(json(url, { name: "A", email: "bad", acceptsMarketing: true }, "PUT"))).status).toBe(400);
  });

  it("manage saved addresses for the signed-in customer only", async () => {
    const list = await import("../src/app/api/storefront/customer/addresses/route.ts");
    const one = await import("../src/app/api/storefront/customer/addresses/[id]/route.ts");
    const addr = { name: "Asha", phone: "9876543210", line1: "1 St", city: "Pune", stateCode: "MH", pincode: "411001" };
    const base = "https://demo.bcom.si/api/storefront/customer/addresses";

    expect((await list.POST(json(base, addr))).status).toBe(401);
    req.cookie = "good";
    expect((await list.POST(json(base, addr))).status).toBe(200);
    expect((await list.POST(json(base, { ...addr, pincode: "1" }))).status).toBe(400);
    expect((await one.PUT(json(`${base}/${ADDR_ID}`, addr, "PUT"), rawParams({ id: ADDR_ID }))).status).toBe(200);
    // someone else's (or unknown) address id
    expect((await one.PUT(json(`${base}/01a0f000-0000-7000-8000-0000000000ff`, addr, "PUT"), rawParams({ id: "01a0f000-0000-7000-8000-0000000000ff" }))).status).toBe(404);
    expect((await one.DELETE(json(`${base}/not-a-uuid`, undefined, "DELETE"), rawParams({ id: "not-a-uuid" }))).status).toBe(404);
    expect((await one.DELETE(json(`${base}/${ADDR_ID}`, undefined, "DELETE"), rawParams({ id: ADDR_ID }))).status).toBe(200);
  });

  it("order tracking redirect mints a link only for the customer's own order", async () => {
    const { GET } = await import("../src/app/account/orders/[id]/track/route.ts");
    const get = () => new Request(`https://demo.bcom.si/account/orders/${ADDR_ID}/track`, { headers: { host: req.host } });
    // signed out: back to sign-in, nothing minted
    let res = await GET(get(), rawParams({ id: ADDR_ID }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account");
    expect(domain.mintOrderViewTokenForCustomer).not.toHaveBeenCalled();

    req.cookie = "good";
    res = await GET(get(), rawParams({ id: ADDR_ID }));
    expect(res.headers.get("location")).toBe("/o/ord_minted");
    expect(res.headers.get("cache-control")).toBe("no-store");
    res = await GET(get(), rawParams({ id: "01a0f000-0000-7000-8000-0000000000ff" }));
    expect(res.headers.get("location")).toBe("/account");
  });
});

describe("account pages", () => {
  it("list the customer's orders with a link to each", async () => {
    req.cookie = "good";
    const { default: Page } = await import("../src/app/account/page.tsx");
    const html = renderToString(await Page());
    expect(html).toContain("#1001");
    expect(html).toContain(`/account/orders/${ADDR_ID}`);
    expect(html).toContain("₹100.00");
  });

  it("render nothing without a session (the layout shows sign-in instead)", async () => {
    const { default: Page } = await import("../src/app/account/page.tsx");
    expect(await Page()).toBeNull();
    expect(domain.getCustomerOrders).not.toHaveBeenCalled();
  });
});
