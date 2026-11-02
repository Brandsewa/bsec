# Marketing section foundation: internal website record and Super Admin entry

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `feat/marketing-site-cms` (merged in #198, d70fd8d)
- **Area:** db, domain, contracts, platform, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
First two phases of `docs/MARKETING-SITE-CMS-PLAN.md`. bcom.si's content gets one internal tenant record, hidden from store screens and refused by store actions, and Super Admin gets a Marketing entry for owners and admins. Pages, navigation and blog screens are not built yet.

## What changed
- Migration `0095_platform_site_kind`: `tenants.kind`, a check, a partial unique index and a reserved slug.
- `packages/domain/src/platform/platform-site.ts` and `marketing.ts`: `getPlatformSiteId`, `assertStoreTenants`, `enablePlatformSite` (audited), `platformSiteContext`.
- Store lists, detail, overview metrics and platform reset skip the record. Suspend, restore, archive, plan change, trial extension, activate, ownership transfer, bulk actions, deletion, promotions and support sessions refuse it.
- `marketing.status` and `marketing.enable` procedures, admin and above. `/marketing` page and a Marketing sidebar group in Super Admin, hidden from support.
- `apps/platform` opens an optional `app_rw` pool from `DATABASE_URL_RW` (`CONTENT_DB_POOL_MAX`, default 2).

## Decisions and trade-offs
See ADR-042. The record is created by a button rather than at deploy, so it has an audit row and no test or job sees it until it is wanted. It has no domain row, so store APIs on the marketing host are unchanged; Phase 3 reads the id directly for the blog.

## Verification
- `pnpm gate:quick`: see the final run in the session; heavy domain 2,771 pass and db 20 pass on real Postgres; platform audit-coverage and read-endpoints re-run after their fixes, 123 pass; `platform-site.int.test.ts` 13 pass, `rbac.int.test.ts` 4 pass.
- `finance-reconcile.int.test.ts` failed twice in the full serial domain run and passed alone (5 pass). It does not touch this change's code; CI will show whether it repeats.
- Migration applied to the local dev database.
- NOT verified: the `/marketing` page in a browser (Super Admin needs a staff MFA sign-in locally); a real `DATABASE_URL_RW` connection from the running Platform service (tests use the same role through a test runtime).

## Docs updated
- [x] ADR-042
- [x] `DEPLOYMENT.md` (`DATABASE_URL_RW`)
- [x] `docs/ARCHITECTURE.md` (migration list)
- [x] `progress.md` (in-flight)

## Follow-ups and open questions
- Phase 3 onward from the plan.
- `DATABASE_URL_RW` must be set on `bsec-platform` in Coolify (owner) for Marketing to open.

## Definition of done
Merged and deployed 2026-11-02. Phase 5 is still to do.
