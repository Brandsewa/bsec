# Plan: categories, collections, brands, locations, reviews, indexing

- **Date:** 2026-10-02
- **Agent:** claude
- **Branch:** `chore/repo-guardrails` (not merged yet; docs only, nothing committed)
- **Area:** docs, admin, domain, web, db
- **Type:** docs
- **Supersedes:** none

## Summary
Turns the owner's answers to the Products findings into `docs/PRODUCTS-CATALOG-PLAN.md`. Phases A to E (indexing foundations, categories, collections, brands and locations, basic reviews) avoid the files the Orders branches edit. Phase F (sidebar, product form, primary category, Unlisted, inventory polish) is held until the Orders work merges.

## What changed
- New `docs/PRODUCTS-CATALOG-PLAN.md`; an "Owner answers" section appended to `docs/PRODUCTS-SECTION-FINDINGS.md`.

## Decisions and trade-offs
- Categories always indexable, no switch; collections default noindex with a per-collection switch (existing collections become noindex: called out in the plan).
- Confirmed by the owner: empty categories and collections are served noindex automatically.
- Unlisted needs a split between direct-page and listed product statuses; every use of `STOREFRONT_PRODUCT_STATUSES` must be audited.
- Reviews: held for moderation by default; verified-purchase only; plain text.

## Verification
- Ran: `pnpm docs:check`.
- Read, not run: all bsec claims come from reading the code. Nothing in bsec was run or changed.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`, ADR, `DEPLOYMENT.md`, `progress.md`: not needed (docs only)

## Follow-ups and open questions
- After the Orders work merges, Claude updates Phase F, then writes the Antigravity prompts.

## Definition of done
Docs only: no secrets, no generated files, no unrelated edits.

## Revision (Orders work built)
Phase F of the plan was updated against `feat/orders-returns` (`7a7f49f`): base branch and next migration number (`0024`), what the product editor now contains, and three deviations found in the Orders work that Phase F fixes: no `switch.tsx` was added, `products.returnable` is enforced by the server but cannot be set anywhere in the admin, and Q9 changed because Quotes and Price on request were built.
