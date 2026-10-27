# Owner fix batch: widgets, reviews, discounts, blog, account, checkout, footer

- **Date:** 2026-10-27
- **Agent:** claude
- **Branch:** `feat/owner-fix-batch` (merged in #145, 2464247)
- **Area:** blocks, block-editor, db, domain, contracts, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
The owner's list of 50 items from one session, built in one branch: four theme widgets, discount edit and archive, review moderation and import, newsletter Leads and a contact-form inbox, a magazine blog index and post page, and a round of storefront fixes (header, account, checkout, footer, categories, page background).

## What changed
- **Header:** Cart now comes before Login; the hidden mobile menu toggle no longer pushes the logo off the left edge; after Google sign-in the shopper lands on the home page; the header shows the Google photo (`customer_identities.picture`, migration 0083) next to the name.
- **Account:** content no longer overflows on phones; tabs scroll; Sign out is a grey button; less top padding; desktop navigation sits in a card; the tab loading skeleton draws from `--muted` (it was an empty outlined box).
- **Checkout:** page background follows the theme (`--bs-site-bg` on `body`); cards are near-white with theme-derived fields (`.bs-panel`, `.bs-field`); quantity badge no longer clipped; full name moved to Contact (and the separate shipping block); notes accordion uses the panel colour.
- **Footer:** copyright left, a fixed "Powered by BS Commerce" link right (rendered by the view, not a prop); social icons are solid brand glyphs unless Outlined.
- **Categories** use the collection template (`/categories/[slug]` reuses `CollectionListingSection`).
- **Blocks:** Contact form (`ContactForm`), Gallery (masonry, per-device columns, viewer), Multi card style 2, Coupon cards (`ProductCoupons`).
- **Discounts:** edit page (`/discounts/$id`), `admin.discounts.get`, archive and restore, delete archives a used discount (migration 0085 adds `show_on_storefront`).
- **Reviews:** statuses spam and archived, `reviews.setStatus`, `reviews.create` (manual), `reviews.import` (CSV, dry run, duplicate skip), CSV export, `source` column (migration 0084).
- **Admin:** Leads (`admin.leads.*`, over `newsletter_subscribers`) and Form submissions (`admin.forms.*`, `form_submissions`, migration 0086); star toggle for featured posts.
- **Blog:** magazine index and post layouts (new block props, defaults to magazine), `getBlogMagazine`, `getBlogSidebar`, category page without breadcrumb and with less top padding.

## Decisions and trade-offs
- **Leads** reuse the existing `newsletter_subscribers` table instead of a new `leads` table: it already holds email, source, consent date and status, and the footer form already writes it. The blog form posts with source `blog`.
- **Featured posts** reuse `blog_posts.is_featured` (already in the schema and editor); no tag system was added.
- **Contact form email:** delivery is not live, so submissions are stored and the configured recipient is recorded on the row. Sending is a follow-up.
- **Coupons** are listed only when the merchant switches on "Show on the storefront" per discount (default off) so private codes stay private.
- **Item 23 (remove the old Theme Builder layout presets) was not done:** no preset gallery was found in the editor code, and removal needs the expand, migrate, contract path (ADR-009). Needs the owner to point at the screen.
- The table of contents is sticky with CSS only (no active-section highlight).

## Verification
- Ran: `pnpm typecheck` (15 of 15 pass), `pnpm lint` (0 errors; existing warnings), `pnpm docs:check` ok, `test:fast` for blocks (261), block-editor (26) and web (234) pass, `isolation.int.test.ts` against real Postgres: 1595 pass (new procedures mapped: discounts.get, reviews.setStatus/create/import, forms.*, leads.*). Migrations 0083 to 0086 applied to the local dev database.
- Exercised by hand (local dev store `demo-store`, browser pane, DOM checks): header order Search, Cart, Login; coupon cards (2 shown, View all drawer lists 4, archived excluded); magazine blog index (headline, subscribe form, latest and 5 side posts, a row per category); post page (grid, 4-item sticky contents, sidebar with about card, 3 featured posts, categories); `/categories/apparel` renders through the collection template; page background follows the theme; footer shows the fixed "Powered by BS Commerce" link; mobile logo sits at the 16px gutter.
- NOT verified: every admin screen (Leads, Form submissions, discount edit, review tools) was type-checked and built by vite but not driven, because the owner login lives in `.env.dev`, which agents cannot read; the signed-in account area, checkout visuals, Gallery viewer, Contact form submit, Multi card style 2 in the editor; the full `test:heavy` suite (only the isolation file was run); e2e selectors for the two new sidebar entries.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 7, 10)
- [x] ADR: not needed (no new architectural decision)
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Send contact-form emails through the notification manager once delivery is live.
- Tags on leads for segmenting; linking a lead to a customer who later orders.
- Mobile header showing "Login" while signed in (seen once in a screenshot) was not reproduced.

## Definition of done
Gate status is recorded in Verification.
