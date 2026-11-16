import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonLd } from "../src/components/blog/JsonLd.tsx";

// Audit A8-01 (docs/audit/2026-11-A8-blocks-themes-content.md): merchant text (product names, FAQ answers, blog titles) goes
// into structured-data scripts. JSON.stringify alone does not escape "</script>", so a product named
// "</script><script>...</script>" would close the script element and run. Every such script must go through JsonLd.
describe("structured data scripts", () => {
  it("JsonLd keeps a closing script tag in merchant text from ending the element", () => {
    const html = renderToStaticMarkup(<JsonLd data={{ name: "</script><img src=x onerror=alert(1)>", note: "<!-- x -->" }} />);
    expect(html.match(/<\/script>/g)).toHaveLength(1); // only the real closing tag
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<!--");
    const json = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
    expect(JSON.parse(json).name).toBe("</script><img src=x onerror=alert(1)>"); // the data itself is unchanged
  });

  it("no page or component writes JSON.stringify output into a script by hand", () => {
    const root = path.join(__dirname, "../src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx|ts)$/.test(f)) {
          const src = fs.readFileSync(p, "utf8");
          if (/dangerouslySetInnerHTML=\{\{\s*__html:\s*JSON\.stringify\((?![^}]*\.replace\(\/<\/g)/.test(src) && !p.endsWith("JsonLd.tsx")) offenders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
