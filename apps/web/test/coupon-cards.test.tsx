import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

import { CouponCards } from "../src/components/product/CouponCards.tsx";

const coupons = [
  { code: "DEMOWELCOME10", title: "Welcome 10% off", benefit: "10% off", condition: "", endsAt: "2027-10-28T12:00:00.000Z" },
  { code: "DEMOFLAT200", title: "Flat ₹200 off", benefit: "₹200 off", condition: "On orders over ₹999", endsAt: null },
];
const html = () => renderToStaticMarkup(<CouponCards coupons={coupons} title="Offers" showCount={2} showViewAll={false} viewAllLabel="" />);

describe("coupon cards", () => {
  it("shows two cards per row on every screen size", () => {
    const h = html();
    expect(h).toContain("grid grid-cols-2 gap-2");
    expect(h).not.toContain("grid-cols-1");
    expect(h).not.toContain("sm:grid-cols-2");
  });

  it("puts what it gives on the left and the end date on the right of row 1, then the description, then the code and Copy", () => {
    const h = html();
    const first = h.slice(h.indexOf("10% off"));
    expect(first.indexOf("10% off")).toBeLessThan(first.indexOf("Ends 28 Oct 2027"));
    expect(first.indexOf("Ends 28 Oct 2027")).toBeLessThan(first.indexOf("Welcome 10% off"));
    expect(first.indexOf("Welcome 10% off")).toBeLessThan(first.indexOf("DEMOWELCOME10"));
    expect(first.indexOf("DEMOWELCOME10")).toBeLessThan(first.indexOf("Copy"));
  });

  it("joins the title and the minimum-order condition into one description, and shows no end date when there is none", () => {
    const h = html();
    expect(h).toContain("Flat ₹200 off · On orders over ₹999");
    expect(h.match(/Ends /g)?.length).toBe(1);
  });
});
