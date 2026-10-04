# Settings Rebuild Phase 3: Branding, Storefront Status, Custom Domains & Pre-Migration Defect Fixes

- **Date:** 2026-10-04
- **Agent:** antigravity
- **Branch:** `feat/settings-rebuild-phase-3` (not merged yet; ready for Claude verification)
- **Area:** domain, admin, web, contracts, auth, docs
- **Type:** feature
- **Supersedes:** none

## Summary

Implemented Settings Rebuild Phase 3 according to `docs/SETTINGS-PHASES-3-8-HANDOFF.md` and `docs/prompts/settings-rebuild-phase-3.md`. This phase fixes four pre-migration defects discovered during the initial settings audit (unreachable cache invalidation, replayable password/token hashes, unguarded custom domain procedures, and missing audit logging on brand settings mutations), tightens permission enforcement across branding, storefront status, and domains (`branding.manage`, `storefront.manage`, `domains.manage`, `settings.read`), introduces full media slot validation for branding assets (favicon dimensions/size, logo constraints, and SVG sanitization), updates the storefront settings page with mode explanations and live offline confirmation, and builds the full custom domains settings workspace with DNS configuration instructions and honesty checks.

## What changed

### 1. Defect Fixes (Failing-First Tests Passed)
- **Defect 1 (Cache Invalidation)**: Moved `invalidateCache(rt, ctx, { type: "store_or_seo_updated" })` to execute unconditionally after the database update transaction in `updateStoreStatus` (`packages/domain/src/storefront/lifecycle.ts`).
- **Defect 2 (Password & Bypass Token Security)**:
  - Upgraded store passwords to salted scrypt (`$scrypt$<saltHex>$<derivedKeyHex>`) via `hashStorePassword` and `verifyStorePassword`.
  - Added lazy migration helper `needsStorePasswordRehash` to rehash legacy SHA-256 hashes upon successful verification without locking users out.
  - Eliminated plain === hash bypass vulnerability: stored hashes can no longer be replayed as plaintext passwords or bypass tokens.
  - Pinned with 5 unit tests in `packages/domain/test/storefront-lifecycle.test.ts`.
- **Defect 3 (Domains Context, Permissions & Audit)**:
  - Gated domain services with `assertPermission`: `listTenantDomains` (`settings.read`), `addCustomDomain`, `verifyCustomDomain`, `setPrimaryDomain`, `removeCustomDomain` (`domains.manage`).
  - Added tenant-scoped audit logging to `schema.auditLogs` for domain additions (`custom_domain.add`) and removals (`custom_domain.remove`) inside `withTenant`.
  - Gated route handlers in `apps/web/src/server/api.ts` with `domains.manage` and `settings.read`.
  - Pinned with 11 real PostgreSQL integration tests in `packages/domain/test/custom-domains.int.test.ts`.
- **Defect 4 (Branding Media Slot Validation, Fonts & Audit)**:
  - Tightened contract validation in `packages/contracts/src/admin.ts`: defined `APPROVED_BRAND_FONTS` (13 curated fonts across Sans-serif, Geometric Sans, Humanist Sans, Serif, and Devanagari support) and `HexColorCode` (`/^#[0-9a-fA-F]{6}$/`).
  - Implemented `validateMediaSlot` in `packages/domain/src/brand-services.ts`:
    - Favicon: PNG, ICO, SVG only; <= 512 KB; rejected if non-square when dimensions are available.
    - Logos (light & dark): PNG, JPEG, WebP, SVG only; <= 5 MB.
    - Social sharing image: PNG, JPEG, WebP, SVG only; <= 5 MB.
    - SVG sanitization: `isUnsafeSvgContent` rejects `<script`, event handlers (`on\w+=`), `javascript:`, `vbscript:`, external hrefs (`http://`, `https://`), CSS `@import`, and CSS `url(...)`.
  - Cross-tenant media attachment verification: rejects media owned by other stores.
  - Audit logging: writes `brand_settings.update` (field diffs) and `brand_settings.publish` (version diff) to `schema.auditLogs` within `withTenant`.
  - Pinned with 8 real PostgreSQL integration tests in `packages/domain/test/branding.int.test.ts`.

### 2. Storefront Status (§3.2)
- Added `getStoreStatusInternal(rt, tenantId)` and asserted `settings.read` in `getStoreStatus`.
- Asserted `storefront.manage` in `updateStoreStatus`.
- Added `store_status.update` audit row with sanitized diff: records `mode`, `headline`, `message`, `launchTime`, `showCountdown`, `collectEmails`; logs password and bypass token strictly as `"set"` or `"cleared"`, never exposing plaintext or hashes.
- Updated `apps/admin/src/routes/_store/settings/storefront.tsx`:
  - Toast copy: `"Saved. Live to shoppers within a minute"`.
  - Mode descriptions:
    - live: *"Anyone can browse, add to cart, and checkout."*
    - coming_soon: *"Visitors see your holding page. They cannot browse products or checkout."*
    - password: *"Only visitors with the password can enter. Staff with admin sessions always have access."*
    - maintenance: *"Returns a 503 Service Unavailable with Retry-After header. Use during planned maintenance."*
  - Added `ConfirmDialog` warning when switching away from a live store: *"Taking your store offline will prevent customers from browsing and purchasing."*
  - Added maintenance explanation callout explaining HTTP 503 status code and `Retry-After` header to avoid search engine de-indexing.
  - Added unit test suite in `apps/admin/test/storefront-settings.test.tsx` (3/3 tests passed).

