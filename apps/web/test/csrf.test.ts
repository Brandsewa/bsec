import { describe, expect, it } from "vitest";
import { isForbiddenStaffOrigin } from "../src/server/csrf.ts";

const allowed = ["https://admin.bcom.si"];
const base = { method: "POST", path: "/api/rpc/admin/orders", cookie: "bs-staff=abc", origin: "https://evil.example", allowedOrigins: allowed };

describe("staff CSRF guard", () => {
  it("refuses a state-changing staff request from an origin that is not allowed", () => {
    expect(isForbiddenStaffOrigin(base)).toBe(true);
  });

  it("allows the admin's own origin, and safe methods", () => {
    expect(isForbiddenStaffOrigin({ ...base, origin: "https://admin.bcom.si" })).toBe(false);
    expect(isForbiddenStaffOrigin({ ...base, method: "GET" })).toBe(false);
    expect(isForbiddenStaffOrigin({ ...base, method: "OPTIONS" })).toBe(false);
  });

  it("does not apply without a staff cookie", () => {
    expect(isForbiddenStaffOrigin({ ...base, cookie: "other=1" })).toBe(false);
    expect(isForbiddenStaffOrigin({ ...base, cookie: undefined })).toBe(false);
  });

  it("does not block the public storefront API for a signed-in store owner browsing their own shop", () => {
    // the admin cookie rides along to <store>.bcom.si; the quote form must still go through
    expect(isForbiddenStaffOrigin({ ...base, path: "/api/storefront/quotes", origin: "https://tasteofhills.bcom.si" })).toBe(false);
    expect(isForbiddenStaffOrigin({ ...base, path: "/api/storefront/cart", origin: "https://tasteofhills.bcom.si" })).toBe(false);
  });

  it("still guards the staff API when the origin looks like a store", () => {
    expect(isForbiddenStaffOrigin({ ...base, origin: "https://tasteofhills.bcom.si" })).toBe(true);
  });
});
