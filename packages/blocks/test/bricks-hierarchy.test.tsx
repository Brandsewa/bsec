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

describe("Section > Container > 2x Blocks Hierarchy and Styling", () => {
  it("renders the exact requested layout: Section full-width (padding 4rem, bg color) > Container (standard width, different bg color) > 2 Blocks (each 50%, different bg colors)", () => {
    const block1 = block("Block", {
      sizing: { width: "50%" },
      padding: { top: "1.5rem", right: "1.5rem", bottom: "1.5rem", left: "1.5rem" },
      background: { color: "#fef08a" }, // light yellow
      content: [],
    });

    const block2 = block("Block", {
      sizing: { width: "50%" },
      padding: { top: "1.5rem", right: "1.5rem", bottom: "1.5rem", left: "1.5rem" },
      background: { color: "#bbf7d0" }, // light green
      content: [],
    });

    const container = block("Container", {
      direction: "row",
      padding: { top: "2rem", right: "2rem", bottom: "2rem", left: "2rem" },
      background: { color: "#38bdf8" }, // light blue
      content: [block1, block2],
    });

    const section = block("Section", {
      padding: { top: "4rem", right: "4rem", bottom: "4rem", left: "4rem" },
      background: { color: "#f43f5e" }, // rose/red
      content: [container],
    });

    const doc = { version: 1 as const, blocks: [section] };
    const valid = validateBlockDocument(doc);
    expect(valid.success).toBe(true);

    const html = render(section);
    console.log("RENDERED HTML:\n", html);

    // Section asserts
    expect(html).toContain("background-color:#f43f5e");
    expect(html).toContain("padding-top:4rem");

    // Container asserts
    expect(html).toContain("background-color:#38bdf8");
    expect(html).toContain("padding-top:2rem");

    // Blocks asserts
    expect(html).toContain("background-color:#fef08a");
    expect(html).toContain("background-color:#bbf7d0");
    expect(html).toContain("width:50%");
  });

  it("renders responsive settings: direction row on desktop/tablet, vertical on mobile, and responsive padding", () => {
    // Example 1: Direction row on desktop, column on mobile
    // Example 2: Padding 20px on desktop, 16px on tablet, 10px on mobile
    const responsiveContainer = block("Container", {
      direction: "row",
      padding: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
      responsive: {
        tablet: {
          direction: "row",
          padding: { top: "16px", right: "16px", bottom: "16px", left: "16px" },
        },
        mobile: {
          direction: "column",
          padding: { top: "10px", right: "10px", bottom: "10px", left: "10px" },
        },
      },
      content: [],
    });

    const html = render(responsiveContainer);

    // Desktop vars
    expect(html).toContain("--brx-d-dir:row");
    expect(html).toContain("--brx-d-pt:20px");

    // Tablet vars
    expect(html).toContain("--brx-t-dir:row");
    expect(html).toContain("--brx-t-pt:16px");

    // Mobile vars
    expect(html).toContain("--brx-m-dir:column");
    expect(html).toContain("--brx-m-pt:10px");

    // Has responsive class
    expect(html).toContain("brx-resp");
  });

  it("renders background color and text color pairing across desktop and responsive devices", () => {
    const styledBlock = block("Block", {
      background: {
        color: "#0f172a",
        textColor: "#ffffff",
      },
      responsive: {
        mobile: {
          background: {
            color: "#1e293b",
            textColor: "#cbd5e1",
          },
        },
      },
      content: [],
    });

    const html = render(styledBlock);
    expect(html).toContain("background-color:#0f172a");
    expect(html).toContain("color:#ffffff");
    expect(html).toContain("--brx-d-bg-c:#0f172a");
    expect(html).toContain("--brx-d-c:#ffffff");
    expect(html).toContain("--brx-m-bg-c:#1e293b");
    expect(html).toContain("--brx-m-c:#cbd5e1");
  });

  it("renders responsive border radius across blocks, containers, and elements", () => {
    // 1. Block with uniform border radius on desktop (20px), inherited on tablet, overridden on mobile (6px)
    const blockWithRadius = block("Block", {
      border: {
        radius: "20px",
        width: "2px",
        style: "solid",
        color: "#cbd5e1",
      },
      responsive: {
        mobile: {
          border: {
            radius: "6px",
          },
        },
      },
      content: [],
    });

    const blockHtml = render(blockWithRadius);
    expect(blockHtml).toContain("border-top-left-radius:20px");
    expect(blockHtml).toContain("border-top-right-radius:20px");
    expect(blockHtml).toContain("--brx-d-rtl:20px");
    expect(blockHtml).toContain("--brx-d-rtr:20px");
    expect(blockHtml).toContain("--brx-t-rtl:20px"); // Inherited from desktop
    expect(blockHtml).toContain("--brx-m-rtl:6px");  // Overridden on mobile
    expect(blockHtml).toContain("--brx-m-rtr:6px");
    expect(blockHtml).toContain("--brx-d-bw:2px");
    expect(blockHtml).toContain("--brx-d-bs:solid");
    expect(blockHtml).toContain("--brx-d-bc:#cbd5e1");

    // 2. Container with 4 individual corners on desktop and mobile
    const containerWithCorners = block("Container", {
      border: {
        radiusCorners: {
          topLeft: "16px",
          topRight: "16px",
          bottomRight: "0px",
          bottomLeft: "0px",
        },
      },
      responsive: {
        mobile: {
          border: {
            radiusCorners: {
              topLeft: "8px",
              topRight: "8px",
              bottomRight: "8px",
              bottomLeft: "8px",
            },
          },
        },
      },
      content: [],
    });

    const containerHtml = render(containerWithCorners);
    expect(containerHtml).toContain("border-top-left-radius:16px");
    expect(containerHtml).toContain("border-bottom-right-radius:0px");
    expect(containerHtml).toContain("--brx-d-rtl:16px");
    expect(containerHtml).toContain("--brx-d-rbr:0px");
    expect(containerHtml).toContain("--brx-m-rtl:8px");
    expect(containerHtml).toContain("--brx-m-rbr:8px");

    // 3. Image element with custom border radius and inheritance
    const imageWithRadius = block("Image", {
      imageUrl: "https://example.com/test.jpg",
      border: {
        radius: "12px",
      },
      responsive: {
        mobile: {
          border: {
            radius: "4px",
          },
        },
      },
    });

    const imageHtml = render(imageWithRadius);
    expect(imageHtml).toContain("--brx-d-rtl:12px");
    expect(imageHtml).toContain("--brx-m-rtl:4px");
    expect(imageHtml).toContain("border-radius:inherit");
  });

  it("renders Button widget with normal, line, text styles, icons, and custom colors", () => {
    // 1. Normal solid button with custom colors, icon on left, and responsive typography
    const normalBtn = block("Button", {
      text: "Shop Collection",
      link: "/collections/all",
      newTab: true,
      styleType: "normal",
      buttonColor: "#4f46e5",
      textColor: "#ffffff",
      hoverButtonColor: "#4338ca",
      hoverTextColor: "#f8fafc",
      icon: "arrow-right",
      iconPosition: "left",
      iconGap: "10px",
      typography: {
        fontSize: "18px",
        fontWeight: "600",
        fontFamily: "Inter, sans-serif",
      },
    });

    const normalHtml = render(normalBtn);
    expect(normalHtml).toContain("brxe-button");
    expect(normalHtml).toContain("brx-btn-normal");
    expect(normalHtml).toContain('href="/collections/all"');
    expect(normalHtml).toContain('target="_blank"');
    expect(normalHtml).toContain('rel="noopener noreferrer"');
    expect(normalHtml).toContain("--brx-btn-bg:#4f46e5");
    expect(normalHtml).toContain("--brx-btn-tc:#ffffff");
    expect(normalHtml).toContain("--brx-btn-hbg:#4338ca");
    expect(normalHtml).toContain("--brx-btn-htc:#f8fafc");
    expect(normalHtml).toContain("--brx-btn-gap:10px");
    expect(normalHtml).toContain("--brx-d-fs:18px");
    expect(normalHtml).toContain("--brx-d-fw:600");
    expect(normalHtml).toContain("font-size:18px");
    expect(normalHtml).toContain("Shop Collection");

    // 2. Line button
    const lineBtn = block("Button", {
      text: "Explore More",
      link: "/explore",
      styleType: "line",
      buttonColor: "#10b981",
    });
    const lineHtml = render(lineBtn);
    expect(lineHtml).toContain("brx-btn-line");
    expect(lineHtml).toContain("--brx-btn-bg:#10b981");

    // 3. Text button
    const textBtn = block("Button", {
      text: "Learn More",
      link: "/about",
      styleType: "text",
      icon: "chevron-right",
      iconPosition: "right",
    });
    const textHtml = render(textBtn);
    expect(textHtml).toContain("brx-btn-text");
    expect(textHtml).toContain("Learn More");
  });

  it("renders Heading with custom responsive typography", () => {
    const heading = block("Heading", {
      text: "Summer Sale 50% Off",
      level: "h1",
      typography: {
        fontFamily: "Poppins, sans-serif",
        fontSize: "42px",
        fontWeight: "700",
        lineHeight: "1.2",
      },
      responsive: {
        mobile: {
          typography: {
            fontSize: "28px",
          },
        },
      },
    });

    const html = render(heading);
    expect(html).toContain("brxe-heading");
    expect(html).toContain("Summer Sale 50% Off");
    expect(html).toContain("--brx-d-fs:42px");
    expect(html).toContain("--brx-d-fw:700");
    expect(html).toContain("--brx-d-ff:Poppins, sans-serif");
    expect(html).toContain("--brx-m-fs:28px");
    expect(html).toContain("font-size:42px");
    expect(html).toContain("font-weight:700");
  });

  it("renders Text widget with markdown formatting (bold, italic, links, lists) and sanitization", () => {
    const textBlock = block("Text", {
      text: "Welcome to **our store**!\nWe have *fresh arrivals* and [discounts](/sale).\n\nFeatures:\n- Quality 100%\n- Fast delivery\n\nSteps:\n1. Choose product\n2. Checkout",
    });

    const html = render(textBlock);
    expect(html).toContain("brxe-text-basic");
    expect(html).toContain("<strong>our store</strong>");
    expect(html).toContain("<em>fresh arrivals</em>");
    expect(html).toContain('<a href="/sale"');
    expect(html).toContain("<ul><li>Quality 100%</li><li>Fast delivery</li></ul>");
    expect(html).toContain("<ol><li>Choose product</li><li>Checkout</li></ol>");
  });
});
