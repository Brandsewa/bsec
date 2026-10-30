# CI seed creates the store's base market

- **Date:** 2026-10-30
- **Agent:** claude
- **Branch:** `fix/ci-seed-base-market` (merged in #156, e975098)
- **Area:** ci
- **Type:** fix
- **Supersedes:** none

## Summary
The staging smoke test on `main` still failed after the e2e login fix (#155): `markets.spec.ts` could not create a market because the CI store has no base market. The job inserts the tenant with raw SQL, which skips provisioning, and provisioning (and the 0087 backfill for existing stores) is what creates the base market. Production is unaffected: every real store has one. The CI seed now inserts the India base market and its country row, as provisioning does.

## What changed
- `.github/workflows/ci.yml`: the staging seed SQL adds one `markets` row (base, active, INR) and one `market_countries` row.

## Verification
Not provable by the PR: the staging smoke test only runs on `main`. The failing state was read from the CI e2e report (empty markets table in the screenshot). Watch the next `main` run.

## Open questions
- Stores created outside provisioning (raw SQL, `infra/loadtest/seed.ts`) have no base market; the storefront falls back to the legacy single-market path, but the Markets admin cannot create a market for them.

## Definition of done
- [x] Change record
- [ ] After merge: confirm the `main` run deploys, delete this branch
