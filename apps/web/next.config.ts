import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // PLAN §2: Cache Components; every cacheTag is tenant-prefixed (lint rule bs/tenant-cache-tag).
  cacheComponents: true,
  // Docker image copies .next/standalone (built in GitHub Actions, never on the VPS).
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  transpilePackages: ["@bs/ui"],
  // pg + pino use Node internals; keep them as runtime requires instead of bundling.
  serverExternalPackages: ["pg", "pino", "pg-boss"],
  // IndexNow proves site ownership by fetching /<key>.txt from the root of the host (docs/SEO-GEO-AEO-PLAN.md Phase 2).
  // The key is 32 hex characters; the route answers only for the requesting store's own key.
  async rewrites() {
    return { beforeFiles: [{ source: "/:key([a-f0-9]{32}).txt", destination: "/api/indexnow-key/:key" }], afterFiles: [], fallback: [] };
  },
};

export default config;
