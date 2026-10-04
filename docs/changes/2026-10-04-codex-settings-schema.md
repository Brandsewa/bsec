# Settings target schema

- **Date:** 2026-10-04
- **Agent:** codex
- **Branch:** `codex/settings-rebuild-plan` (not merged yet)
- **Area:** docs, db, domain, contracts, admin
- **Type:** docs
- **Supersedes:** none

## Summary
Added a separate target-schema document for the Settings rebuild. It defines settings data ownership, fields, validation, permissions, security boundaries, planned entities, API shape, migration order and required tests without changing the live database or application behaviour.

## What changed
- Added `docs/SETTINGS-SCHEMA.md` as the companion to `docs/SETTINGS-REBUILD-PLAN.md`.

## Decisions and trade-offs
- Secrets remain typed, encrypted `tenant_secrets`; generic credential blobs are not permitted.
- Merchant billing is a projection of platform records, and media storage remains platform-managed usage visibility only.
- Expanding shipping, policies, customer account settings and privacy uses independent tenant tables because their access/audit lifecycles differ from basic store details.

## Verification
- Ran: `node scripts/check-docs.mjs` (`docs:check ok`); `git diff --check` (pass).
- Read: existing `store_settings`, `brand_settings`, `store_status`, SaaS billing and onboarding schemas; current settings domain services and permission use; applicable ADRs and Settings rebuild plan.
- NOT verified: documentation-only change; no application code, migrations, providers or UI were run.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` — not needed; no structure changed.
- [ ] ADR — not written; granular permission model requires one before implementation.
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed.
- [x] `progress.md` — existing Settings plan claim remains active.

## Follow-ups and open questions
- Owner must resolve the decisions in the rebuild plan before schema implementation begins.
- Convert the permission table into an ADR before changing roles/permissions.

## Definition of done
Docs only: no production, secrets, generated files or application code changed.
