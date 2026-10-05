# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Primary: an Indian direct-to-consumer founder or small-brand owner starting an online store (food, apparel, handicrafts, general retail), often selling on Instagram or marketplaces today, who wants to be selling within days and cares about cash on delivery and GST. Secondary (confirmed by the owner, 2026-10-04): a seller moving from another platform, and an agency or consultant building stores for clients (Super Admin can create a store for a client). There is no migration or import tool today, so the page must not promise one.

## Product Purpose
bsec (brand name on the site: bcom.si) is a multi-tenant commerce SaaS for Indian D2C stores. A merchant picks a store name, gets `{name}.bcom.si`, a themed storefront and an admin, and takes cash-on-delivery orders with GST invoices. Success for the marketing page: a visitor understands what they get, trusts that it is real, checks a store name and starts the 14-day trial (`/signup`).

## Positioning
India-first commerce with the legal and operational details already in the product (GST place of supply and invoices, COD with fees, per-store shipping rates, returns and exchanges, pre-orders, quotes) plus a **visual theme builder** that merchants and agencies use without writing code (blocks only, no custom code), on infrastructure where every store is isolated from every other.

## Operating Context
Visitors arrive on bcom.si from search or referrals on mostly mobile devices over variable connections. Signup is `bcom.si/signup` (store name check, template, plan, Cloudflare Turnstile). Store admin is `admin.bcom.si`; storefronts are `{slug}.bcom.si`.

## Capabilities and Constraints
Live today (verified in the repo, 2026-10-04): COD checkout with a per-store fee; per-store shipping zones and rates; GST tax invoices (no PDF yet); product catalog with variants, categories, collections, brands, locations/inventory; reviews with moderation; discounts; customers with segments, import/export and marketing consent; orders with returns and exchanges, quotes ("request a quote"), pre-orders and abandoned-checkout tracking; staff roles and activity log; platform themes with a visual block editor (cart, product, collection, home, header, footer), theme preview; store admin and Super Admin; 14-day free trial; plans Starter ₹999, Growth ₹2,499, Pro ₹5,999 per month (read from the `plans` table; prices and limits live there).
**Not live (must appear only as "Coming soon", or not at all):** Razorpay online payments and UPI, Shiprocket labels and tracking, WhatsApp and SMS notifications, email delivery (provider credentials pending), custom-domain provisioning (backend built, provider not connected), invoice PDF download, migration/import from other platforms, plan self-service billing.
**Must not appear:** "zero commission" or "no transaction fees" guarantees, a 24/7 SLA, flash-sale protection, pincode counts, customer logos, revenue or growth numbers, testimonials (none exist).
Prices are INR and plus GST.

## Brand Commitments
Name on the page: **bcom.si** (domain `bcom.si`). Existing logo is a placeholder (a green "g" tile); a new mark is in scope for the redesign. Voice: plain, confident, India-aware, no hype.

## Evidence on Hand
Real product surfaces to show as proof: the store admin (orders, customers, segments, returns), the theme editor with blocks, the storefront themes (Essential Commerce, Fashion Editorial, Gourmet Artisan, Starter Minimal, Modern Commerce draft), the COD order flow, the GST invoice data. One real store exists (Taste of Hills, `tasteofhills.bcom.si`); no permission or quote has been given to feature it. Absent, and must not be fabricated: customer testimonials, logos, statistics, press.

## Product Principles
1. Say only what a merchant can do today; label the rest "Coming soon".
2. Show the real product (admin, editor, storefront) instead of describing it.
3. India specifics are the proof (COD, GST, rupee pricing), not decoration.
4. One clear action: check a store name, start the 14-day trial.
5. Fast and light on a phone over a mid-range connection.

## Accessibility & Inclusion
WCAG 2.2 AA target; respects `prefers-reduced-motion`; fully usable at 375 px; English only for now (owner decision: India, English).
