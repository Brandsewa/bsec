# ADR-042: bcom.si content lives under one internal tenant, edited from Super Admin

- **Status:** Accepted
- **Date:** 2026-11-02
- **Plan reference:** `docs/MARKETING-SITE-CMS-PLAN.md`

## Context
The owner wants bcom.si's pages, navigation and blog managed from Super Admin, reusing the existing blog and Puck builder. Those features are tenant data: their tables require a `tenant_id`, and their services take a `TenantContext`. `apps/platform` connects as `app_platform`, which bypasses RLS, and some services rely on RLS alone (`listPages` selects from `pages` with no tenant filter). Calling them from the Platform API as-is would return every store's rows.

## Decision
- `tenants.kind` is `store` or `platform_site`. A partial unique index allows one `platform_site` row. It has no owner, plan, trial or domain row, and is created idempotently by `ensurePlatformSite`.
- It is hidden from store lists and metrics, and store actions refuse it (`assertStoreTenants`). Platform reset keeps it.
- Sweeps over all tenants are left alone: they find no orders or subscriptions on it, and `publishDueBlogPosts` must keep visiting it.
- `apps/platform` opens a second small pool as `app_rw` (`DATABASE_URL_RW`), used only by the `marketing.*` procedures. This is an owner-approved exception to the role split in AGENTS.md rule 9 (2026-11-02). No grant changes. If the variable is unset, Marketing fails closed and the rest of Super Admin works.
- The tenant id comes from the server, never from a request.
- Marketing is limited to `platform_admin` and above.
- Each Marketing change writes `audit_logs` in the service's own transaction. `platform_audit_logs` is written right after commit, because the change runs on `app_rw`. A failed staff-trail write is logged and does not undo the change, an accepted exception to the same-transaction rule, since the tenant trail is always written.
- `packages/content-admin` holds the blog, menu and media screens. Each dashboard plugs in its API at startup. `marketing.*` reuses the admin contracts, so both stay in step.
- The blog on the marketing host reads the record directly (`blogAccess`). There is no domain row, so no other store route answers on bcom.si.

## Consequences
- The content services stay single-sourced, and RLS still applies to this path.
- New Super Admin store actions must call `assertStoreTenants`, and new store lists must filter on `kind`.
- A later marketer dashboard can reuse the same record and screens.

## Alternatives considered
- Separate marketing tables: no `app_rw` or exclusions, but duplicates the blog, pages and menus logic.
- Adding tenant filters to every service for `app_platform`: one missed query leaks store data, with nothing to catch it in the database.
- A restricted store admin at its own address: less code, but a second place to sign in.
