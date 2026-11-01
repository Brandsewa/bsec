import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrustStripSchema, renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const widget = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "t", type: "TrustStrip", version: 1, props });
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(<>{renderBlockTree([widget(props)], {})}</>);

describe("Trust strip", () => {
  it("validates with defaults and keeps every setting inside its limits", () => {
    expect(validateBlockDocument({ version: 1, blocks: [widget()] }).success).toBe(true);
    const parsed = TrustStripSchema.parse({});
    expect(parsed.items).toHaveLength(4);
    expect(parsed.styles.desktop).toMatchObject({ perRow: 4, layout: "grid", look: "card" });
    expect(parsed.styles.mobile).toMatchObject({ perRow: 2 });
    expect(TrustStripSchema.safeParse({ styles: { desktop: { perRow: 9 } } }).success).toBe(false);
    expect(TrustStripSchema.safeParse({ styles: { tablet: { layout: "marquee" } } }).success).toBe(false);
    expect(TrustStripSchema.safeParse({ styles: { desktop: { sectionBg: "red" } } }).success).toBe(false);
  });

  it("draws every item with its icon, heading and description", () => {
    const html = render({ items: [{ icon: "truck", title: "Fast <b>x</b>", description: "Shipped in a day" }] });
    expect(html).toContain("bsb-ts-item");
    expect(html).toContain("Shipped in a day");
    expect(html).not.toContain("<b>x</b>");
  });

  it("gives each screen its own values and lets an empty tablet or phone setting follow the larger screen", () => {
    const html = render({ styles: { desktop: { perRow: 3, iconSize: 30 }, tablet: { iconSize: 40 }, mobile: { perRow: 1 } } });
    expect(html).toContain("--ts-gtc-d:repeat(3, minmax(0, 1fr))");
    expect(html).toContain("--ts-ic-d:30px");
    expect(html).toContain("--ts-ic-t:40px");
    // The phone sets no icon size of its own, so it follows the tablet.
    expect(html).toContain("--ts-ic-m:40px");
    // The tablet sets no row count, so it follows desktop; the phone chose one.
    expect(html).toContain("--ts-gtc-t:repeat(3, minmax(0, 1fr))");
    expect(html).toContain("--ts-gtc-m:repeat(1, minmax(0, 1fr))");
  });

  it("can be a card on desktop, plain on the phone, and a slider on the tablet", () => {
    const html = render({ styles: { desktop: { look: "card", cardBg: "#ffffff" }, tablet: { layout: "slider", perRow: 2 }, mobile: { look: "plain", iconPosition: "left" } } });
    expect(html).toContain("--ts-bw-d:1px");
    expect(html).toContain("--ts-cb-d:#ffffff");
    expect(html).toContain("--ts-ox-t:auto");
    expect(html).toContain("--ts-gaf-t:column");
    // Plain look: no border, no fill, no corners.
    expect(html).toContain("--ts-bw-m:0px");
    expect(html).toContain("--ts-cb-m:transparent");
    expect(html).toContain("--ts-fd-m:row");
  });

  it("lets each screen colour the icon, heading and description, and align the icon beside the text", () => {
    const html = render({ styles: { desktop: { iconColor: "#112233", headingColor: "#ffffff", textColor: "#cccccc", iconPosition: "left", valign: "start" }, mobile: { valign: "end" } } });
    expect(html).toContain("--ts-icc-d:#112233");
    expect(html).toContain("--ts-hc-d:#ffffff");
    expect(html).toContain("--ts-tc-d:#cccccc");
    // The phone sets no colours of its own, so it follows the larger screens.
    expect(html).toContain("--ts-icc-m:#112233");
    expect(html).toContain("--ts-ai-d:flex-start");
    expect(html).toContain("--ts-ai-t:flex-start");
    expect(html).toContain("--ts-ai-m:flex-end");
  });

  it("falls back to the theme colours and a middle alignment when nothing is set", () => {
    const html = render();
    expect(html).toContain("--ts-hc-d:inherit");
    expect(html).toContain("--ts-tc-d:var(--m)");
    expect(TrustStripSchema.safeParse({ styles: { desktop: { iconColor: "red" } } }).success).toBe(false);
    expect(TrustStripSchema.safeParse({ styles: { desktop: { valign: "baseline" } } }).success).toBe(false);
  });

  it("reserves room for the slider bar only when a screen is a slider", () => {
    const html = render({ styles: { tablet: { layout: "slider" } } });
    expect(html).toContain("--ts-pb-d:0px");
    expect(html).toContain("--ts-pb-t:6px");
  });
});
