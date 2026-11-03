# Website Home page and Pricing table widget in the builder

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** merged in #209, eb1d9e7
- **Area:** blocks, block-editor, domain, web
- **Type:** feature
- **Supersedes:** none

## Summary
Slice S4 of Phase 5 (`docs/MARKETING-SITE-CMS-PLAN.md` section 5a), first part. Home is editable from Super Admin and a new Pricing table widget shows the live plans.

## What changed
- `MkPricing` block: heading and description are editable; the plans, prices and limits come live from Super Admin > Plans (`loadLandingPlans`, seeded values as fallback). Usable on Home and on any website page. The editor shows a placeholder.
- Home: "home" is a reserved page URL, so creating a page with the slug `home` in Storefront > Pages stores it as `bcom-home` and starts it from a layout built from the same sections as today's home (the live-product mockups and AI tabs are not blocks, so the starter approximates them). When `bcom-home` is published it replaces the built-in Home at `/`; unpublish (or any read failure) returns the built-in page (ADR-011). It is left out of the sitemap.

## Verification
Unit: blocks 269, block-editor 28. Real database: `apps/platform/test/marketing.int.test.ts` (16), including the Home creation, its starter and the sitemap exclusion.

NOT verified: Home rendering in a browser, the pricing widget on a phone, the live site. Not done: Blog archive and Blog post templates in the builder (rest of S4).

## Definition of done
Not done until merged: see `AGENTS.md` section 7.
