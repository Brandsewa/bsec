import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const block = (type: string, props: Record<string, unknown> = {}): BlockInstance => ({
  id: "test_" + Math.random().toString(36).substring(7),
  type: type as never,
  version: 1,
  props,
});

const render = (b: BlockInstance) => renderToStaticMarkup(<>{renderBlockTree([b], {} as never)}</>);

describe("Bricks Responsive Settings Across All Elements", () => {
  it("renders responsive image height, width, and art direction (different image per device)", () => {
    const imgBlock = block("Image", {
      imageUrl: "https://example.com/desktop.jpg",
      sizing: { height: "500px", width: "100%" },
      responsive: {
        tablet: {
          imageUrl: "https://example.com/tablet.jpg",
          sizing: { height: "300px", width: "80%" },
        },
        mobile: {
          imageUrl: "https://example.com/mobile.jpg",
          sizing: { height: "200px", width: "100%" },
        },
      },
    });

    const doc = { version: 1 as const, blocks: [imgBlock] };
    const valid = validateBlockDocument(doc);
    expect(valid.success).toBe(true);

    const html = render(imgBlock);

    // CSS variables for responsive sizing
    expect(html).toContain("--brx-d-h:500px");
    expect(html).toContain("--brx-t-h:300px");
    expect(html).toContain("--brx-m-h:200px");
    expect(html).toContain("--brx-d-w:100%");
    expect(html).toContain("--brx-t-w:80%");
    expect(html).toContain("--brx-m-w:100%");

    // Picture tag with responsive media queries for art direction
    expect(html).toContain("<picture>");
    expect(html).toContain('media="(max-width: 1023px)"');
    expect(html).toContain('srcSet="https://example.com/tablet.jpg"');
    expect(html).toContain('media="(max-width: 767px)"');
    expect(html).toContain('srcSet="https://example.com/mobile.jpg"');
    expect(html).toContain('src="https://example.com/desktop.jpg"');
    expect(html).toContain("brxe-image");
    expect(html).toContain("brx-resp");
  });

  it("renders responsive video sources and sizing", () => {
    const videoBlock = block("Video", {
      videoType: "url",
      url: "https://example.com/desktop.mp4",
      sizing: { height: "450px" },
      responsive: {
        tablet: {
          sizing: { height: "320px" },
          videoUrl: "https://example.com/tablet.mp4",
        },
        mobile: {
          sizing: { height: "240px" },
          videoUrl: "https://example.com/mobile.mp4",
        },
      },
    });

    const doc = { version: 1 as const, blocks: [videoBlock] };
    const valid = validateBlockDocument(doc);
    expect(valid.success).toBe(true);

    const html = render(videoBlock);

    expect(html).toContain("--brx-d-h:450px");
    expect(html).toContain("--brx-t-h:320px");
    expect(html).toContain("--brx-m-h:240px");
    expect(html).toContain("brxe-video");
    expect(html).toContain("brx-resp");
  });

  it("renders responsive background image on Section, Container, and Block", () => {
    const section = block("Section", {
      background: { imageUrl: "https://example.com/bg-desktop.jpg" },
      responsive: {
        tablet: {
          background: { imageUrl: "https://example.com/bg-tablet.jpg" },
        },
        mobile: {
          background: { imageUrl: "https://example.com/bg-mobile.jpg" },
        },
      },
      content: [],
    });

    const doc = { version: 1 as const, blocks: [section] };
    const valid = validateBlockDocument(doc);
    expect(valid.success).toBe(true);

    const html = render(section);
    expect(html).toContain('media="(max-width: 1023px)"');
    expect(html).toContain('srcSet="https://example.com/bg-tablet.jpg"');
    expect(html).toContain('media="(max-width: 767px)"');
    expect(html).toContain('srcSet="https://example.com/bg-mobile.jpg"');
    expect(html).toContain('src="https://example.com/bg-desktop.jpg"');
  });

  it("renders responsive heading text and alignment", () => {
    const heading = block("Heading", {
      text: "Desktop Title",
      level: "h1",
      align: "left",
      responsive: {
        tablet: {
          align: "center",
        },
        mobile: {
          text: "Mobile Title",
          align: "center",
        },
      },
    });

    const doc = { version: 1 as const, blocks: [heading] };
    const valid = validateBlockDocument(doc);
    expect(valid.success).toBe(true);

    const html = render(heading);
    expect(html).toContain("--brx-d-ta:left");
    expect(html).toContain("--brx-t-ta:center");
    expect(html).toContain("--brx-m-ta:center");
    expect(html).toContain("Desktop Title");
    expect(html).toContain("Mobile Title");
    expect(html).toContain("brx-only-mobile");
  });

  it("normalizes bare number gap inputs and sets responsive gaps and directions", () => {
    const container = block("Container", {
      direction: "row",
      gap: "24", // Bare number normalized to 24px
      colGap: "16",
      rowGap: "20",
      responsive: {
        mobile: {
          direction: "column",
          gap: "12",
        },
      },
      content: [],
    });

    const doc = { version: 1 as const, blocks: [container] };
    const valid = validateBlockDocument(doc);
    expect(valid.success).toBe(true);

    const html = render(container);
    // Gap should be normalized to px
    expect(html).toContain("--brx-d-gap:24px");
    expect(html).toContain("--brx-d-cg:16px");
    expect(html).toContain("--brx-d-rg:20px");
    expect(html).toContain("--brx-m-gap:12px");
    expect(html).toContain("--brx-d-dir:row");
    expect(html).toContain("--brx-m-dir:column");
    expect(html).toContain("gap:var(--b-gap, 24px)");
  });

  it("renders image and heading with full width and no accidental auto margins", () => {
    const img = block("Image", {
      imageUrl: "https://example.com/mountain.jpg",
    });

    const html = render(img);
    expect(html).toContain("width:100%");
    expect(html).toContain("display:block");
    expect(html).toContain("brxe-image");
  });
});
