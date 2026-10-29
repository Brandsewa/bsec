import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

vi.mock("server-only", () => ({}));

import { estimateDelivery } from "../src/components/product/DeliveryEstimate.tsx";
import { ProductDescription } from "../src/components/product/ProductDescription.tsx";
import { ProductGallery } from "../src/components/product/ProductGallery.tsx";
import { ProductBuyProvider, VariantOptions, PriceBlock, PurchaseActions, SkuLine } from "../src/components/product/VariantSelector.tsx";
import { descriptionText, paragraphs } from "../src/lib/description-text.ts";
import type { StorefrontProductDetail } from "@bs/domain";

// 2026-10-15 is a Thursday. 09:00 and 15:00 India time are 03:30 and 09:30 UTC.
const IST_9AM = new Date("2026-10-15T03:30:00Z");
const IST_3PM = new Date("2026-10-15T09:30:00Z");

describe("delivery estimate", () => {
  it("before the cut-off the order ships today: Thursday plus three days skips Sunday and arrives Monday", () => {
    const e = estimateDelivery(IST_9AM, 14, 3, "Asia/Kolkata");
    expect(e.arrives).toBe("Mon 19 Oct");
    expect(e.countdown).toBe("5 hrs");
  });

  it("after the cut-off the order ships tomorrow, so it arrives a day later, and the countdown runs to tomorrow's cut-off", () => {
    const e = estimateDelivery(IST_3PM, 14, 3, "Asia/Kolkata");
    expect(e.arrives).toBe("Tue 20 Oct");
    expect(e.countdown).toBe("23 hrs");
  });

  it("follows the store's clock, not the shopper's, and falls back for an unknown time zone", () => {
    const utcEvening = new Date("2026-10-14T20:00:00Z"); // already Thursday 01:30 in India
    expect(estimateDelivery(utcEvening, 14, 1, "Asia/Kolkata").arrives).toBe("Fri 16 Oct");
    expect(estimateDelivery(IST_9AM, 14, 3, "Mars/Olympus").arrives).toBe("Mon 19 Oct");
  });

  it("never dispatches or delivers on a Sunday", () => {
    const saturdayAfterCutoff = new Date("2026-10-17T09:30:00Z"); // Saturday 15:00 IST
    expect(estimateDelivery(saturdayAfterCutoff, 14, 1, "Asia/Kolkata").arrives).toBe("Tue 20 Oct");
  });
});

describe("description helpers", () => {
  it("reads the admin's description shape and plain strings", () => {
    expect(descriptionText({ type: "text", text: "  Hello  " })).toBe("Hello");
    expect(descriptionText("Plain")).toBe("Plain");
    expect(descriptionText(null)).toBe("");
    expect(paragraphs("One\n\nTwo\nstill two\n\n\n")).toEqual(["One", "Two\nstill two"]);
  });
});

describe("short description with Read more", () => {
  it("shows the whole text when clamping is off, and two lines with a Read more link when the full description is longer", () => {
    expect(render(React.createElement(ProductDescription, { title: "T", short: "Short text", full: "", clamp: false }))).not.toContain("line-clamp-2");
    const clamped = render(React.createElement(ProductDescription, { title: "T", short: "Short text", full: "A much longer description", clamp: true }));
    expect(clamped).toContain("line-clamp-2");
    expect(clamped).toContain("Read more");
  });

  it("renders nothing without any description and no link when there is nothing more to read", () => {
    expect(render(React.createElement(ProductDescription, { title: "T", short: "", full: "", clamp: true }))).toBe("");
    expect(render(React.createElement(ProductDescription, { title: "T", short: "Same", full: "Same", clamp: true }))).not.toContain("Read more");
  });
});

describe("gallery thumbnail placement", () => {
  const media = ["a", "b", "c"].map((id, i) => ({ id, productId: "p", mediaId: id, position: i, alt: `Pic ${id}`, kind: "image" as const, url: `https://img.test/${id}.jpg` }));

  it("lays thumbnails out below, left or right, with arrows to move through them", () => {
    expect(render(React.createElement(ProductGallery, { media, title: "T" }))).not.toContain("lg:flex-row");
    expect(render(React.createElement(ProductGallery, { media, title: "T", thumbPosition: "left" }))).toContain("lg:flex-row");
    expect(render(React.createElement(ProductGallery, { media, title: "T", thumbPosition: "right" }))).toContain("lg:flex-row-reverse");
    const many = [...media, { ...media[0]!, id: "d", mediaId: "d" }, { ...media[0]!, id: "e", mediaId: "e" }];
    expect(render(React.createElement(ProductGallery, { media: many, title: "T" }))).toContain("Next thumbnails");
    expect(render(React.createElement(ProductGallery, { media: [media[0]!], title: "T" }))).not.toContain("Next picture");
  });
});

