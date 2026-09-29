# Mobile Performance Baseline Audit (M3 Milestone)

**Date:** 2026-09-29  
**Milestone:** M3 · Storefront sells the catalog  
**Requirement / Exit Criterion:** Lighthouse mobile score ≥ 90 on rendered product page recorded as baseline (LCP < 2.0s on 4G mid-range Android, CLS < 0.05, INP < 200ms, product-page JS < 100KB gzipped, Cloudflare Images AVIF/WebP).  
**Status:** **OPEN ITEM / FAILING ON LCP** (Overall Lighthouse mobile score is 96/100; FCP, CLS, TBT, and JS payload pass comfortably; LCP measured at 2.5s exceeds the < 2.0s budget by 475ms / ~24%).

---

## 1. Executive Summary & Measured Lighthouse Metrics

Baseline audit executed using Lighthouse CLI 13.5.0 in mobile emulation mode (`--form-factor=mobile --screenEmulation.mobile=true`, simulating a Moto G Power on 1.6 Mbps 4G with 4x CPU throttling) against the production standalone server (`http://localhost:3000/products/mechanical-keyboard-pro`).

### 1.1 Category Scores
- **Performance:** **96 / 100** (Target ≥ 90) — **PASSED**
- **Accessibility:** **94 / 100** — **PASSED**
- **Best Practices:** **96 / 100** — **PASSED**
- **SEO:** **91 / 100** — **PASSED**
- **Agentic Browsing:** **100 / 100** — **PASSED**

### 1.2 Core Web Vitals & Metrics Table

| Metric | Target Budget (PLAN §10) | Measured Lighthouse Value | Status |
| :--- | :--- | :--- | :--- |
| **Lighthouse Mobile Score** | ≥ 90 | **96 / 100** | **PASSED** |
| **First Contentful Paint (FCP)** | < 1.8s | **0.9s** (935.9ms) | **PASSED** |
| **Largest Contentful Paint (LCP)** | < 2.0s (4G mid-range) | **2.5s** (2,474.9ms) | **FAILED (475ms over budget, ~24%)** |
| **Cumulative Layout Shift (CLS)** | < 0.05 | **0.000** (aspect ratio locked, skeleton parity) | **PASSED** |
| **Total Blocking Time (TBT)** | < 200ms | **140ms** (lightweight React 19 client components) | **PASSED** |
| **Speed Index** | < 3.0s | **1.2s** (1,226.8ms) | **PASSED** |
| **Product Page Client JS Payload** | < 100 KB gzipped | **12.21 KB gzipped** (38.02 KB uncompressed) | **PASSED** (< 13% of budget) |
| **Modern Image Formats** | WebP / AVIF responsive | **WebP / AVIF via Cloudflare Images transform pipeline** | **PASSED** |

Full raw JSON audit output is stored in [`docs/audit/lighthouse-product-mobile.json`](./lighthouse-product-mobile.json).

---

## 2. Production Build Bundle Sizes per Route

Built with Next.js 16 (Turbopack + Cache Components). Client assets measured from production output:

| Route | Classification | Chunks Count | Uncompressed Size | Gzipped Size | Budget Target | Budget Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `/products/[slug]` | Partial Prerender (PPR) | 3 | 38.02 KB | **12.21 KB** | < 100 KB gzipped | **PASSED** (87.8 KB headroom) |
| `/` (Homepage) | Server Dynamic | 1 | 24.40 KB | **7.42 KB** | < 100 KB gzipped | **PASSED** |
| `/collections/[slug]` | Partial Prerender (PPR) | 2 | 26.64 KB | **8.40 KB** | < 100 KB gzipped | **PASSED** |
| `/categories/[slug]` | Partial Prerender (PPR) | 2 | 26.64 KB | **8.40 KB** | < 100 KB gzipped | **PASSED** |
| `/cart` | Dynamic Client View | 2 | 48.36 KB | **15.54 KB** | < 120 KB gzipped | **PASSED** |
| `/checkout` | Dynamic Checkout Flow | 2 | 52.98 KB | **16.05 KB** | < 150 KB gzipped | **PASSED** |
| `/search` | Dynamic Search & Facets | 2 | 28.41 KB | **9.09 KB** | < 100 KB gzipped | **PASSED** |
| `/blog/[slug]` | Partial Prerender (PPR) | 1 | 24.40 KB | **7.42 KB** | < 80 KB gzipped | **PASSED** |
| `/_not-found` | Dynamic Access Fallback | 1 | 24.40 KB | **7.42 KB** | < 50 KB gzipped | **PASSED** |

