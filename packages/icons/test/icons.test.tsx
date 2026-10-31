import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ICON_NAME_PATTERN, LUCIDE_NAMES, isIconName, resolveIconName } from "../src/index.ts";
import { IconSvg } from "../src/server.tsx";
import { searchIcons } from "../src/catalog.ts";

const LEGACY = ["check", "star", "heart", "truck", "shield", "leaf", "gift", "phone", "mail", "award", "returns", "support", "clipboard", "cup", "help", "info", "package", "droplet", "arrow-right", "arrow-left", "chevron-right", "chevron-left", "cart", "external-link", "plus"];

describe("@bs/icons", () => {
  it("has a sorted, well-formed name list", () => {
    expect(LUCIDE_NAMES.length).toBeGreaterThan(1500);
    expect([...LUCIDE_NAMES]).toEqual([...LUCIDE_NAMES].sort());
    expect(LUCIDE_NAMES.every((n) => ICON_NAME_PATTERN.test(n))).toBe(true);
  });

  it("resolves every name the old hand-drawn set stored", () => {
    for (const n of LEGACY) expect(resolveIconName(n), n).not.toBeNull();
  });

  it("resolves seeded PascalCase names and rejects junk", () => {
    expect(resolveIconName("ShieldCheck")).toBe("shield-check");
    expect(resolveIconName("RotateCcw")).toBe("rotate-ccw");
    for (const bad of ["", "nope-nope", "<script>", "../x", "a".repeat(80), "constructor", "__proto__"]) {
      expect(isIconName(bad), bad).toBe(false);
    }
  });

  it("renders an inline svg without raw HTML and nothing for unknown names", () => {
    const html = renderToStaticMarkup(<IconSvg name="truck" px={20} />);
    expect(html).toContain("<svg");
    expect(html).toContain("width:20px");
    expect(html).not.toMatch(/<script|onload|javascript:/i);
    expect(renderToStaticMarkup(<IconSvg name={'x"><script>'} />)).toBe("");
  });

  it("searches by name and synonym", () => {
    expect(searchIcons("truck")[0]).toBe("truck");
    expect(searchIcons("delivery")).toContain("truck");
    expect(searchIcons("zzzzzz")).toEqual([]);
  });
});

describe("categories", () => {
  it("every category has icons and Store includes the truck", async () => {
    const { ICON_CATEGORIES, iconsInCategory } = await import("../src/catalog.ts");
    for (const c of ICON_CATEGORIES) expect(iconsInCategory(c.id, LUCIDE_NAMES).length, c.id).toBeGreaterThan(5);
    expect(iconsInCategory("store", LUCIDE_NAMES)).toContain("truck");
    expect(iconsInCategory("nope", LUCIDE_NAMES).length).toBe(LUCIDE_NAMES.length);
  });
});

describe("stroke weight", () => {
  it("round-trips a weight suffix and draws it", async () => {
    const { splitIconValue, formatIconValue } = await import("../src/index.ts");
    expect(splitIconValue("truck:bold")).toEqual({ icon: "truck", weight: "bold" });
    expect(splitIconValue("truck:weird").weight).toBe("regular");
    expect(formatIconValue("truck", "theme")).toBe("truck");
    expect(formatIconValue("truck", "regular")).toBe("truck:regular");
    expect(formatIconValue("truck", "thin")).toBe("truck:thin");
    expect(resolveIconName("truck:thin")).toBe("truck");
    expect(isIconName("nope:bold")).toBe(false);
    expect(renderToStaticMarkup(<IconSvg name="truck:thin" />)).toContain("stroke-width:1.25");
    expect(renderToStaticMarkup(<IconSvg name="truck:bold" />)).toContain("stroke-width:2.25");
    expect(renderToStaticMarkup(<IconSvg name="truck" />)).toContain("stroke-width:var(--bs-icon-weight, 1.75)");
    expect(renderToStaticMarkup(<IconSvg name="truck" px={20} />)).toContain("width:20px");
    expect(renderToStaticMarkup(<IconSvg name="truck" themePx={28} />)).toContain("width:var(--bs-icon-size, 28px)");
  });
});
