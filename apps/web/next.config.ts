import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // PLAN §2: Cache Components; every cacheTag is tenant-prefixed (lint rule bs/tenant-cache-tag).
  cacheComponents: true,
  // Docker image copies .next/standalone (built in GitHub Actions, never on the VPS).
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  // pg + pino use Node internals; keep them as runtime requires instead of bundling.
  serverExternalPackages: ["pg", "pino", "pg-boss"],
};

export default config;
