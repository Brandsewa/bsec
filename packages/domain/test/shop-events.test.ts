import { describe, expect, it } from "vitest";
import { buildBeginCheckoutEvent, buildPurchaseEvent, buildViewItemEvent, serializeShopEvent } from "../src/analytics/shop-events.ts";

describe("shop events", () => {
  it("view_item uses the cheapest variant in major units, with the SKU as the id", () => {
    const e = buildViewItemEvent(
      { title: "Tea", variants: [{ id: "v2", sku: "TEA-100", title: "100g", price: 45_000 }, { id: "v1", sku: "TEA-50", title: "Default Title", price: 25_000 }] },
      "INR",
    );
    expect(e).toEqual({ t: "view_item", currency: "INR", value: 250, items: [{ id: "TEA-50", name: "Tea", variant: undefined, price: 250, quantity: 1 }] });
  });

  it("view_item is skipped for price-on-request products and products without variants", () => {
    expect(buildViewItemEvent({ title: "X", priceOnRequest: true, variants: [{ id: "v", price: 1 }] }, "INR")).toBeNull();
    expect(buildViewItemEvent({ title: "X", variants: [] }, "INR")).toBeNull();
  });

  it("falls back to the variant id when there is no SKU", () => {
    const e = buildViewItemEvent({ title: "Mug", variants: [{ id: "var-1", sku: "  ", title: "Default", price: 1000 }] }, "USD");
    expect(e?.t === "view_item" && e.items[0]?.id).toBe("var-1");
    expect(e?.t === "view_item" && e.items[0]?.variant).toBeUndefined();
  });

  it("begin_checkout totals the cart lines", () => {
    const e = buildBeginCheckoutEvent({
      currency: "USD",
      items: [
        { quantity: 2, unitPriceSnapshot: 1999, product: { title: "A" }, variant: { id: "a", sku: "A1", title: "Large" } },
        { quantity: 1, unitPriceSnapshot: 500, product: { title: "B" }, variant: { id: "b", sku: null, title: null } },
      ],
    });
    expect(e).toMatchObject({ t: "begin_checkout", currency: "USD", value: 44.98 });
    expect(e?.t === "begin_checkout" && e.items.map((i) => i.id)).toEqual(["A1", "b"]);
    expect(buildBeginCheckoutEvent({ currency: "USD", items: [] })).toBeNull();
  });

  it("purchase carries the order number, total and shipping; cancelled orders are not purchases", () => {
    const order = {
      number: "#1042",
      status: "confirmed",
      currency: "INR",
      grandTotal: 129_900,
      shippingTotal: 5_000,
      items: [{ variantId: "v1", sku: "TEA-50", productTitle: "Tea", variantTitle: null, quantity: 2, unitPrice: 62_450 }],
    };
    expect(buildPurchaseEvent(order)).toEqual({
      t: "purchase", currency: "INR", value: 1299, orderId: "#1042", shipping: 50,
      items: [{ id: "TEA-50", name: "Tea", variant: undefined, price: 624.5, quantity: 2 }],
    });
    expect(buildPurchaseEvent({ ...order, status: "cancelled" })).toBeNull();
  });

  it("serialization can never close the script tag", () => {
    const e = buildViewItemEvent({ title: "</script><script>alert(1)</script>", variants: [{ id: "v", price: 100 }] }, "INR")!;
    const out = serializeShopEvent(e);
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).items[0].name).toBe("</script><script>alert(1)</script>");
  });
});
