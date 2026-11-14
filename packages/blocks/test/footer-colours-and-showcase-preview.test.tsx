import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBlockTree, type BlockInstance } from "../src/index.ts";

const render = (b: BlockInstance, ctx: Record<string, unknown> = {}) => renderToStaticMarkup(<>{renderBlockTree([b], ctx)}</>);
const footer = (props: Record<string, unknown>): BlockInstance => ({ id: "f", type: "SiteFooter", version: 1, props });

describe("footer custom colours", () => {
  it("draws the footer, its newsletter field and button from the chosen colours", () => {
    const html = render(footer({ bgColor: "#102030", textColor: "#f0f0f0" }));
    expect(html).toContain("background:#102030");
    expect(html).toContain("--t:#f0f0f0");
    expect(html).toContain("--bs-btn-bg:#f0f0f0"); // the sign-up button is the text colour on the background colour
    expect(html).toContain("--bs-btn-fg:#102030");
    expect(html).toContain("--ft-input-bg:");
  });

  it("picks a readable text colour when only a background is set", () => {
    expect(render(footer({ bgColor: "#101010" }))).toContain("--t:#ffffff");
    expect(render(footer({ bgColor: "#fafafa" }))).toContain("--t:#111111");
  });

  it("adds no inline colours without a choice, so old preset footers look as before", () => {
    const html = render(footer({ tone: "dark" }));
    expect(html).toContain("bsb-tone-dark");
    expect(html).not.toContain("--ft-input-bg");
  });
});

describe("product showcase tabs in the editor preview", () => {
  const showcase: BlockInstance = { id: "ps", type: "ProductShowcase", version: 1, props: { tabs: [{ label: "New arrivals", source: "newest" }, { label: "Featured", source: "featured" }] } };
  const data = { ps: { kind: "product-tabs", tabs: [{ products: [] }, { products: [] }] } };

  it("keeps the tab buttons and both panels when no storefront host is mounted", () => {
    const html = render(showcase, { data });
    expect(html.match(/data-psc-tab/g)?.length).toBe(2);
    expect(html.match(/data-psc-panel/g)?.length).toBe(2);
  });
});
