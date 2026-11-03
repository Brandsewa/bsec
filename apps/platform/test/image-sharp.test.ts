import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// sharp is external to the esbuild bundle, so a service that reads image sizes needs it installed next to the bundle.
// The Platform image shipped without it and every Marketing upload failed (2026-11-03).
describe("service images that process uploads", () => {
  const pinned = (JSON.parse(read("packages/domain/package.json")) as { dependencies: Record<string, string> }).dependencies["sharp"];

  for (const image of ["platform", "worker"]) {
    it(`${image} installs the same sharp as the domain package`, () => {
      expect(pinned).toBeTruthy();
      expect(read(`infra/docker/${image}.Dockerfile`)).toContain(`sharp@${pinned}`);
    });
  }
});
