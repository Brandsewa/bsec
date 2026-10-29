import { describe, it, expect } from "vitest";
import { getBlockDefinition, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const block = (id: string, type: BlockInstance["type"], props: Record<string, unknown> = {}): BlockInstance => ({ id, type, version: 1, props });

describe("product page settings", () => {
  const parse = (type: "ProductDetail", props: Record<string, unknown>) => {
    const r = validateBlockDocument({ version: 1, blocks: [block("p", type, props)] });
    return r.success ? r.data.blocks[0]?.props : null;
  };

  it("keeps product pages saved before the new settings looking as they did", () => {
    expect(parse("ProductDetail", {})).toMatchObject({
      thumbPosition: "bottom",
      showReadMore: false,
      variantStyle: "buttons",
      priceNote: "",
      showBuyNow: false,
      showPaymentImage: false,
      showDeliveryEstimate: false,
      showUsps: false,
    });
  });

  it("gives a newly added product block the new layout", () => {
    expect(getBlockDefinition("ProductDetail").defaultProps).toMatchObject({
      thumbPosition: "left",
      showReadMore: true,
      variantStyle: "pills",
      showBuyNow: true,
      showPaymentImage: true,
      showDeliveryEstimate: true,
      showUsps: true,
    });
  });

  it("accepts the choices and rejects bad colours, hours, icons and too many cards", () => {
    expect(parse("ProductDetail", { thumbPosition: "right", variantStyle: "dropdown", addToCartBg: "#1f3a5f", cutoffHour: 17, usps: [{ icon: "truck", text: "Free delivery" }] })).toMatchObject({
      thumbPosition: "right",
      variantStyle: "dropdown",
    });
    const bad: Array<Record<string, unknown>> = [
      { thumbPosition: "top" },
      { variantStyle: "swatch" },
      { addToCartBg: "red" },
      { addToCartBg: "url(javascript:1)" },
      { cutoffHour: 24 },
      { deliveryDays: 0 },
      { usps: [{ icon: "rocket", text: "x" }] },
      { usps: Array.from({ length: 5 }, () => ({ icon: "check", text: "x" })) },
      { priceNote: "x".repeat(81) },
    ];
    for (const props of bad) expect(parse("ProductDetail", props), JSON.stringify(props)).toBeNull();
  });
});

describe("retired product tabs block", () => {
  it("is dropped from a saved page instead of failing it", () => {
    const r = validateBlockDocument({
      version: 1,
      blocks: [{ id: "a", type: "ProductInfoTabs", version: 1, props: {} }, block("b", "ProductDetail")],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.blocks.map((b) => b.type)).toEqual(["ProductDetail"]);
  });
});
