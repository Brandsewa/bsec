import { describe, it, expect } from "vitest";
import type { PuckData } from "@bs/blocks";
import { WRAP_ON_DROP, wrapDroppedWidget } from "../src/wrap-on-drop.ts";

const item = (type: string, id: string, extra: Record<string, unknown> = {}) => ({ type, props: { id, ...extra } });
const page = (...content: ReturnType<typeof item>[]): PuckData => ({ root: { props: {} }, content });
let n = 0;
const makeId = (type: string) => `${type}-${++n}`;

describe("wrapDroppedWidget", () => {
  it("wraps a newly dropped store widget in Section > Container and leaves the others as they were", () => {
    const data = page(item("Section", "s0", { content: [] }), item("MultiCard", "w1"), item("FaqSection", "old"));
    const next = wrapDroppedWidget(data, "w1", makeId)!;
    expect(next.content.map((i) => i.type)).toEqual(["Section", "Section", "FaqSection"]);
    const section = next.content[1]!;
    const container = (section.props.content as unknown as Array<{ type: string; props: { content: Array<{ type: string; props: { id: string } }> } }>)[0]!;
    expect(container.type).toBe("Container");
    expect(container.props.content[0]).toMatchObject({ type: "MultiCard", props: { id: "w1" } });
    expect(next.content[2]).toBe(data.content[2]);
    expect(data.content[1]!.type).toBe("MultiCard");
  });

  it("does nothing for widgets that are full-bleed, page chrome, layout, or not found", () => {
    for (const type of ["HeroSlider", "ImageBanner", "Banner", "SiteHeader", "SiteFooter", "Section", "Heading", "ProductDetail"]) {
      expect(WRAP_ON_DROP.has(type as never)).toBe(false);
      expect(wrapDroppedWidget(page(item(type, "x")), "x", makeId)).toBeNull();
    }
    expect(wrapDroppedWidget(page(item("MultiCard", "a")), "missing", makeId)).toBeNull();
  });

  it("gives the wrappers fresh ids", () => {
    const next = wrapDroppedWidget(page(item("Gallery", "g")), "g")!;
    const section = next.content[0]!;
    expect(section.props.id).toMatch(/^Section-/);
    expect(section.props.id).not.toBe("g");
  });
});
