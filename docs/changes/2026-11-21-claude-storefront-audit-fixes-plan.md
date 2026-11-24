# Storefront audit fixes plan

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `docs/audit-fixes-plan` (never pushed; the plan went to `main` inside #313, 13634f36)
- **Area:** docs
- **Type:** docs
- **Supersedes:** none

## Summary
Three external quality audits of live stores were mapped finding by finding to our code. About a dozen findings are platform defects or missing guardrails (404 breadcrumb and `/collections/all` defaults, hardcoded free-shipping banner text, empty `brand` in product schema, empty meta descriptions, missing alt text, no redirect tooling, no www guidance). The plan groups them into four phases for one branch.

## What changed
- New `docs/STOREFRONT-AUDIT-FIXES-PLAN.md`: findings table with code locations, four phases with acceptance criteria, a list of items to verify before fixing, owner decisions, test plan.
- `progress.md`: one line in "In flight" for the plan.
- No code changed.

## Decisions and trade-offs
- Merchant and store names are left out of the plan because the repo is public; the raw reports stay with the owner.
- Mojibake, Cloudflare email obfuscation, hreflang and the sitemap policy claim are listed as "check first": the code does not support them as written in the audits.

## Verification
- Ran: `node scripts/check-docs.mjs` (the docs half of `pnpm docs:check`): ok. The migrations-immutable half was not run.
- Read only: every code location in the plan was read at `origin/main` 7dabf0b2. Nothing was run against any live store.
- NOT verified: that each audit finding reproduces today.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, no structure change yet
- [ ] ADR: not needed for the plan; the redirect manager needs one before it is built
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
See section 5 of the plan (four owner decisions).

## Definition of done
Docs only: no secrets, no generated files, no unrelated edits.
