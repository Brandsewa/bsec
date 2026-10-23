import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FaqSectionSchema, renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const widget = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "f", type: "FaqSection", version: 1, props });
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(<>{renderBlockTree([widget(props)], {})}</>);

describe("FAQ accordion", () => {
  it("validates with defaults and rejects bad settings", () => {
    expect(validateBlockDocument({ version: 1, blocks: [widget()] }).success).toBe(true);
    expect(FaqSectionSchema.parse({})).toMatchObject({ layout: "split", textSide: "right", style: "cards", iconPosition: "right" });
    expect(FaqSectionSchema.safeParse({ layout: "grid" }).success).toBe(false);
    expect(FaqSectionSchema.safeParse({ iconPosition: "top" }).success).toBe(false);
    expect(FaqSectionSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("draws the heading, description and every question with escaped text", () => {
    const html = render({ eyebrow: "Help", title: "Questions", description: "Ask away", items: [{ question: "Q <b>1</b>", answer: "A1" }, { question: "Q2", answer: "A2" }] });
    expect(html).toContain("Questions");
    expect(html).toContain("Ask away");
    expect(html).toContain("bsb-fq-eyebrow");
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).toContain("Q &lt;b&gt;1&lt;/b&gt;");
  });

  it("keeps the heading first in the markup (so it is on top on phones), and the side is chosen by CSS order", () => {
    const right = render();
    expect(right).toContain("bsb-fq-side-right");
    expect(right.indexOf("bsb-fq-head")).toBeLessThan(right.indexOf("bsb-fq-list"));
    expect(render({ textSide: "left" })).toContain("bsb-fq-side-left");
  });

  it("passes the icon size and row height to the list as CSS variables, within limits", () => {
    expect(render()).toContain("--fq-icon:20px");
    expect(render()).toContain("--fq-py:16px");
    const custom = render({ iconSize: 28, rowPadding: 24 });
    expect(custom).toContain("--fq-icon:28px");
    expect(custom).toContain("--fq-py:24px");
    expect(FaqSectionSchema.safeParse({ iconSize: 5 }).success).toBe(false);
    expect(FaqSectionSchema.safeParse({ rowPadding: 60 }).success).toBe(false);
  });

  it("stacks the heading above the questions", () => {
    const html = render({ layout: "stacked", headingAlign: "center" });
    expect(html).toContain("bsb-fq-stacked");
    expect(html.indexOf("bsb-fq-head")).toBeLessThan(html.indexOf("bsb-fq-list"));
    expect(html).toContain("bsb-align-center");
  });

  it("follows the look options: plain style, icon side and shape, single open, first open", () => {
    const html = render({ style: "plain", iconPosition: "left", iconStyle: "chevron", singleOpen: true, openFirst: true });
    expect(html).toContain("bsb-fq-plain");
    expect(html).toContain("bsb-fq-icon-left");
    expect(html).toContain("bsb-fq-chevronicon");
    expect(html).toContain('name="faq-f"');
    expect(html).toMatch(/<details[^>]*open/);
    const cards = render();
    expect(cards).toContain("bsb-fq-cards");
    expect(cards).toContain("bsb-fq-icon-right");
    expect(cards).not.toContain('name="faq-f"');
  });

  it("hides the heading block when all three heading texts are empty", () => {
    expect(render({ eyebrow: "", title: "", description: "" })).not.toContain("bsb-fq-head");
  });
});
