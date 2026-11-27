# Fix merchant storefront footer legal policy links

- **Date:** 2026-11-27
- **Agent:** antigravity
- **Branch:** `fix_merchant_footer_legal_links` (not merged yet)
- **Area:** contracts, domain, content-admin, web, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Legal policy items in merchant storefront footer menus were not linking to their policy pages (`/policies/privacy`, `/policies/terms`, `/policies/refund`, `/policies/shipping`, `/policies/legal_notice`). In **Online Store > Navigation** (`MenuEditorScreen`), picking Link Type **Policies** (`type: "policy"`) offered no policy selector and saved every item with `url: "/policies"`, while storefront menu resolution (`loadMenusData`) returned `rawUrl || "/policies"` without resolving `targetId` or repairing legacy `/policies` items, and `/policies` itself had no route (404).

## What changed
- **Shared policy link helpers (`packages/contracts/src/policy-links.ts`, exported from `@bs/contracts`):**
  - Added `STORE_POLICY_HANDLES`, `STORE_POLICY_LINK_OPTIONS`, `isStorePolicyHandle`, `extractPolicyHandleFromUrl`, `inferPolicyHandleFromLabel`, and `resolvePolicyMenuHref`.
- **Menu editor policy picker (`packages/content-admin/src/menus/MenuEditorScreen.tsx`):**
  - Added a **Select Policy** dropdown when `type === "policy"` so merchants pick a specific policy (`Privacy Policy`, `Terms of Service`, `Refund & Cancellation Policy`, `Shipping Policy`, `Legal Notice`), setting both `targetId` (handle) and `url` (`/policies/<handle>`).
  - Pre-populates `targetId` / `url` when editing legacy `policy` items saved with `/policies` or empty URLs, and blocks saving a `policy` item without a selected policy.
- **Domain menu resolution & defaults (`packages/domain/src/themes/block-data.ts`, `packages/domain/src/content-services.ts`, `packages/domain/src/menu-defaults.ts`, `packages/domain/src/admin/link-rules.ts`):**
  - `loadMenusData` now resolves `type: "policy"` items from `targetId` (either a policy handle or a `store_policies.id` row UUID), explicit `/policies/<handle>` URLs, or label inference when legacy items were saved with `url: "/policies"` or `""` (including `type: "url"` items pointing to `/policies`).
  - `tidyMenuLinks` normalizes `policy` menu items on create/update; `defaultFooterMenuItems` includes `targetId` on starter policy items; `STATIC_PATHS` in `link-rules.ts` includes `/policies`.
- **Storefront `/policies` index route (`apps/web/src/app/policies/page.tsx`, `apps/web/src/app/policies/loading.tsx`):**
  - Added a Store Policies index page at `/policies` (with sibling `loading.tsx` per `bs/route-pending`) listing the store's policies (respecting `settings.policies` published visibility).
- **Tests:**
  - `packages/contracts/test/policy-links.test.ts` (unit tests for policy handle extraction, label inference, and href resolution).
  - `packages/domain/test/storefront-menus.int.test.ts` (real-Postgres integration test for footer `SiteFooter` policy menu resolution across handle `targetId`, `store_policies.id`, and legacy `/policies` items).
  - `packages/domain/test/link-health.test.ts`, `apps/web/test/storefront-pages.test.ts`, `apps/admin/test/online-store-pages.test.tsx`.

## Decisions and trade-offs
- Put the pure policy link map and label inference in `@bs/contracts` so `@bs/content-admin` (browser) and `@bs/domain` (server) share one source of truth, and Super Admin's Marketing navigation screen (where `orpc.admin.policies` is not wired) keeps working without extra API calls.
- Repaired legacy `/policies` items at render time in `loadMenusData` and on edit in `MenuEditorScreen` instead of running a cross-tenant data migration against forced-RLS `menus` rows, so existing merchant storefronts work immediately on deploy.

## Verification
- `pnpm typecheck`: passed (20/20 packages).
- `pnpm lint`: passed (19/19 packages, 0 errors; 7 pre-existing warnings in `@bs/web`).
- `pnpm docs:check`: passed (`docs:check ok`, `migrations lock ok (117 recorded)`).
- `pnpm --filter @bs/contracts test:fast`: passed (8 files, 54 tests).
- `pnpm --filter @bs/domain test:fast`: passed (93 files, 861 tests).
- `pnpm --filter @bs/admin test:fast`: passed (27 files, 162 tests).
- `pnpm --filter @bs/web test:fast`: passed (43 files, 310 tests).
- `pnpm --filter @bs/blocks test:fast`: passed (33 files, 313 tests).
- `pnpm --filter @bs/superadmin test:fast`: exited 0 (0 test files).
- `pnpm build`: passed (6/6 tasks, Next build includes `├ ƒ /policies`).
- `pnpm --filter @bs/domain exec vitest run test/storefront-menus.int.test.ts`: **skipped (10 tests)** — Docker Desktop daemon pipe (`//./pipe/dockerDesktopLinuxEngine`) was not running and `TEST_DATABASE_URL_SUPERUSER` was unset locally; CI `check-heavy` will run the real-Postgres suite.
- Browser walkthrough and Notion BCOM Platform OS sync: not run in this session.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 9 storefront route map: added `/policies`, bumped `Last verified against`)
- [ ] ADR: not needed (no architectural change; completes policy menu resolution under ADR-027 / ADR-011)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed (no env vars, services, ports or deploy steps changed)
- [x] `progress.md` ("In flight" line added)

## Follow-ups and open questions
- Remove the `progress.md` "In flight" line and update the `Branch:` line after merge per `AGENTS.md` section 5.
- Update Notion BCOM Platform OS per `AGENTS.md` section 6 rule 7 (not updated in this session).

## Definition of done
- [x] Code follows section 2 and 3; fast checks, lint, typecheck, docs:check and build pass (`storefront-menus.int.test.ts` pending CI real Postgres).
- [x] Tests added or updated (unit/fast tests passed; real-DB test added in `packages/domain/test/storefront-menus.int.test.ts`, skipped locally without Docker Desktop).
- [x] `docs/ARCHITECTURE.md` updated for `/policies`.
- [x] Change record in `docs/changes/` and `progress.md` updated.
- [ ] Notion updated per the Session protocol (not updated in this session).
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status reported.
