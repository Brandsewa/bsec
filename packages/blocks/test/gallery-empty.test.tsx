import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getBlockDefinition, renderBlockTree, type BlockInstance } from "../src/index.ts";

const gallery = (props: Record<string, unknown> = {}): BlockInstance[] => [{ id: "g", type: "Gallery", version: 1, props: { ...getBlockDefinition("Gallery").defaultProps, ...props } }];
const storefront = { renderGallery: ({ children }: { children: React.ReactNode }) => <div data-gal-viewer>{children}</div> };

describe("gallery with no pictures", () => {
  it("starts with no sample heading or description", () => {
    const d = getBlockDefinition("Gallery").defaultProps;
    expect(d.title).toBeUndefined();
    expect(d.description).toBeUndefined();
  });

  it("draws nothing on the storefront, even when it has a heading", () => {
    const html = renderToStaticMarkup(<>{renderBlockTree(gallery({ title: "Lookbook", description: "Text" }), storefront)}</>);
    expect(html).not.toContain("Lookbook");
    expect(html).not.toContain("bs-block-gallery");
  });

  it("shows a hint in the editor so the block can still be found and filled", () => {
    const html = renderToStaticMarkup(<>{renderBlockTree(gallery(), {})}</>);
    expect(html).toContain("Add pictures to this gallery");
  });
});