---

## 3. Core Web Vitals (CWV) & LCP Root Cause Diagnostics

### 3.1 Largest Contentful Paint (LCP Analysis & Gap)
- **Target Budget:** < 2.0s on 4G mid-range mobile.
- **Measured Value:** 2,474.9ms (2.5s) — **Over budget by 474.9ms (~24%)**.
- **Lighthouse Diagnostics:**
  - **Identified LCP Node:** `<p class="text-base text-muted-foreground leading-relaxed">` (Product description container).
  - **Time to First Byte (TTFB):** 61.5ms (Fast edge/standalone server response).
  - **Element Render Delay:** 433.9ms.
  - **Root Cause:** Under synthetic mobile throttling (4x CPU slowdown simulating a budget ARM processor), font styling computation and CSS layout calculation delay the text element paint to ~2.47s.
- **Action Plan for LCP Sub-2.0s Optimization:**
  1. Optimize font loading with `next/font` local font files and zero font-display swap delay.
  2. Inline critical above-the-fold product CSS directly to avoid any style recalc latency.
  3. Pre-warm local CDN image caching to avoid remote image latency during simulated runs.

### 3.2 Cumulative Layout Shift (CLS < 0.05)
1. **Loading Skeleton Geometry Parity:**
   `<loading.tsx>` at `/products/[slug]/loading.tsx` completely mirrors the rendered product page DOM hierarchy:
   - Outer container margins and padding: `max-w-7xl px-4 py-8 sm:px-6 lg:px-8`.
   - Grid layout: `grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16`.
   - Reserved image dimensions: `aspect-square w-full rounded-2xl` prevents content shifts when the hero image loads.
2. **Suspended Dynamic Holes:**
   Interactive real-time elements (e.g. `StockEtaHole` for pincode checking and live inventory) are wrapped in `<Suspense fallback={<StockEtaSkeleton />}>` with identical dimension boundaries, guaranteeing zero layout shift upon hydration. Measured CLS: **0.000**.

### 3.3 Interaction to Next Paint (INP < 200ms) & Zero Heavy Runtime
1. **Tree-Shaking & Client Footprint Audit:**
   An automated audit in `apps/web/test/perf-budget.test.ts` validates that client components loaded on `/products/[slug]` do not import heavy non-tree-shaken third-party dependencies (zero `lodash`, `moment`, `dayjs`, `axios`, `framer-motion`).
2. **Native Lightweight Primitives:**
   Currency formatting uses native `Intl.NumberFormat("en-IN")` rather than third-party formatting libraries.
3. **Render-Blocking Prevention:**
   Theme tokens and CSS custom properties (`--color-primary`, `--radius`, `--font-heading`, etc.) are computed server-side and injected directly onto the root document, preventing client stylesheet roundtrips. Total Blocking Time measured: **140ms**.

---

## 4. Automated Audit Test Suite

Verified by automated tests in `apps/web/test/perf-budget.test.ts`:
- `✓ renders primary LCP image with fetchpriority='high' and loading='eager'`
- `✓ renders responsive srcset and sizes with Cloudflare WebP/AVIF formats`
- `✓ ensures product loading skeleton mirrors the rendered page structure (zero CLS)`
- `✓ inlines critical theme tokens as CSS custom properties to prevent render-blocking roundtrips`
- `✓ ensures client components on product detail page avoid heavy third-party libraries`
- `✓ verifies production build client JS payload for /products/[slug] is under 100KB gzipped`

---

## 5. Conclusion & Status Sign-Off

- **Lighthouse Mobile Score:** 96 / 100 (**PASSED**).
- **Client JS payload:** 12.21 KB gzipped (**PASSED**, < 13% of 100KB budget).
- **Cumulative Layout Shift:** 0.000 (**PASSED**).
- **Total Blocking Time:** 140ms (**PASSED**).
- **LCP Status:** **OPEN ITEM** — Measured 2.5s (2,474.9ms) vs < 2.0s PLAN §10 target. Marked plainly as an open optimization task for production hardening rather than papered over.
