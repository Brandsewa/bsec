import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { validateBlockDocument, type BlockInstance } from "../src/index.ts";
import { SvgIcon } from "../src/svg-icon.tsx";

const iconDoc = (name: string) => validateBlockDocument({ version: 1, blocks: [{ id: "i", type: "Icon", version: 1, props: { name } } as BlockInstance] });

describe("Lucide icons in blocks (ADR-041)", () => {
  it("accepts any Lucide name, the names saved before Lucide, and rejects everything else", () => {
    for (const ok of ["rocket", "badge-check", "ShieldCheck", "returns", "support", "cart"]) expect(iconDoc(ok).success, ok).toBe(true);
    for (const bad of ["not-an-icon", "<svg onload=x>", "../../x", ""]) expect(iconDoc(bad).success, bad).toBe(false);
  });

  it("draws inline svg for new and old names and nothing for unknown ones", () => {
    for (const n of ["rocket", "returns", "ShieldCheck"]) expect(renderToStaticMarkup(<SvgIcon name={n} px={24} />), n).toContain("<svg");
    expect(renderToStaticMarkup(<SvgIcon name="nope" px={24} />)).toBe("");
  });
});

import { computeThemeTokens, getBlockDefinition } from "../src/index.ts";
import { IconView } from "../src/views.tsx";

describe("theme icon defaults", () => {
  it("emits size, weight and tile colours only as the theme sets them", () => {
    const none = computeThemeTokens(null, { source: "theme" });
    expect(none["--bs-icon-size"]).toBeUndefined();
    expect(none["--bs-icon-weight"]).toBeUndefined();
    expect(none["--bs-icon-color-dark"]).toBeUndefined();
    expect(none["--bs-icon-color-light"]).toBeUndefined();
    const set = computeThemeTokens(null, { source: "theme", icons: { size: 40, weight: "bold", darkColor: "#112233", lightColor: "#eeeeee" } });
    expect(set["--bs-icon-size"]).toBe("40px");
    expect(set["--bs-icon-weight"]).toBe("2.25");
    expect(set["--bs-icon-color-dark"]).toBe("#112233");
    expect(set["--bs-icon-color-light"]).toBe("#eeeeee");
  });

  it("clamps the size and ignores junk", () => {
    expect(computeThemeTokens(null, { icons: { size: 500 } })["--bs-icon-size"]).toBe("96px");
    const junk = computeThemeTokens(null, { icons: { size: "x" as unknown as number, weight: "heavy", darkColor: "url(x)" } });
    expect(junk["--bs-icon-size"]).toBeUndefined();
    expect(junk["--bs-icon-weight"]).toBeUndefined();
    expect(junk["--bs-icon-color-dark"]).toBeUndefined();
  });

  it("lets the widget's own size win and otherwise follows the theme", () => {
    const def = getBlockDefinition("Icon");
    const render = (p: object) => renderToStaticMarkup(<>{IconView({ props: def.schema.parse({ name: "truck", ...p }), ctx: {} as never, children: [] } as never)}</>);
    expect(render({})).toContain("var(--bs-icon-size, 32px)");
    expect(render({ size: "lg" })).toContain("width:48px");
    expect(render({ size: "theme" })).toContain("var(--bs-icon-size");
    expect(render({ name: "truck:bold" })).toContain("stroke-width:2.25");
  });
});

import { bricksElementStyle, bricksIconToneClass } from "../src/bricks-layout.ts";
import { isDarkColor } from "../src/theme-vars.ts";

describe("automatic icon colour from the background", () => {
  it("detects dark and light hex colours and ignores anything else", () => {
    expect(isDarkColor("#0f172a")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#fdf1e7")).toBe(false);
    expect(isDarkColor("rgb(0,0,0)")).toBeUndefined();
    expect(isDarkColor(undefined)).toBeUndefined();
  });

  it("emits the dark or light icon colour per device from the element's background", () => {
    const dark = bricksElementStyle({ background: { color: "#111827" } } as never) as Record<string, string>;
    expect(dark["--brx-d-ic"]).toContain("--bs-icon-color-dark");
    expect(dark["--brx-m-ic"]).toContain("--bs-icon-color-dark");
    const mixed = bricksElementStyle({ background: { color: "#111827" }, responsive: { mobile: { background: { color: "#ffffff" } } } } as never) as Record<string, string>;
    expect(mixed["--brx-d-ic"]).toContain("--bs-icon-color-dark");
    expect(mixed["--brx-m-ic"]).toContain("--bs-icon-color-light");
    expect(bricksElementStyle({} as never)["--brx-d-ic" as never]).toBeUndefined();
  });

  it("marks only elements that paint their own background", () => {
    expect(bricksIconToneClass({ background: { color: "#000000" } } as never)).toBe("brx-ic");
    expect(bricksIconToneClass({} as never)).toBeUndefined();
  });
});
