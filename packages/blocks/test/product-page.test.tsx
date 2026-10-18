import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CollectionGridSchema,
  HeroSliderSchema,
  PRODUCT_ELEMENTS,
  ProductDetailSchema,
  ShowcaseTabSchema,
  isValidLayoutValue,
  layoutStyle,
  normalizeElementOrder,
  renderBlockTree,
  validateBlockDocument,
  type BlockInstance,
} from "../src/index.ts";

const block = (type: BlockInstance["type"], props: Record<string, unknown> = {}): BlockInstance => ({ id: "x", type, version: 1, props });
const render = (blocks: BlockInstance[], base: Record<string, unknown> = {}) => renderToStaticMarkup(<>{renderBlockTree(blocks, base as never)}</>);

describe("product page elements", () => {
  it("keeps the default order when none is saved and repairs a partial or odd saved order", () => {
    expect(normalizeElementOrder(undefined)).toEqual([...PRODUCT_ELEMENTS]);
    expect(normalizeElementOrder([])).toEqual([...PRODUCT_ELEMENTS]);
    const order = normalizeElementOrder(["price", "title", "price", "bogus"]);
    expect(order.slice(0, 2)).toEqual(["price", "title"]);
    expect(order).toHaveLength(PRODUCT_ELEMENTS.length);
    expect(new Set(order).size).toBe(order.length);
  });

  it("validates old documents without the new settings and rejects bad ones", () => {
    expect(validateBlockDocument({ version: 1, blocks: [block("ProductDetail")] }).success).toBe(true);
    expect(ProductDetailSchema.parse({})).toMatchObject({ elementOrder: [], showAccordion: false, accordionItems: [] });
    expect(ProductDetailSchema.safeParse({ elementOrder: ["price", "nope"] }).success).toBe(false);
    expect(ProductDetailSchema.safeParse({ accordionItems: [{ title: "", source: "static" }] }).success).toBe(false);
    expect(ProductDetailSchema.safeParse({ accordionItems: Array.from({ length: 9 }, () => ({ title: "t" })) }).success).toBe(false);
  });

  it("is drawn in the editors with the same settings: options, price note, buttons, accordion rows", () => {
    const html = render([
      block("ProductDetail", {
        variantStyle: "pills",
        priceNote: "Tax extra.",
        showBuyNow: true,
        buyNowLabel: "Buy now",
        showAccordion: true,
        accordionItems: [
          { icon: "clipboard", title: "Tea Description", source: "static", text: "Tasty." },
          { icon: "leaf", title: "Ingredients", source: "custom_field", fieldKey: "ingredients" },
        ],
      }),
    ]);
    expect(html).toContain("Tax extra.");
    expect(html).toContain("Buy now");
    expect(html).toContain("bsb-pd-opt-pill");
    expect(html).toContain("Tea Description");
    expect(html).toContain("ingredients");
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html.match(/<details[^>]*open/g)).toHaveLength(1);
  });

  it("follows the saved order and hides what is switched off", () => {
    const html = render([block("ProductDetail", { elementOrder: ["actions", "price"], showUsps: false, showPaymentImage: false })]);
    expect(html.indexOf("bsb-pd-actions")).toBeLessThan(html.indexOf("bsb-pd-price"));
    expect(html).not.toContain("bsb-pd-usps");
    const off = render([block("ProductDetail", { showBuyNow: false, showAccordion: false })]);
    expect(off).not.toContain("bsb-pd-buy ");
    expect(off).not.toContain("bsb-pd-acc");
  });

  it("hides the accordion when it has no rows", () => {
    expect(render([block("ProductDetail", { showAccordion: true, accordionItems: [] })])).not.toContain("bsb-pd-acc");
  });
});

describe("related products tab", () => {
  it("is a valid Product showcase source", () => {
    expect(ShowcaseTabSchema.parse({ source: "related" }).source).toBe("related");
    expect(ShowcaseTabSchema.safeParse({ source: "random" }).success).toBe(false);
  });
});

describe("collection grid heading position", () => {
  it("defaults to centre (the old look) and follows the setting", () => {
    expect(CollectionGridSchema.parse({ title: "x" }).headerAlign).toBe("center");
    const data = { x: { kind: "collections", collections: [{ slug: "a", title: "A" }] } };
    expect(render([block("CollectionGrid", { title: "Shop", headerAlign: "left" })], { data })).toContain("bsb-align-left");
    expect(render([block("CollectionGrid", { title: "Shop", headerAlign: "right" })], { data })).toContain("bsb-align-right");
    expect(CollectionGridSchema.safeParse({ title: "x", headerAlign: "top" }).success).toBe(false);
  });
});

describe("hero slider on phones and layout radius", () => {
  it("puts the text below the picture by default, with colours as variables, and can keep the overlay", () => {
    expect(HeroSliderSchema.parse({}).mobileLayout).toBe("below");
    const below = render([block("HeroSlider", { mobileTextBg: "#fff7ed", mobileTextColor: "#1f2937" })]);
    expect(below).toContain("bsb-hs-m-below");
    expect(below).toContain("--hs-m-bg:#fff7ed");
    expect(render([block("HeroSlider", { mobileLayout: "overlay" })])).toContain("bsb-hs-m-overlay");
    expect(HeroSliderSchema.safeParse({ mobileTextBg: "orange" }).success).toBe(false);
  });

  it("accepts a border radius per device as a size, not free CSS", () => {
    expect(isValidLayoutValue("radius", "12px")).toBe(true);
    expect(isValidLayoutValue("radius", "50%")).toBe(true);
    expect(isValidLayoutValue("radius", "red")).toBe(false);
    expect(layoutStyle({ desktop: { radius: "16px" }, mobile: { radius: "8px" } })).toMatchObject({ "--l-d-rd": "16px", "--l-m-rd": "8px" });
  });

  it("is full width by default, can be contained, and keeps its own slide corners per device", () => {
    expect(HeroSliderSchema.parse({}).widthMode).toBe("full");
    expect(render([block("HeroSlider")])).toContain("bsb-hs-wm-full");
    expect(render([block("HeroSlider", { widthMode: "contained" })])).toContain("bsb-hs-wm-contained");
    expect(HeroSliderSchema.safeParse({ widthMode: "wide" }).success).toBe(false);
    const html = render([block("HeroSlider", { slideRadius: { desktop: { topLeft: "24px", topRight: "24px" }, mobile: { bottomLeft: "8px" } } })]);
    expect(html).toContain("--sr-d-tl:24px");
    expect(html).toContain("--sr-d-tr:24px");
    expect(html).toContain("--sr-m-bl:8px");
    expect(HeroSliderSchema.safeParse({ slideRadius: { desktop: { topLeft: "red" } } }).success).toBe(false);
    expect(HeroSliderSchema.parse({}).slideRadius).toEqual({ desktop: {}, tablet: {}, mobile: {} });
  });
});