const product = {
  id: "p1",
  title: "Hoodie",
  slug: "hoodie",
  priceOnRequest: false,
  media: [],
  tags: [],
  descriptionJson: null,
  shortDescription: null,
  ratingAvg: "0.00",
  ratingCount: 0,
  options: [{ id: "o1", productId: "p1", name: "Size", position: 0, values: ["S", "M"] }],
  variants: [
    { id: "v1", sku: "H-S", title: "S", optionValues: { Size: "S" }, price: 100000, compareAtPrice: 150000, stockStatus: "in_stock", availableQuantity: 9 },
    { id: "v2", sku: "H-M", title: "M", optionValues: { Size: "M" }, price: 100000, stockStatus: "out_of_stock", availableQuantity: 0 },
  ],
} as unknown as StorefrontProductDetail;

describe("buy box pieces", () => {
  const wrap = (child: React.ReactElement) => render(React.createElement(ProductBuyProvider, { product }, child));

  it("shows options as small pills or as a dropdown, marking the sold-out one", () => {
    const pills = wrap(React.createElement(VariantOptions, { style: "pills" }));
    expect(pills).toContain("rounded-full");
    expect(pills).toContain("line-through"); // M is sold out
    const dropdown = wrap(React.createElement(VariantOptions, { style: "dropdown" }));
    expect(dropdown).toContain("<select");
    expect(dropdown).toContain("M (sold out)");
  });

  it("shows price, saving and the small note under it, and the SKU of the chosen variant", () => {
    const html = wrap(React.createElement(PriceBlock, { note: "Tax and shipping calculated at checkout." }));
    expect(html).toContain("₹1,000");
    expect(html).toContain("Save 33%");
    expect(html).toContain("Tax and shipping calculated at checkout.");
    expect(wrap(React.createElement(PriceBlock, {}))).not.toContain("Tax and shipping");
    expect(wrap(React.createElement(SkuLine))).toContain("H-S");
  });

  it("puts quantity and Add to cart in one row with Buy it now below, using the theme's labels and colours", () => {
    const html = wrap(React.createElement(PurchaseActions, { showBuyNow: true, addToCartLabel: "Add to bag", buyNowLabel: "Buy now", addToCartBg: "#112233", addToCartText: "#ffffff", buyNowBg: "#ff0000" }));
    expect(html).toContain("Add to bag");
    expect(html).toContain("Buy now");
    expect(html).toContain("background-color:#112233");
    expect(html).toContain("background-color:#ff0000");
    expect(html.indexOf("Add to bag")).toBeLessThan(html.indexOf("Buy now"));
    expect(wrap(React.createElement(PurchaseActions, {}))).not.toContain("Buy it now");
  });
});

import { ProductDetailSection } from "../src/components/product/ProductDetailSection.tsx";

describe("product page highlight cards and payment picture", () => {
  const html = render(React.createElement(ProductDetailSection, { product }));

  it("draws each highlight card with a bare icon, a bold title and a short description, in a row that slides on phones", () => {
    expect(html).toContain('data-testid="product-usps"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("Fast dispatch");
    expect(html).toContain("Packed and shipped within 24 hours");
    expect(html).not.toContain("rounded-full bg-primary/10"); // no coloured circle behind the icon any more
  });

  it("shows the theme's secure payment picture when set and the built-in badge otherwise, and nothing about reviews when there are none", () => {
    expect(html).toContain('src="/secure-payment.svg"');
    const custom = render(React.createElement(ProductDetailSection, { product, paymentImageUrl: "https://cdn.test/pay.png", options: { galleryPosition: "left", showBreadcrumb: false, showRating: true, showDescription: true, showTags: false, showPaymentImage: true, paymentImageAlt: "We accept UPI" } }));
    expect(custom).toContain('src="https://cdn.test/pay.png"');
    expect(custom).toContain('alt="We accept UPI"');
    expect(html).not.toContain("Be the first to review");
    expect(html).not.toContain("rating-summary");
  });
});
