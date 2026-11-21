# Accounts and Profile plan (store staff, platform staff, customer)

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `feat/builder-copy-paste-delete` working tree (docs only, not committed)
- **Area:** docs, auth, admin, superadmin, web
- **Type:** plan
- **Supersedes:** none

## Summary
Plan for dedicated, tabbed Account pages for store owner/staff, platform staff and customers, replacing today's Password/Theme/Sign out menus. Plan is in `docs/ACCOUNTS-PROFILE-PLAN.md`. No code changed.

## What changed
- New `docs/ACCOUNTS-PROFILE-PLAN.md`: current-state survey, best-practice summary, tab layouts per audience, data model, API/domain design, three phases in the owner's priority order, acceptance criteria, owner decisions, risks.

## Decisions and trade-offs
- Staff auth gets the existing Better Auth `twoFactor` plugin (already used on the platform instance); merchant MFA proposed as optional first.
- Step-up re-auth through one shared helper rather than per-screen checks.
- Owner transfer, SSO, API tokens and saved payment methods deferred.

## Verification
- Read: `packages/auth/src/{staff,platform}.ts`, `packages/db/src/schema/{identity,platform,customers,saas}.ts`, admin `_store.tsx` account menu, admin and superadmin `lib/auth.ts`, storefront `AccountNav` and `ProfileForm`.
- Best-practice points come from OWASP/NIST/common SaaS knowledge, not a fresh web search.
- NOT verified: runtime behaviour, `pnpm docs:check`, that migration numbering is free.

## Docs updated
- [x] new plan doc; [ ] `progress.md` In flight, ADR-043 and `ARCHITECTURE.md` deferred until the owner answers section 9 and a phase starts.

## Follow-ups and open questions
See plan section 9 (Q1–Q6).
