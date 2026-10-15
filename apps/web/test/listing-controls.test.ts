import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup as renderToString } from "react-dom/server";

vi.mock("server-only", () => ({}));

import { RatingSummary } from "../src/components/product/RatingSummary.tsx";
import { PriceSlider } from "../src/components/catalog/PriceSlider.tsx";
import { ListingViewProvider, ProductsSkeleton } from "../src/components/catalog/ListingView.tsx";

describe("review summary above the product title", () => {
  it("shows the average, the count and a link to the reviews section", () => {
    const html = renderToString(React.createElement(RatingSummary, { average: "4.30", count: 27 }));
    expect(html).toContain("4.3");
    expect(html).toContain("(27 reviews)");
    expect(html).toContain('href="#reviews-section"');
    expect(html).toContain("width:86%"); // 4.3 of 5 stars filled
    expect(html).toContain("Rated 4.3 out of 5 from 27 reviews");
  });

  it("uses the singular for one review and shows nothing at all when there are none", () => {
    expect(renderToString(React.createElement(RatingSummary, { average: 5, count: 1 }))).toContain("(1 review)");
    expect(renderToString(React.createElement(RatingSummary, { average: "0.00", count: 0 }))).toBe("");
  });
});

describe("price slider", () => {
  const render = (p: { min: number; max: number; valueMin: number; valueMax: number }) => renderToString(React.createElement(PriceSlider, { ...p, onCommit: () => {} }));

  it("shows two handles with the chosen range in rupees", () => {
    const html = renderToString(React.createElement(PriceSlider, { min: 199, max: 4599, valueMin: 500, valueMax: 3000, onCommit: () => {} }));
    expect(html).toContain('aria-label="Minimum price"');
    expect(html).toContain('aria-label="Maximum price"');
    expect(html).toContain("₹500");
    expect(html).toContain("₹3,000");
  });

  it("keeps a stale or out-of-range value inside the slider and shows plain text when every price is the same", () => {
    expect(render({ min: 100, max: 900, valueMin: 5, valueMax: 99999 })).toContain("₹900");
    const same = render({ min: 249, max: 249, valueMin: 249, valueMax: 249 });
    expect(same).toContain("All products cost ₹249");
    expect(same).not.toContain("type=\"range\"");
  });
});

describe("skeleton while filters load", () => {
  it("draws placeholder cards in the same grid and announces loading", () => {
    const html = renderToString(React.createElement(ListingViewProvider, { cols: 3, colsTablet: 2, colsMobile: 1 }, React.createElement(ProductsSkeleton, { count: 6 })));
    expect(html).toContain('aria-label="Loading products"');
    expect(html).toContain("--cols:3");
    expect(html.match(/bs-skel/g)?.length).toBeGreaterThanOrEqual(6);
  });
});
