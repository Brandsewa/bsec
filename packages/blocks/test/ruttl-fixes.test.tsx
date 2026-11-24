import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBlockTree, bricksElementStyle, elementFontHref, elementFontValue, type BlockInstance } from "../src/index.ts";

const block = (type: string, props: Record<string, unknown> = {}): BlockInstance => ({
  id: "t_" + Math.random().toString(36).slice(2, 9),
  type: type as never,
  version: 1,
  props,
});
const render = (b: BlockInstance) => renderToStaticMarkup(<>{renderBlockTree([b], {} as never)}</>);

describe("per-device display", () => {
  it("emits tablet and phone display variables only when a smaller device sets its own", () => {
    const plain = bricksElementStyle({ display: "flex" }) as Record<string, string>;
    expect(plain["--brx-t-disp"]).toBeUndefined();

    const s = bricksElementStyle({ display: "flex", responsive: { tablet: { display: "grid" } } }) as Record<string, string>;
    expect(s.display).toBe("flex");
    expect(s["--brx-t-disp"]).toBe("grid");
    // the phone inherits the tablet value, so the cascade is desktop -> tablet -> phone
    expect(s["--brx-m-disp"]).toBe("grid");

    const m = bricksElementStyle({ display: "flex", responsive: { mobile: { display: "none" } } }) as Record<string, string>;
    expect(m["--brx-t-disp"]).toBe("flex");
    expect(m["--brx-m-disp"]).toBe("none");
  });

  it("applies display none on desktop instead of ignoring it", () => {
    expect((bricksElementStyle({ display: "none" }) as Record<string, string>).display).toBe("none");
  });
});

describe("element font", () => {
  it("only curated fonts produce a stylesheet URL", () => {
    expect(elementFontHref(elementFontValue("DM Sans"))).toContain("family=DM+Sans");
    expect(elementFontHref("Inter, sans-serif")).toContain("family=Inter");
    expect(elementFontHref("Evil Font, sans-serif")).toBeNull();
    expect(elementFontHref("monospace")).toBeNull();
    expect(elementFontHref(undefined)).toBeNull();
  });

  it("a heading with a chosen font loads it, and one without loads nothing extra", () => {
    const withFont = render(block("Heading", { text: "Hi", level: "h2", typography: { fontFamily: "Poppins, sans-serif", fontWeight: "300" } }));
    expect(withFont).toContain("fonts.googleapis.com");
    expect(withFont).toContain("--brx-d-ff:Poppins, sans-serif");
    expect(withFont).toContain("--brx-d-fw:300");
    const without = render(block("Heading", { text: "Hi", level: "h2" }));
    expect(without).not.toContain("fonts.googleapis.com");
  });
});

describe("card text", () => {
  it("renders line breaks and lists", () => {
    const html = render(
      block("MultiCard", { items: [{ icon: "star", heading: "H", text: "line one\nline two\n\n- a\n- b", linkLabel: "", linkHref: "" }] }),
    );
    expect(html).toContain("line one<br />line two");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
  });
});