### 3. Custom Domains Page & Shell (§3.3)
- Created `apps/admin/src/routes/_store/settings/domains.tsx` declaring `pendingComponent` per `AGENTS.md` rule 11.
- Implemented states:
  - Empty state with educational card and "Add domain" action.
  - Pending verification state displaying CNAME and TXT DNS records with single-click copy buttons and propagation advice.
  - Active state displaying "Active", "SSL active", and "Primary" badges.
  - Provider disabled state displaying honest notice when `CF_API_TOKEN` is unconfigured (`ADR-020` honesty rule).
  - Failed verification state with clear diagnostics and re-verify action.
  - "Make primary" action (disabled until domain is verified and active).
  - "Remove domain" action with `ConfirmDialog` naming the exact hostname.
- Updated navigation in `apps/admin/src/components/settings/settings-nav.ts`:
  - Added Domains item under Store group with `domains.manage` and `Globe` icon.
  - Updated `branding` item to `branding.manage`.
  - Updated `storefront` item to `storefront.manage`.
  - Updated `visibleSettingsGroups` to evaluate `hasPermission` from `@bs/auth`.
- Added unit test suite in `apps/admin/test/domains-settings.test.tsx` (6/6 tests passed).
- Updated navigation tests in `apps/admin/test/settings-shell.test.tsx` (10/10 tests passed).

## Decisions and trade-offs

1. **No `app_icon_media_id` added**: `docs/SETTINGS-SCHEMA.md` §1 Rule 5 forbids settings without enforced behavior. The storefront layout currently renders favicon and logos but does not consume an app icon; hence adding `app_icon_media_id` was skipped to avoid dead schema.
2. **Internal getters for update procedures**: `updateBrandSettings` and `updateStoreStatus` call internal getters after transaction commit rather than requiring secondary permission re-evaluation, allowing users with specific write capabilities (`branding.manage`, `storefront.manage`) to complete mutations cleanly without triggering unexpected 403s on read.
3. **Double sanitization on password audit logs**: Audit logs store password and bypass tokens strictly as `"set"` / `"cleared"` in `schema.auditLogs.diff`. Furthermore, `listSettingsActivity` defensively sanitizes any secret-like key to `"[REDACTED]"`, guaranteeing complete compliance with `AGENTS.md` rule 7.

## Verification

- `pnpm typecheck` -> passed across all packages.
- `pnpm lint` -> passed across all 15 packages.
- `pnpm docs:check` -> `docs:check ok`.
- `pnpm build` -> all 6 build targets passed (`@bs/admin`, `@bs/platform`, `@bs/superadmin`, `@bs/web`, `@bs/worker`, `@bs/docs`).
- `pnpm --filter @bs/admin test` -> 8 test files passed, 62/62 tests passed.
  - `domains-settings.test.tsx`: 6/6 passed (pending component, empty, pending verification, active, error, provider notice).
  - `storefront-settings.test.tsx`: 3/3 passed (pending component, status copy, confirm dialog).
  - `settings-shell.test.tsx`: 10/10 passed (grouped navigation, least privilege visibility).
- `pnpm --filter @bs/domain test:fast` -> 33 test files passed, 273/273 tests passed.
  - `storefront-lifecycle.test.ts`: 25/25 passed (Defect 1 cache invalidation & Defect 2 constant-time crypto verified).
- `pnpm --filter @bs/domain test:heavy` -> 68 test files passed, 1,435/1,435 real Postgres tests passed.
  - `custom-domains.int.test.ts`: 11/11 passed (Defect 3 permissions, audit logs, tenant context verified).
  - `branding.int.test.ts`: 8/8 passed (Defect 4 media slot MIME/size/SVG validation, audit diffs, `branding.manage` verified).
  - `storefront-status.int.test.ts`: 7/7 passed (`settings.read`, `storefront.manage`, audit diffs verified).

## Docs updated

- [x] `docs/ARCHITECTURE.md` (Registered `/settings/domains`, added Branding vs Theme Settings Boundary table in §10, bumped Last verified against commit).
- [x] `docs/adr/020-settings-capability-families.md` (Updated enforcement status for `branding.manage`, `storefront.manage`, `domains.manage`, and `settings.read`).
- [x] `progress.md` (Updated Settings Phase 3 status and in-flight record).

## Definition of done

- [x] Code follows section 2 and 3 of `AGENTS.md`; the gate passes.
- [x] Tests added or updated (real-DB test for anything touching tenancy, money, auth or permissions: `custom-domains.int.test.ts`, `branding.int.test.ts`, `storefront-status.int.test.ts`).
- [x] `docs/ARCHITECTURE.md` updated with routes, boundary table, and "Last verified" commit bumped.
- [x] ADR-020 updated with capability enforcement status.
- [x] `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` checked (no port or infrastructure pipeline changes).
- [x] A change record in `docs/changes/2026-10-04-antigravity-settings-rebuild-phase-3.md` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: all stated tests executed and passed locally against PostgreSQL.
