import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The admin SPA imports `@bs/auth/permissions`. If this module ever imports the auth server code (better-auth, pg,
// drizzle) the browser bundle breaks at load with "Buffer is not defined" and every Settings page crashes.
describe("@bs/auth/permissions stays browser-safe", () => {
  it("has no imports", () => {
    const src = readFileSync(new URL("../src/permissions.ts", import.meta.url), "utf8");
    expect(src.match(/^\s*import\s/gm)).toBeNull();
    expect(src.match(/require\(/g)).toBeNull();
  });
});
