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
  // Browser hardening that is safe without per-page tuning (audit A7-01; docs/audit/2026-11-A7-attack-surface.md). A Content-Security-Policy
  // and frame-ancestors are NOT set here: the admin page editor frames the storefront, and the checkout loads Stripe, Razorpay, GA4,
  // Meta and Turnstile, so they need a staged report-only rollout checked in a browser first (see the audit decisions log).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=()" },
          // Browsers ignore this over plain http, so local development is unaffected. No includeSubDomains or preload: stores
          // live on many subdomains and custom domains, each of which must opt in by being served over HTTPS (Cloudflare does).
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
  async rewrites() {
    return { beforeFiles: [{ source: "/:key([a-f0-9]{32}).txt", destination: "/api/indexnow-key/:key" }], afterFiles: [], fallback: [] };
  },
};

export default config;
