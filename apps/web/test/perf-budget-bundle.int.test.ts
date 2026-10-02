import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import vm from "node:vm";

// Needs a production build (.next). Heavy: run via test:heavy after `pnpm --filter @bs/web build`.
describe("M3 Mobile Performance Baseline Audit: production bundle budget", () => {
  it("verifies production build client JS payload for /products/[slug] is under 100KB gzipped", () => {
    const nextDir = path.join(__dirname, "../.next");
    if (!fs.existsSync(nextDir)) {
      throw new Error(
        "Production build directory .next does not exist. Run 'pnpm --filter @bs/web build' before executing performance budget tests.",
      );
    }

    const manifestPath = path.join(nextDir, "server/app/products/[slug]/page_client-reference-manifest.js");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `Client reference manifest not found at ${manifestPath}. Ensure production build completed for /products/[slug].`,
      );
    }

    const code = fs.readFileSync(manifestPath, "utf8");
    const context = { globalThis: {} };
    vm.createContext(context);
    vm.runInContext(code, context);

    const manifestObj = (context.globalThis as { __RSC_MANIFEST?: Record<string, { entryJSFiles?: Record<string, string[]> }> }).__RSC_MANIFEST;
    expect(manifestObj).toBeDefined();

    const routeData = manifestObj?.["/products/[slug]/page"];
    expect(routeData).toBeDefined();

    const entryJSFiles = routeData?.entryJSFiles || {};
    const uniqueChunks = new Set<string>();
    for (const key of Object.keys(entryJSFiles)) {
      for (const f of entryJSFiles[key]) {
        uniqueChunks.add(f.replace(/^\//, ""));
      }
    }

    let totalRaw = 0;
    let totalGzip = 0;
    for (const chunk of uniqueChunks) {
      const chunkPath = path.join(nextDir, chunk);
      if (fs.existsSync(chunkPath)) {
        const buf = fs.readFileSync(chunkPath);
        totalRaw += buf.length;
        totalGzip += zlib.gzipSync(buf).length;
      }
    }

    expect(totalRaw).toBeGreaterThan(0);
    const totalGzipKB = totalGzip / 1024;
    // Budget: product-page client-side JS < 100KB gzipped
    expect(totalGzipKB).toBeLessThan(100);
    // Actual payload measured is ~12.21 KB
    expect(totalGzipKB).toBeLessThan(50);
  });
});
