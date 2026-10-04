# Findings: Products section vs the Storify reference

- **Date:** 2026-10-02
- **Agent:** claude
- **Branch:** `chore/repo-guardrails` (not merged yet; docs only, nothing committed)
- **Area:** docs, admin, domain
- **Type:** docs
- **Supersedes:** none

## Summary
Mapped Storify's Products area (All products, Global variants, Collections, Categories, Brands, Inventory, Locations, Transfers, Reviews) against bsec and wrote `docs/PRODUCTS-SECTION-FINDINGS.md`: layout and structure, a per-section verdict, a design for indexable categories and optional-indexable collections, and nine owner questions. No application code changed.

## What changed
- New `docs/PRODUCTS-SECTION-FINDINGS.md`.

## Decisions and trade-offs
- Findings only; no build plan or prompt until the owner answers Q1 to Q9.
- Flagged a collision risk: the in-flight Orders work (pre-orders, returns) edits the product editor.

## Verification
- Ran: `pnpm docs:check`.
- Exercised by hand: browsed Storify's product list, collections, categories, brands, global variants, inventory, transfers, reviews and the new product, category and collection forms (read only, nothing saved).
- Read, not run: Storify and bsec code. NOT verified: nothing in bsec was run or changed. Storefront SEO claims come from reading `apps/web` and `packages/domain/src/storefront/seo.ts`.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`, ADR, `DEPLOYMENT.md`: not needed (no code or structure change)
- [ ] `progress.md`: not updated

## Follow-ups and open questions
- Owner questions Q1 to Q9 in the findings file.
- Gap found: bsec stores `seo` JSON on products, categories and collections but the storefront ignores it and sets no robots meta per page.

## Definition of done
Docs only: no secrets, no generated files, no unrelated edits.
