import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Border rule for the admin (docs/admin-ui-standards.md "Borders"): a bare `border`, `border-t`, `border-b` or
 * `divide-y` class has no colour of its own. In Tailwind v4 it falls back to the text colour, which draws a sharp white
 * line in dark mode and a sharp dark line in light mode. Every border must name a design token:
 * `border border-border` for cards and controls, `border-border/60` for dividers inside a card.
 */
const root = path.resolve(__dirname, "..", "src");
const files = [
  path.join(root, "routes/_store/online-store/media.tsx"),
  ...fs
    .readdirSync(path.join(root, "components/media"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => path.join(root, "components/media", f)),
];

const BARE_BORDER = /(?<=[\s"'`])border(-[tblrxy])?(?=[\s"'`])/g;
const BARE_DIVIDE = /(?<=[\s"'`])divide-[xy](?=[\s"'`])/g;

describe("media UI borders use design tokens", () => {
  for (const file of files) {
    it(path.relative(root, file).split(path.sep).join("/"), () => {
      const offenders: string[] = [];
      fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const text = line.trim();
          if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) return;
          const bare = line.match(BARE_BORDER) ?? [];
          const divide = line.match(BARE_DIVIDE) ?? [];
          const coloured = /border-(border|input|primary|destructive|muted|foreground|amber|transparent|dashed)/.test(line);
          const dividerColoured = /divide-border/.test(line);
          if (bare.length > 0 && !coloured) offenders.push(`${i + 1}: ${line.trim()}`);
          if (divide.length > 0 && !dividerColoured) offenders.push(`${i + 1}: ${line.trim()}`);
        });
      expect(offenders, `bare border classes (add border-border or border-border/60):\n${offenders.join("\n")}`).toEqual([]);
    });
  }
});
