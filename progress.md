# Progress

Source of truth: `docs/PLAN.html` v2.0 (build order in `docs/BUILD-PLAN-M2-M9.md`). Items are ticked only after verification; the evidence is noted next to each. "From code" means it was read in the repo but not exercised live.

## M11 · Auth & Transactional Email Overhaul (docs/AUTH-OVERHAUL-PLAN.md)

### Phase A: Platform-wide Transactional Email Service (Zoho ZeptoMail) — Complete (Awaiting Credentials Verification)
- [x] **Database Schema & Migrations**: Created `packages/db/src/schema/platform-email.ts` with `platform_email_settings` and `platform_email_log`. Generated migration `0017_platform_email.sql` granting `app_rw` SELECT on settings & INSERT on logs, and `app_platform` ALL. Verified with real Postgres grant suite (`b2-grants.int.test.ts`).
- [x] **Contracts & API**: Implemented `platformEmailContract` (`get`, `update`, `sendTest`, `recentDeliveries`) in `@bs/contracts/src/platform.ts`. Implemented and mounted procedures in `apps/platform/src/app.ts`. Updated RBAC and audit-coverage suites.
- [x] **Superadmin UI**: Implemented `apps/superadmin/src/pages/EmailSettings.tsx` at `/email` with India Zoho ZeptoMail presets, password encryption (never leaking secrets or displaying password in plain text), test email sender, and recent delivery log table.
- [x] **Domain Mailer & Templates**: Implemented `packages/domain/src/system/platform-mailer.ts` using `nodemailer`, AES-256-GCM encryption/decryption, rate-limiting, error sanitization, and transport injection. Added transactional and auth templates in `packages/domain/src/system/email-templates.ts`. Updated store order emails in `packages/domain/src/system/email.ts` to route through platform mailer with store name as display name, store support email as reply-to, and `no-reply@bcom.si` as sender.
- [x] **Verification**: All unit, integration, and pre-push checks passing (`pnpm lint`, `pnpm typecheck`, `pnpm build`, `@bs/domain` vitest 78/78 files 1070/1070 tests, `@bs/contracts` 15/15 tests, `@bs/db` 27/27 fast tests, `@bs/admin` 25/25 tests, `@bs/web` 158/158 tests).

### Phase B: Store Admin & Super Admin Password Flows — Complete
- [x] **Anti-Enumeration & Rate Limiting**: Implemented constant-time responses for unknown emails in forgot-password. Rate limited `/request-password-reset` (3 per 15 min per IP), `/reset-password` (5 per 15 min per IP), and password guessing.
- [x] **Better Auth Password Reset Engine**:
  - Store Admin (`packages/auth/src/staff.ts`): Configured `resetPasswordTokenExpiresIn: 3600`, `revokeSessionsOnPasswordReset: true`, callbacks sending transactional emails via platform mailer.
  - Platform / Super Admin (`packages/auth/src/platform.ts`): Configured reset tokens, email dispatch, session revocation, preserving active MFA on password reset.
- [x] **Store Admin UI (`apps/admin`)**:
  - Forgot password page (`/forgot-password`) with generic confirmation message preventing enumeration.
  - Reset password page (`/reset-password?token=...`) with strength validation and single-use token consumption.
  - Change password dialog accessible from store admin navigation/settings with current password verification and confirmation email.
- [x] **Super Admin UI (`apps/superadmin`)**:
  - Forgot password page (`/forgot-password`) and reset password page (`/reset-password`).
  - Change password dialog in layout/settings with current password check and notification.
- [x] **Security Invariants & Testing**:
  - Real database integration tests in `apps/platform/test/password-reset.int.test.ts` (4/4 passed).
  - Domain integration tests in `packages/domain/test/admin-auth.int.test.ts` (14/14 passed) verifying token expiry, session revocation on reset/change, anti-enumeration, and preserved MFA.
  - Typecheck (15/15 packages clean), lint clean, all touched package tests verified sequentially.

### Phase C: Customer Authentication (Storefront) — Complete
- [x] **Database Schema & Migrations**:
  - Altered `customers` table to make `phone` nullable (`text("phone")`) while preserving argon2id `passwordHash`, `emailVerified`, `phoneVerified`.
  - Created migration `0018_customer_auth.sql` and updated `_journal.json`.
- [x] **Domain Engine (`packages/domain/src/customers/auth.ts`)**:
  - Customer registration (`registerCustomer`) with email + password, optional phone, anti-enumeration check (already registered returns success without leaking or issuing session).
  - Email verification (`verifyCustomerEmail`) via single-use 24-hour `action_tokens` (`email_verification`), which activates past guest order adoption.
  - Email + password login (`loginCustomer`) with rate limiting per (tenant, IP) and per (tenant, email) via `checkCustomerLoginRateLimit`.
  - Password reset request (`requestCustomerPasswordReset`) minting 1-hour `action_tokens` (`password_reset`) and sending store-branded email.
  - Password reset confirmation (`resetCustomerPassword`) consuming token atomically and revoking all active sessions in `customer_sessions`.
  - Authenticated password change (`changeCustomerPassword`) verifying current password and revoking other sessions when requested.
- [x] **Storefront Routes & Screens (`apps/web`)**:
  - API routes under `/api/storefront/customer/`: `register`, `login`, `logout`, `forgot-password`, `reset-password`, `change-password`, `verify-email`. All enforce `sameOrigin`, rate limiting, and no tokens in responses.
  - UI pages: `/account/login` (with tabs for Email & Password vs Phone Code), `/account/register`, `/account/forgot-password`, `/account/reset-password/[token]`, `/account/verify-email/[token]`. Each page has a matching skeleton in `loading.tsx`.
  - Profile page with "Change password" form.
  - Thank-you order page with optional "Create account" card for guest checkouts.
- [x] **Security Invariants & Verification**:
  - Host-only, httpOnly, SameSite=Lax customer session cookies.
  - Cross-tenant rejection: sessions and tokens from Store A are strictly rejected on Store B.
  - Real database integration tests in `customer-accounts.int.test.ts` (12/12 passed).
  - Storefront web suite (`test/customer-pages.test.ts` and full `apps/web` suite 16/16 files, 158/158 tests passed).
  - Turbo typecheck (15/15 packages passed) and Turbo lint (15/15 packages passed).
- [x] **Review Security Hardening & Concurrency Fixes**:
  - **Pre-registration Takeover Prevention**: `registerCustomer` collects name + email only, creates/keeps row without altering existing row's name, phone, passwordHash or addresses. Sends a setup link (`action_tokens` purpose `password_reset`) allowing customer to set a password and mark `emailVerified=true`.
  - **Login Timing Oracle Defense**: Non-existent emails and passwordless accounts always verify against a constant dummy Argon2 hash (`DUMMY_PASSWORD_HASH`) to ensure indistinguishable execution time.
  - **Guarded Atomic Token Consumption**: `verifyCustomerEmail` and `resetCustomerPassword` now execute single guarded `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING` to guarantee atomicity and concurrency safety under simultaneous redemption.
  - **Email Verified on Reset**: Successful password reset / setup link consumption sets `emailVerified = true`.
  - **90-Day Retention Prune Job**: Implemented `prunePlatformEmailLogs(db, 90)` in `platform-mailer.ts` and integrated into the 15-minute maintenance pass in `jobs.ts`. Tested in `platform-mailer.int.test.ts`.

### Phase D: Cleanup, Invites, Documentation & Deployment Runbook — Complete
- [x] **Cleanup & Dead Code Removal**:
  - Removed deprecated Resend error checks and references from domain background jobs (`packages/domain/src/jobs.ts`).
  - Confirmed staff invitations in `packages/domain/src/system/staff-invites.ts` cleanly route through the platform mailer.
- [x] **Documentation & Runbooks**:
  - Updated `DEPLOYMENT.md` with complete Zoho ZeptoMail SMTP instructions (CNAME / SPF / DKIM verification, Mail Agent setup, Super Admin `/email` configuration, test email verification, environment secrets `SMTP_DEFAULT_FROM` and `TENANT_SECRETS_KEY`).
  - Authored `docs/adr/019-customer-auth-and-platform-mailer.md` documenting single identity on `customers`, opaque `customer_sessions`, rate-limiting tiers, and platform-wide transactional mailer.
- [x] **Verification**:
  - Full workspace typecheck: 15/15 packages passed.
  - Full workspace lint: 15/15 packages passed.
  - Sequentially executed test suites:
    - `@bs/domain` customer accounts suite (10/10 passed).
    - `@bs/platform` test suite (7/7 files, 76/76 passed).
    - `@bs/admin` test suite (3/3 files, 25/25 passed).
    - `@bs/web` storefront suite (16/16 files, 158/158 passed).
  - Full production build: `pnpm build` across all workspace apps/packages completed cleanly.

**How the tracking docs split (2026-10-01):** this file is the **status board** (milestones, known gaps, what is in flight). The detailed "who changed what, why, how verified" log is one file per change set in [`docs/changes/`](docs/changes/README.md), written by every agent. How the system is built is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Rules for all agents: [`AGENTS.md`](AGENTS.md).

## Catalog Phases A to F (Indexing, Categories, Collections, Brands, Locations, Reviews, Products) — Complete (2026-10-03)

Spec: `docs/PRODUCTS-CATALOG-PLAN.md` & `docs/PRODUCTS-SECTION-FINDINGS.md`. Built on `feat/catalog-a-f`.
- [x] **Database & Migrations**: Migrations `0024_catalog_indexing.sql` (`collections.indexable`), `0025_categories_active_featured.sql` (`categories.is_active`, `is_featured`), `0026_reviews.sql` (`reviews` tenant table with RLS, check constraint, `store_settings.auto_publish_reviews`), `0027_product_categories_primary.sql` (`is_primary` with partial unique index).
- [x] **Storefront & SEO Foundations**: `DIRECT_PRODUCT_STATUSES` vs `LISTED_PRODUCT_STATUSES`; robots meta (categories indexable, collections configurable, soft-404 on empty); canonical URLs; sitemap excludes unlisted and empty collections; reviews section with AggregateRating and verified buyer labels.
- [x] **Admin Workbenches**:
  - Categories (`/categories`, `/categories/new`, `/categories/$id`): 3-level tree, drag/reorder, delete guards.
  - Collections (`/collections`, `/collections/new`, `/collections/$id`): Manual vs Automated condition builder, indexable switch, sorting.
  - Brands (`/brands`): Logo upload, product count, delete guard.
  - Locations (`/locations`, `/locations/new`, `/locations/$id`): Default location constraint, stock delete protection.
  - Reviews (`/reviews`): 4 KPI cards, moderation tabs, approve, hold, reply dialog, delete.
  - Products (`/products/new`, `/products/$id`): 2-column layout, primary & extra categories, SEO card, returns policy toggle.
  - Inventory (`/inventory`): Multi-location selector filter.
- [x] **Verification**: `pnpm typecheck` (15/15 passed), `pnpm lint` (15/15 passed), `pnpm --filter @bs/domain test:fast` (238/238 passed), `pnpm docs:check` (ok), `pnpm build` (6/6 passed).

## Customers Phase 0 · Foundations (2026-10-03)

Spec: `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md` & `docs/CUSTOMERS-SECTION-FINDINGS.md`. Built on `feat/customers-phase-0`.
- [x] **Phase 0a (Truthful Metrics & Sorting Cache)**:
  - Computed real-time metrics (`orders_count`, `total_spend`, `last_order_at`) via lateral SQL fragment `customerMetricsSql(tenantId)`.
  - Asynchronous sorting copy on `customers` table kept up-to-date with `customers.refresh_metrics` pg-boss queue and `runCustomerMetricsSweep` drift repairs.
- [x] **Phase 0b (Guest Customers & Account Claim)**:
  - Added `is_guest` column to `customers` table with partial index.
  - Guest checkout creates/updates guest customer record without overwriting name or phone of existing registered accounts.
  - Customer email verification (`verifyCustomerEmail`) securely claims guest record and attaches past orders without account takeover.
- [x] **Phase 0c (Single Marketing Consent Record with History)**:
  - Tenant table `customer_consent_events` recording state transitions, sources, timestamps, and staff actor IDs.
  - Single writer `setMarketingConsent` keeps `marketing_state` and `accepts_marketing` synchronized across all consent touchpoints.
- [x] **Verification**: `pnpm typecheck` (15/15 passed), `pnpm lint` (15/15 passed), `pnpm build` (6/6 passed), `pnpm docs:check` (ok), `@bs/domain` test:fast (28/28 files, 238 passed), `@bs/admin` test:fast (3/3 files, 25 passed), `@bs/web` test:fast (17/17 files, 163 passed), `@bs/domain` test:heavy (63/63 files, 1190 passed), `@bs/domain` isolation suite (755/755 passed).

## Customers Phase 1 · List, Detail, Import, Delete (2026-10-03)

Spec: `docs/CUSTOMERS-IMPLEMENTATION-PLAN.md` Phase 1 (1A, 1B, 1C) with the ZCode prompt (`docs/prompts/customers-phase1-zcode.md`). Built on `feat/customers-phase-1`; change record `docs/changes/2026-10-03-zcode-customers-phase-1.md`.
- [x] **Phase 1A (Customers list)**: tabs All/Customers/Guests/Blocked; stats strip from the metrics fragment; marketing-state, store-wide tag and location filters; guest/blocked badges; bulk tag/status with skipped-row reporting; filtered CSV export (subscribers-only default). New procedures `customers.stats/tags/setStatus/setTags`.
- [x] **Blocked enforcement**: phone-OTP login and storefront checkout now refuse blocked customers (password login and sessions already did); per-store isolation tested end to end.
- [x] **Metrics fragment rewrite**: per-customer lateral replaced with grouped aggregates after measuring 13.1M buffer hits per list page at 6k customers × 24k orders; identical semantics, 2,448 buffer hits measured.
- [x] **Phase 1B (Detail and edit)**: editable profile (verification-aware email), staff address CRUD, order history, activity timeline, status with blocked behaviour, marketing card with consent history, tags editor, notes timeline in new `customer_notes` table (migration `0029_customers_phase1`, legacy note migrated idempotently); `setMarketingConsent` refuses non-email channels (Phase 0 follow-up).
- [x] **Phase 1C (Import and delete)**: CSV import with dry run, error file, >500-row queue (`customers.import`), consent only when the file says so, existing customers updated on name/tags only; delete hard-deletes without orders and anonymises with orders (sessions destroyed, orders kept).
- [x] **Verification**: typecheck 15/15, lint, build, docs:check, domain fast 238, domain heavy 1,303 (64 files; three documented Windows worker-crash flakes pass alone), web 164, admin 32, isolation 840 (85 new cases). Browser-checked at 1280px and 375px on the local demo store; CSV file upload itself not drivable in the test browser (covered by real-DB tests). Ready for Claude's verification before Phase 2.

## Customers Segments (Stages A and B) — Complete (2026-10-04)

Records: `docs/changes/2026-10-03-zcode-customers-segments-stage-a.md`, `2026-10-04-zcode-customers-segments-stage-b.md`. Migration `0030_customers_segments.sql`. Manual and automatic segments (rule whitelist compiled to SQL), segment list/detail with rich tables, count-refresh job, segment filter and "Add to segment" on Customers, Segments card on customer detail. CI green, merged as PR #23; heavy 1,397 tests at hand-off.

## Settings rebuild Phases 0-2 — merged (2026-10-04)

Plan: `docs/SETTINGS-REBUILD-PLAN.md`, `SETTINGS-REMAINING-PHASES`; records `2026-10-04-zcode-settings-rebuild-phase-0-1.md`, `2026-10-04-antigravity-settings-rebuild-phase-2.md`, `2026-10-04-claude-settings-phase-2-verification.md`.
- [x] Phases 0-1 (PR #25): grouped shell, `/settings` Overview (`settingsOverview.get`), `/settings/store-details`, audit on store settings.
- [x] Phase 2 (PR #29): ADR-020 capability families, `/settings/users`, `/settings/activity`. Verification found and fixed: red typecheck, and `payments.manage` enforced nowhere (now enforced on Razorpay save/clear in route and service; the ADR lists exactly which families are enforced today).
- [ ] Phases 3-8 not started. Owner decisions recorded 2026-10-04 (accepted recommended defaults). Hand-off for Antigravity: `docs/SETTINGS-PHASES-3-8-HANDOFF.md` with builder prompts `docs/prompts/settings-rebuild-phase-3.md` to `-8.md` (schema per phase, audited defects, tests, acceptance). Phase 5B (Razorpay) and Phase 6E/6F (shipping profiles, packages) are gated on explicit owner go. Claude verifies each phase before the next starts.
- Browser walkthrough of Phase 2 roles still pending (owner is testing manually).

## Dev speed (PR #22) — merged (2026-10-04)

`pnpm test:heavy:local`, `test:affected`, `gate:quick`, CI docs-only path, lint rule `bs/no-service-call-in-tx` (allows services handed `tx`), db pool idle-error logging, deletion-sweep advisory lock on one connection. Integration found three defects fixed before merge: invalid `ci.yml` (unquoted colons), tooling that reported success when tests never ran on Windows, and one false positive of the new lint rule. Record: `2026-10-04-claude-dev-speed-integration.md`.

## Known open items after this pass (2026-10-04)
- Theme builder merged (PR #30, migrations 0031/0032) on the owner's instruction to release. Verified by typecheck, lint, build and fast and real-database suites; the browser walkthrough was done (or not) by the owner, not by an agent.
- CI e2e only runs on `main`: a PR that renames admin UI labels must grep `e2e/` first (two follow-up fixes were needed after Settings 0-1).
- Windows heavy-suite worker crash `3221226505` remains a local flake (rerun the file alone); CI on Linux is unaffected.
- Finance (merged 2026-10-05, PR #39, ADR-022): cancelling a paid order records a refund but does not restore stock (`releaseReservation` only releases active reservations), so cancel-time COGS is not posted back; receipt upload was tested against a local S3 stand-in, not real R2; the `store_finance` role was tested through the API and tests, not in a browser; Finance pages overflow horizontally at 375 px (as the Returns page does). Details in `docs/changes/2026-10-05-claude-finance-verification.md` and ADR-022 "Known gaps".
- COD fee/enable is still saved through the generic `settings.update` (`settings.write`); owner-only treatment is part of Settings Phase 5.

## In flight

One line per piece of work that is started and not merged. Add yours before you start, remove it when merged or abandoned (`AGENTS.md` section 6). Format: `agent · branch · area · since · one-line goal`.



## Returns & Exchanges (Manual Review & Portal) — Complete (2026-10-02)

Spec: `docs/ORDERS-RETURNS-PLAN.md`. Built on `feat/orders-returns`.
- [x] **Database & Migrations**: Expand migration `0023_returns.sql` adding resolution columns (`requestedResolution`, `customerComment`, `exchangeRequest`, `decisionMessage`, `instructionsSentAt`, `refundMethod`, `refundReference`, `refundAmount`, `refundedAt`, `exchangeNote`, `exchangeOrderId`) to `returns`, `returnable` boolean to `products`, nullable `intentId` + `method` + `reference` to `refunds`, and `returnSettings` JSONB to `storeSettings`.
- [x] **Domain Services**: State machine updated with `cancelled`, `pick_up`, `replace` transitions; manual lifecycle enhanced with return window validation, non-returnable product checks, restock inventory updates, manual refund recording for COD/offline orders, and audit logs; S3 presigned photo upload service; admin returns stats, list, and detail queries.
- [x] **Contracts & API Endpoints**: Admin contracts for `returns.stats`, `returns.list`, `returns.get`, `returns.act`, `returnSettings.get`, `returnSettings.update`; Storefront API endpoints for return request, photo upload, finalize, and customer cancellation.
- [x] **Store Admin Workbench & Settings**: Rebuilt `/returns` workbench with 4 KPI cards, status tabs, search & filters, CSV export, slide-out detail sheet with photo proof gallery and item breakdown, and action dialogs (approve, reject, mark picked up, receive with restock, refund, replace, close case); New `/settings/returns` page with unsaved guard, policy controls, customizable return reasons with photo requirements, and policy copy editors.
- [x] **Storefront Portal**: Enriched guest return portal on `/o/[token]` with reason selection, exchange preferences, customer comments, photo uploads, store instructions for approved returns, and self-service cancellation.
- [x] **Verification**: `pnpm typecheck` (15/15 passed), `pnpm lint` (15/15 passed), `pnpm --filter @bs/domain test:fast` (205 passed), `pnpm docs:check` (ok), `pnpm build` (6/6 passed).

## Quotes (Lean, industry-standard model) — Complete (2026-10-02)

Spec: `docs/ORDERS-QUOTES-PLAN.md`. Built on `feat/orders-quotes`.
- [x] **Database & Migrations**: Expand-only migration `0022_quotes.sql` adding `price_on_request boolean not null default false` to `products`; new tenant table `quote_requests` with sequential gapless numbering `QT-00001` via `number_sequences`, product/variant snapshots, status machine (`new`, `quoted`, `accepted`, `lost`, `expired`), composite FKs, and RLS (`forceRlsSql`).
- [x] **Storefront & Protection**: `addToCart` and `placeOrder` reject `price_on_request` variants; product cards and details show "Price on request" badge and accessible "Request a quote" modal dialog; public submission rate-limited by IP and email with client price override prevention.
- [x] **Admin Workbench & Management**: Dedicated Quotes workbench at `/quotes` with 5 KPI cards (Needs reply, Quote sent, Expired, Accepted, Total quotes value), tabs, search, filter chips, DataTable, CSV export, and detail `Sheet` with notes, status transition controls (Mark lost, Reopen, Delete), and "Create quote order" button.
- [x] **Order Conversion & Sweep**: Admin `/orders/new` prefilling customer, variant, price override from `quoteId`; linking quote creates pending order, sets `valid_until` (default 7 days); daily sweep / `runQuoteExpirySweep` cancels unconfirmed pending orders on expiry and releases reserved stock.
- [x] **Verification**: Real Postgres integration suite (`packages/domain/test/quotes.int.test.ts`, 8/8 passed), `pnpm typecheck` (15/15 passed), `pnpm lint` (15/15 passed), `pnpm build` (all passed), `pnpm docs:check` (ok).

## All Orders Phase 2 (Create Order Parity D1-D7) — Complete (2026-10-02)

Spec: `docs/ORDERS-ALL-ORDERS-PLAN.md` §4.2. Built on `feat/orders-phase2`.
- [x] **Database & Migrations**: Migration `0021_order_tags.sql` adding `tags text[]` with GIN index on `orders`.
- [x] **Contracts & API**: Added `admin.customers.create`, `admin.orders.estimateDraft`, updated `admin.orders.createDraft` with D1-D7 fields (discounts, overrides, shipping methods, payment outcome, tags), tag filtering in `admin.orders.list`.
- [x] **Domain Services**: Handled D1 GST Tax calculation (CGST+SGST or IGST based on store and shipping state), D2 Shipping override (capped at ₹10,000 with mandatory reason), D3 Manual discounts & line price overrides with mandatory audit reasons, D4 Payment choice ("Payment received", "Payment pending", "Cash on delivery") with customer spend updates and inventory commitment, D5 Order tags, D6 Customer picker & inline customer creation with default address, D7 Inventory reservations with shortage rejection.
- [x] **Admin UI**: Overhauled `/orders/new` (`apps/admin/src/routes/_store/orders_.new.tsx`) with customer selector/create dialog, item search/stock check, inline price override, order discount, shipping rate calculator/override, payment terms radio group, internal notes, tags, and sticky live summary.
- [x] **Verification**: Real Postgres integration suite (`packages/domain/test/order-phase2.int.test.ts`, 9/9 passed), full fast suite (26 files, 205 passed), `pnpm typecheck` (15/15 passed), `pnpm lint` (15/15 passed), `pnpm build` (all passed), `pnpm docs:check` (ok).

## Pre-orders (Simple "ships on" model) — Complete (2026-10-02)

Spec: `docs/ORDERS-PREORDERS-PLAN.md`. Built on `feat/preorders-simple`.
- [x] **Database & Migrations**: Expand-only migration `0020_preorders.sql` adding `preorder_enabled`, `preorder_ships_on`, `preorder_message` to `variants`; `ships_on` (with partial index) and `preorder_released_at` to `orders`; `ships_on` to `order_items`.
- [x] **Checkout & Pricing**: Pre-orders sellable at 0 stock at regular price; no inventory reservation before goods received; snapshot `ships_on` on items and order (latest date); mixed-cart notice.
- [x] **Order Lifecycle & Hold**: Pre-order hold prevents advancing fulfillment to `shipped` before promised dispatch date unless released early via `releasePreorderNow`. Audited and recorded on order timeline.
- [x] **Admin Workbench & Management**: Dedicated Pre-orders route `/preorders` with 5 views (All, Waiting, Ready to ship, Shipped, Cancelled), 4 KPI cards, batch ship-date rescheduling (`changePreorderShipDate`), and early release. Products cell displays pre-order pill tags.
- [x] **Background Jobs & Sweeps**: Daily sweep (`runPreorderReminderSweep`) at 06:00 sending idempotent 2-day reminder emails; ship-date change notifications via `order.preorder_date_changed`.
- [x] **Verification**: Real Postgres integration suite (`packages/domain/test/preorders.int.test.ts`, 7/7 passed), `pnpm typecheck` (15/15 passed), `pnpm lint` (15/15 passed), `pnpm build` (all passed), `pnpm docs:check` (ok).

## M10 · Visual theme system (Puck) — shipped to production 2026-10-01

Design and rationale: [`docs/adr/018-visual-theme-editor.md`](docs/adr/018-visual-theme-editor.md) (extends ADR-009 and ADR-010). Shipped in `5644b6c` (feature commit `f469208` + merge of main). CI green end to end; production health checked (web, platform, admin on `5644b6c`).

### Done and verified
- [x] **Platform themes**: `theme_templates` now has a draft and a published snapshot (+ description, features). Staff create, edit in Puck, publish and hide themes in the super admin (Themes). Audited (`theme_template.*`), role `platform_admin` or higher.
- [x] **Launch theme** "Essential Commerce" seeded by migration `0015` (a test keeps the JSON in sync with `launch-template.ts`).
- [x] **Store library and activation**: store admin Themes (preview with the store's own products, activate, "newer version available" notice). Activation copies tokens and pages into the store's own rows; templates are never edited by stores; re-activating adds a page version, so the previous design can be rolled back.
- [x] **Visual editor** (`/online-store/editor/$pageId`, "Design visually" on Pages): drag and drop, nested layout blocks, live store data in the canvas, mobile/tablet/desktop viewports, save draft, publish. Lazy-loaded chunk (about 126 KB gzip); the storefront never ships Puck.
- [x] **Blocks** (`@bs/blocks`): Section, Container, Grid, FlexRow/Column, Spacer, Divider, Heading, Text, Image, Video, Button, Icon, Link, CallToAction, plus upgraded ProductCarousel/ProductGrid/Testimonials and the 12 existing blocks. Recursive validation (depth 6, 300 blocks), enumerated props only, safe links and video hosts, own stylesheet driven by `--bs-*` brand tokens.
- [x] **Storefront**: `renderBlockTree` with server-resolved products/collections/media in the same `"use cache"` scope as the page; non-home pages now invalidate `page:<slug>` on publish and rollback.
- [x] **Tests**: blocks (78), editor config (7), domain integration (themes, isolation incl. the new procedures), platform audit/RBAC/read guards extended for the new procedures.
- [x] **End-to-end run** on a real stack (Postgres, web, admin, platform, super admin). Bugs found and fixed: tsx JSX runtime, primary-foreground contrast, RichText `content` colliding with the layout slot (silent data loss), placeholder ids failing branding/theme output validation, legacy hero button props, editor reset after save.
- [x] Production verified by the owner after deploy ("working well").

### Theme builder follow-up (2026-10-01)
- Super admin: **Themes -> New theme** (name, industry, description, optional copy of another theme) opens a builder with tabs: Theme settings (colours, fonts, corners, buttons, live preview), Home page, Collection page, Product page, Header, Footer. Save draft / Publish theme in the top bar; theme details editable from the list.
- Store admin: Themes screen has a Customise panel (Theme settings + one editor per page); library preview shows each theme with its own settings across home/collection/product.
- Storefront renders the theme's header, footer, product and collection layouts and applies its tokens; stores without them keep the built-in layouts and Branding look. See ADR-018 update.
- Verified in the browser: create -> style -> edit header -> publish -> store sees it -> activate -> storefront (home, product, collection) -> store edits settings (platform copy and other stores untouched) -> platform republish shows "Newer version available".
- Errors found while testing, and fixed:
  - Storefront ignored theme tokens entirely (layout passed `null`) and the launch theme used a different token shape (`typography`/`shape`) than the reader (`fonts`/`radius`): one canonical shape now, legacy shape still read; theme tokens apply once a store opts in (`source: "theme"`).
  - Pill corners turned product images and cards into circles: pill now applies to buttons only; cards cap at 1.25rem.
  - `--font-heading`/`--font-body` briefly gained fallbacks and broke two web tests that rely on the bare-name contract: bare names restored, blocks use the new `--bs-font-*` variables.
  - Super admin editor lint (refs read during render) and a status label stuck on "hidden from stores" after publishing: pages moved to state, status updates on publish.
  - Preview and editor canvases showed "Your store" instead of the real name: store name passed through.
  - Store library said customisations are "never overwritten" although re-applying replaces settings and layouts: copy corrected.
  - Header/footer/product/collection layouts would have been reachable at `/pages/template-*`: excluded from public page lookup and from the Pages list.
- Deploy bug found in production: the Super Admin still showed the old Themes page after the theme-builder deploy because CI's `APP_UUIDS` list (apps Coolify redeploys) did not include `bsec-superadmin`: its image was built every push but never pulled. Added `mvpbrx2k9jp3q1invu8ayk48` to the list, the RUNBOOK table and DEPLOYMENT.md.
- CI e2e fixes after the admin redesign: product/order lookups matched twice (table + card) and the order filters became tabs; also raised flaky 15s/20s unit-test timeouts (cold route imports on busy runners).
- Test-run notes: running all platform/domain integration suites in parallel against one reused Postgres container fails with "already exists" (schema/table collisions); run them with `--no-file-parallelism` (platform: 68 pass). One admin routes test times out only when the machine is busy; it passes alone.
- Not done: merging a platform update into a store's customisations (re-applying replaces), other page types (cart, blog, search), theme preview thumbnails.

### Known gaps / next
- [ ] Storefront-hosted draft preview (only the in-editor preview exists; the "Preview on store" button is not wired).
- [ ] Merge a newer platform theme into stores that already customised it (version is tracked; today they only see the notice).
- [ ] Page types beyond home and custom pages (collection / product templates); the super admin editor edits only a theme's `home` page; no multi-page switcher in the store editor.
- [ ] Theme tokens vs brand settings: a store's brand colours win over the theme's tokens.
- [ ] Newsletter block form is not wired to the subscribe endpoint.
- [ ] Media: needs `R2_PUBLIC_URL` (or `CF_IMAGES_DELIVERY_URL`) on the web service for block images.
- [ ] Cache: `revalidateTag(..., "max")` serves one stale load after publish; consider `{ expire: 0 }` for page and theme tags.
- [ ] Super admin in `vite dev` renders blank for signed-in users (React `removeChild` error); the production build works. Pre-existing, not investigated.
- [ ] Next dev warning: homepage `generateMetadata` reads uncached data (pre-existing).
- [ ] More themes and widgets (Phase 2): FAQ/brand-logo/social blocks, advanced styling, theme versioning and upgrade flow.

## Current milestone: M0 · Platform boots

## Status at 2026-10-01

Live at **bcom.si** (web), **admin.bcom.si**, **platform.bcom.si**, **superadmin.bcom.si**, **media.bcom.si** (R2 images). Production runs `main`; every push passes CI (typecheck, lint, build, unit, heavy integration on real Postgres 18, ephemeral staging smoke test incl. admin + Super Admin Playwright e2e) before the Coolify deploy. First real store: **Taste of Hills** (`tasteofhills.bcom.si`), created through Super Admin.

Test counts at this date: domain 930, db 41, platform 63, web 121, admin 23 (isolation suite 525 of the domain total).

| Milestone | State | Notes |
|---|---|---|
| M0 Platform boots | Done, with open infra items | see "Open infra items" |
| M1 Tenant isolation | Done | isolation suite green; customer sessions (ADR-012) not implemented |
| M2 Catalog | Done, gaps | CSV import/export UI disabled; no Cloudflare Images re-encode; no stock field on product create |
| M3 Storefront | Done, gaps | no SEO settings page, no CSP header, missing pages return 200 not 404 |
| M4 Payments | **COD done, online payment not built** | real Razorpay order creation missing (online option hidden); customer `/account` built (orders, addresses, profile) but sign-in codes cannot be delivered in production until an SMS/email provider is set up |
| M5 Fulfillment | Manual flow done, courier not | Orders can be confirmed, shipped, delivered (COD collected) by hand; returns work end to end (shopper request, admin Returns page, restock, refund record). Shiprocket never called; invoices have no PDF. Not yet verified live |
| M6 Store #1 live | Partly | a real store exists; no real order history or 2-week run; restore drill at real volume not done |
| M7 Hardening | Docs only | load / noisy-neighbour / capacity numbers deferred until after M9 (decision 2026-09-29) |
| M8 Self-service SaaS | Built, **signup unreachable until the marketing-page fix deploys** | custom domains and merchant billing coded but never run live |
| M9 SaaS launch | Done and verified live | ADR for M9 decisions still to write; GST doc pending chartered-accountant review |
| M10 Theme editor (Puck) | Merged by a separate session | see ADR-018 for its known gaps |

### Verified live, this week
- **Super Admin** (2026-09-30): sign-in with password + authenticator, store creation, support session start, suspend/restore, audit log; Playwright superadmin spec 5/5 in CI.
- **Store provisioning** through Super Admin: Taste of Hills created; owner invite link works.
- **Wildcard store routing** (`*.bcom.si` → bsec-web) via manual Traefik labels; see DEPLOYMENT.md "Wildcard store routing".
- **Storefront modes**: new stores start `coming_soon`; Settings → Storefront switches to live (tests + live).
- **Catalog to order, COD**: product page, add to cart, cart, checkout with the store's own shipping rates, COD order placed, thank-you page with the real order number, order visible in admin, stock reserved, cancel releases stock and voids the payment. Placed and cancelled two test orders (ORD-00001/2) on the live store.
- **Inventory**: variants that never had stock are listed so first stock can be added; product page shows stock.
- **Product images**: upload from the product page to R2 (`bsec-media`), served from `media.bcom.si`, shown in admin, home grid, product page, cart and checkout. Tested with a real upload.

### Bugs found by driving the app and fixed this week
Cached "not found" never cleared after a draft product was published; Add to Cart sent an invented cart token (every add failed); checkout showed hardcoded shipping so the page said ₹150 and the order was ₹199; a "free above ₹999" rate looked free for every cart and the flat rate always won; cancelling an order left stock reserved and COD payment "pending"; inventory page hid never-stocked variants; demo blog articles and keyboard-store copy shown on every store; online payment option created a fake Razorpay order.

### Known gaps, by area (nothing below is built unless stated)
- **Payments / shipping (deferred by decision, needs provider keys):** real Razorpay checkout and webhooks end to end; Shiprocket labels, AWB, tracking, RTO; merchant billing via Razorpay Subscriptions.
- **Customer side:** built 2026-10-01, not yet verified live: `/account` (orders, order detail, addresses, profile), `/address/{token}`, `/unsubscribe/{token}`. Still missing: `/pay/{token}` (needs Razorpay), account wishlist and data export, reviews. No email links to `/unsubscribe` or `/address` yet (token minting is ready: `mintUnsubscribeToken`, `mintAddressUpdateToken`).
- **Messaging:** transactional emails send only placeholder text (`Template: X. Subject: Y`); no HTML templates; Resend key not configured.
- **Returns and invoices:** returns built (7-day window after delivery; COD refunds are recorded, the merchant sends the money by hand; online refunds wait for Razorpay); the return emails are not sent yet; GST invoice has no PDF; GST scope awaits CA review.
- **Store admin screens missing:** Abandoned checkouts, Shipments, Reviews, Analytics, merchant Features, Domains, SEO, Checkout, Notifications, Policies, Plan and billing, Activity log, Data export, Danger zone, Blog, Announcement bar, Redirects, Files. Orders, Customers and Products now export real CSV files; Products Import is still disabled.
- **Custom domains:** backend and Cloudflare for SaaS provider coded (needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, the `stores.bcom.si` CNAME target); no admin Domains page; never run live.
- **Security checklist items not verified:** Content-Security-Policy on the storefront; CSRF on mutations; rate limiting at Cloudflare.
- **Platform:** invite links for owners/staff are shown once, not emailed; host-to-store cache means a suspend can take up to 60 s to reach the public storefront; media deletion from R2 on store deletion needs the `R2_*` keys on bsec-platform.

### Added 2026-10-01 (second pass), pushed to main, not yet verified live
- **Order lifecycle by hand:** admin can confirm, mark shipped, mark delivered (COD recorded as collected); stock moves from reserved to sold on confirm. Domain: `orders/manual-lifecycle.ts`.
- **Returns:** shopper request form on `/o/{token}` (7-day window, per-item quantity limits), admin Returns page (approve/reject, picked up, received with restock, refund record, close). COD refunds are recorded only; the merchant pays the shopper.
- **Customer pages** (subagent, reviewed and merged): `/unsubscribe`, `/address`, `/account`. The old customer login token was unsigned and forgeable; it is now a server-side session (`customer_sessions`, hashed token, httpOnly cookie). OTP codes are no longer returned in HTTP responses (logged server-side in development only). Guest orders appear in the account when the phone is OTP-verified.
- **Admin redesign and themes** (other session) merged; CSV export comes from that redesign.
- **Tests:** real-database tests for the lifecycle, returns and customer pages; the admin-procedure isolation suite covers the new procedures (535 cases). Under full parallel `pnpm test` the platform and admin suites can time out from database contention; they pass when run one package at a time.
- **Still open after this:** admin Domains page and custom domains, SEO settings, CSP header and CSRF review, 404 status for missing pages, return/refund emails, invoice PDF, product-create stock field, Products Import, ADR for M9. Razorpay, Shiprocket and Resend stay deferred.

### Open infra items
- Sentry projects and DSNs, uptime monitors (deferred to the end, with provider keys).
- Point-in-time recovery (pgBackRest/WAL): current RPO is 24 h (daily `pg_dump`), plan target is 15 min.
- GitHub `production` environment has no required-reviewer gate (needs a paid plan).
- Coolify's own healthcheck fails on this host; apps are verified through their `/health` endpoints instead.
- `bsec-superadmin` GHCR package is private (Coolify uses a server-side `docker login`); other packages are public.
- bsec-web uses manually managed Traefik labels for the wildcard route: editing its domains in Coolify does not regenerate them.
- Load, noisy-neighbour and capacity tests, second restore drill, security penetration test: deferred.

### Decisions on record
- Razorpay, Shiprocket and Resend keys, Sentry and uptime accounts: set up at the very end (2026-09-29).
- Hardening and load testing: after all phases are built (2026-09-29).
- Shipping rates are per store, never hardcoded.
- No legacy dataset to migrate: store #1 is the platform's own first tenant (PLAN §16 does not apply).

---

# History: M0 · Platform boots (detail)

## M0 · Platform boots

**Plan exit criterion:** push to main deploys web, platform, admin and worker to staging then production; a migration runs; a backup is restored into a scratch database.
**Status:** code-side scaffold done and verified locally (2026-09-28). **M0 is not done yet**: the infra items below need the VPSs, the GitHub repo push, and accounts.

### Repo and tooling
- [x] Turborepo + pnpm workspace, Node 24.15, TypeScript 6.0.3 strict, exact version pins. `pnpm install` is clean.
- [x] apps: `web`, `platform`, `admin`, `worker`. packages: `db`, `contracts`, `domain`, `auth`, `ui`, `config`.
- [x] `pnpm typecheck` passes for all 10 packages.
- [x] `pnpm lint` passes for all 10 packages.
- [x] `pnpm test` passes: 36 tests, including the PG 18 integration suite via Testcontainers.
- [x] `pnpm build` passes (web, admin, platform, worker, db bundles).
- [x] Lint rule: `@bs/db` and DB drivers banned outside db/domain. Probe file in apps/web fails with `no-restricted-imports`.
- [x] Lint rule: tenant-prefixed cache tags (`bs/tenant-cache-tag`). RuleTester suite passes, and the probe `cacheTag("products")` fails.
- [x] Lint rule: skeleton on every route (`bs/route-pending`: `pendingComponent` for admin, `loading.tsx` for web). RuleTester suite passes, and the current routes pass it.
- [x] ADR-001 … ADR-010 written (`docs/adr/`).

### Database
- [x] Roles `app_owner` / `app_rw` (NOBYPASSRLS) / `app_platform` (BYPASSRLS), idempotent bootstrap. Verified by roles.int.test and by the compose `migrate` log `roles ok`.
- [x] Drizzle migrations run only as `app_owner` (the script refuses other roles). Tables are owned by app_owner, and app_rw can do DML but no DDL. Verified by integration test.
- [x] Extensions `citext` and `pg_trgm` installed by migration as app_owner (no superuser needed).
- [x] pg-boss schema and queues created at migrate time. Worker runs `migrate:false` as app_rw. Compose log shows the `system.ping` round trip.
- [x] `tenantTable()` stub: `tenant_id`, ENABLE RLS, nullif policy on USING and WITH CHECK, plus `forceRlsSql()`. Unit-tested.
- [x] FORCE RLS + nullif proven on PG 18:
  - the owner sees 0 rows;
  - a pooled connection after SET LOCAL returns 0 rows, not an error;
  - a cross-tenant insert is rejected;
  - BYPASSRLS reads everything.

  Verified by roles.int.test.
- [x] Expand/contract rule documented (`docs/migrations.md`).

### Design system (packages/ui, M0 scope)
- [x] Tokens with Supabase-pattern names and our emerald hue; light default plus dark; Tailwind 4 `@theme` mapping. Apache-2.0 NOTICE included.
- [x] PageContainer, PageBreadcrumbs, PageHeader, PageSection (per-section Suspense), and the Sidebar/AppShell with a mobile drawer.
- [x] Button (loading state), Input, Select, Dialog, Sheet, Table, Form (RHF + FormItemLayout), EmptyState, Toast (Sonner).
- [x] Skeleton, TableSkeleton, FormSkeleton, MetricCardSkeleton, DetailSkeleton; reduced-motion safe; aria-hidden.
- [x] Route template: router defaults `pendingMs 150` / `pendingMinMs 300` and preload on intent, `pendingComponent` on every route, and a static skeleton in `index.html`.
  - Browser: the TableSkeleton rendered during navigation to /orders.
- [x] Mobile: 40 px touch targets, drawer nav, no horizontal overflow at 375 px. Checked in the browser.
- [ ] Storefront `loading.tsx` present on `/`; the per-store theme tokens come in M2/M3. Needs a Playwright throttled-network screenshot check (plan §12 enforcement), which isn't set up yet.

### Containers and local stack
- [x] Dockerfiles: web (Next standalone), platform + worker (single-file esbuild bundles), admin (nginx-unprivileged), migrate (one-shot). All non-root with HEALTHCHECK.
- [x] `docker compose up --build`: postgres 18 → migrate (exit 0) → web, platform, worker, admin all **healthy**.
  - Checked `/api/health`, `/api/system/health` (OpenAPI), `/api/rpc/system/health`, platform `/health` + `/system/health`, worker `/health`, admin `/health` + SPA deep link.
  - `pg_stat_activity` shows web/worker as `app_rw` and platform as `app_platform`.
- [x] `x-request-id` on every API response. pino JSON logs carry `request_id` (`tenant_id` field present, null until M1).
- [x] APP_VERSION build arg flows into `/health`.

### CI/CD and infra
- [x] GitHub Actions `ci.yml` runs green on `github.com/Brandsewa/bsec` (main).
- [x] Images pushed to GHCR: `ghcr.io/brandsewa/bsec-{web,platform,worker,admin,migrate}`, all set **public** (anonymous `docker pull` verified) so Coolify needs no registry credentials.
- [x] Coolify project **Bs Commerce Platform** created on the existing Brand Sewa VPS (shared with the other 4 projects for now), with a `production` environment.
- [x] `bsec-postgres` (Postgres 18) resource running, internal-only (no public port), database `bsec`.
- [x] Roles bootstrapped for real: `app_owner` / `app_rw` / `app_platform` created via the `bsec-migrate` Docker Image resource's one-shot `deploy.js` entrypoint (bootstrap + migrate in one image, driven entirely through Coolify's UI — no shell/terminal access used for secrets). Verified via container logs (`roles ok` / `migrations ok`) and confirmed live through every app's `/health`.
- [x] Four long-running resources created and deployed as Docker Image resources on `:main`: `bsec-web` (3000), `bsec-platform` (4000), `bsec-worker` (4100), `bsec-admin` (8080, nginx). Each has its own DB credentials only (`app_rw` for web/worker, `app_platform` for platform only).
- [x] **End-to-end verified live** (not just locally) via the auto-generated sslip.io URLs:
  - web `/api/health` → `db.ok:true`, role `app_rw`; storefront `/` → 200.
  - platform `/health` → `db.ok:true`, role `app_platform`.
  - worker logs show it connected, started, and processed the `system.ping` job.
  - admin `/health` → 200; SPA and a deep link (`/orders`) both → 200.
- [x] Domain: `bcom.si` + `www.bcom.si` → `bsec-web`, `admin.bcom.si` → `bsec-admin`, `platform.bcom.si` → `bsec-platform`. All three live behind Cloudflare (proxied, SSL/TLS mode "Full"), DNS managed in the user's Cloudflare account. **Caught and fixed a bug in my own setup**: when I first added the admin/platform domains through Coolify's "Add Domain" dialog, the field already had a value pre-filled (autocomplete or a stale value from a prior attempt) and my typed text got appended instead of replacing it, silently saving the domain as the literal string `admin.bcom.siadmin.bcom.si` — this is what caused a 503 ("no available server", Traefik had no router for the real hostname) that the user caught from a screenshot. Fixed by removing the bad entries and re-adding clean ones (`admin.bcom.si`, `platform.bcom.si`), redeploying each app, confirmed working (200, correct `service`/`db.role` in the health payload) end to end through Cloudflare on all three. Also removed the auto-added `www.admin.bcom.si` / `www.platform.bcom.si` entries — not needed for admin/API subdomains, only the storefront needs a www variant. **Lesson:** always verify a freshly-typed value in this Coolify UI by reloading and re-reading it, not just by what was typed — autocomplete/stale-value collisions are real here. During this cleanup I also accidentally removed `bsec-platform`'s auto-generated `sslip.io` fallback domain (clicked a stale element reference after a re-render) — low-impact, it was only a diagnostic convenience, not something anything depends on, but noting it here since it was never explicitly called out at the time.
- [ ] `platform.bcom.si` is publicly reachable with no auth in front of it yet (M1 will add platform_staff auth at the app layer; Cloudflare Access could restrict it sooner — not set up).
- [x] Cloudflare R2 for offsite backups — set up and verified end-to-end; see the Backups item below.
- [x] Staging, as a CI-based ephemeral stack instead of a persistent VPS (decided 2026-09-29, cost/simplicity). `ci.yml`'s `staging-smoke-test` runs `docker-compose.staging.yml` with the just-pushed `sha-<sha>` GHCR images and per-run random secrets, asserts migrate exit 0 and `/health` (`status`, `db.ok`, `db.role`) on web/platform/worker/admin, then `down -v` under `if: always()`; `deploy-production` needs it. **Verified**: green run 36536841168 (commit 128d86a), staging job 39s, all health checks passed with correct roles, teardown removed all containers/volume/network, production deployed after. Still TODO: COD order smoke test for M5's exit criterion. See RUNBOOK section 0.
- [x] Admin/platform domains: `admin.bcom.si` and `platform.bcom.si` (+ auto-added `www.` variants) configured on `bsec-admin` / `bsec-platform` in Coolify and both resources redeployed. **Blocked on DNS**: neither subdomain has an A record yet (`nslookup` confirms NXDOMAIN) — I don't have registrar/Cloudflare access to add one. **Action needed:** add `A admin.bcom.si → 88.222.241.159` and `A platform.bcom.si → 88.222.241.159` (same IP as the working `bcom.si` record) at whatever DNS provider manages bcom.si; SSL will then issue automatically on Coolify's next check. Also worth deciding before real use: per PLAN §14, `platform.*` should sit behind Cloudflare Access (or at least not be publicly reachable) since it's the BYPASSRLS admin API — right now it's just a public HTTPS domain like any other once DNS resolves.
- [x] Production deploy wired for real: `ci.yml`'s `deploy-production` job calls Coolify's `POST /api/v1/deploy` with a Coolify API token (Keys & Tokens → API Tokens, permission scope **Deploy** only, 1-year expiry — rotate before it expires) stored as the `COOLIFY_TOKEN` secret on the GitHub `production` environment. Deploys `bsec-migrate` first, sleeps 45s (no read-scope to poll status — deploy-only token), then redeploys the four app resources in one call (Coolify accepts comma-separated UUIDs). **Verified against the real API**: manually triggered a deploy of all 5 resources via `curl` before wiring CI, confirmed each redeployed and stayed healthy. The `deploy-staging` job was removed (see above) rather than left as a no-op.
- [ ] GitHub `production` environment has **no required-reviewers gate** — attempted to set one via API, got `422`: "Please ensure the billing plan supports the required reviewers protection rule." Private repos need a paid GitHub plan (Team/Enterprise, or a public repo) for this feature. Until upgraded (or the repo is made public), the "manual approval" in `ci.yml`'s comment is aspirational only — every push to `main` that passes CI deploys straight to production automatically.
- [x] Database backups: **Coolify's native scheduled backup** set up on `bsec-postgres` instead of pgBackRest (simpler, no VPS shell access needed, and Coolify already had the feature built in) — daily `pg_dump` of the `bsec` database at 02:30 UTC (cron `30 2 * * *`), local retention 14 backups / 14 days / 5 GB cap. **Verified for real**: ran "Back Up Now", produced a 45 KB dump, listed under Executions as `Success`, stored at `/data/coolify/backups/...` on the VPS.
- [x] Offsite backups to Cloudflare R2. Created bucket `bsec-backups` (Standard class, Asia-Pacific) and a scoped Account API Token ("R2 Account Token Backups", Object Read & Write, limited to that one bucket — same pattern as the existing per-project tokens). Added it in Coolify as an S3 Storage destination (`bsec-backups-r2`, endpoint `https://7a0533854a8ded58696db809f403f26c.r2.cloudflarestorage.com`, region `auto`) — shows **Connected** after Validate Connection. Attached it to `bsec-postgres`'s existing backup schedule (S3 storage + "Keep local backup", so local disk still has a copy too). **Verified for real**: ran "Back Up Now", the execution shows `Success` with both `Local Available` and `S3 Available`, and the Cloudflare R2 dashboard shows real objects under `bsec-backups/data/` with non-zero Class A/B operations.
- [x] Backup restored into a scratch database, with RPO/RTO logged (2026-09-28). Ran through Coolify's browser Terminal into the `bsec-postgres` container (no raw VPS SSH used): took a fresh `pg_dump -Fc` of `bsec` (54.6 KB, sub-second), created a scratch database `bsec_restore_drill`, ran `pg_restore` into it, verified it came back structurally correct (13 tables restored across `public` + `pgboss` schemas, matching the source), then dropped the scratch database and removed the temp dump file. **RPO:** effectively 0 for this drill since the dump was taken fresh immediately before restoring (the real, scheduled RPO is ≤24h per the daily cron — see the pgBackRest note below for why that's not ≤15min yet). **RTO:** dump + restore + verify + cleanup completed in under 2 minutes end to end (well inside the plan's ≤2h target), though this was a small (55 KB) M0-era database with no real order/customer data yet — re-run this drill once real data volume exists to get a meaningful RTO number at scale. Did **not** compare row counts against the live `bsec` database directly (the coding agent's safety layer correctly blocked a direct read against the production database mid-drill) — verification was structural (table/schema count) rather than row-for-row, which is sufficient to prove the restore mechanism works but not a full data-integrity diff; worth tightening in a future drill once there's real data to diff.
- [ ] pgBackRest / WAL continuous archiving (`infra/backups/`, draft) — superseded by the Coolify-native `pg_dump` approach above for now. pgBackRest gives point-in-time recovery (RPO ≤ 15 min); daily `pg_dump` only gives RPO ≤ 24 h. Revisit if/when real order data makes that gap matter.
- [ ] Sentry projects + DSNs set. The code is wired and no-ops without a DSN; not yet verified against a live Sentry.
- [ ] Better Stack log drain + uptime monitors.
- [ ] Coolify healthcheck (the HTTP-request check configured per-resource) fails on this server with "wget: can't connect to remote host: Connection refused" even though the app is listening — its `docker exec`-style check appears to run outside the app container's network namespace. Worked around by leaving Coolify healthchecks **disabled** on all four app resources and verifying liveness via the apps' own `/health` endpoints externally instead. Worth root-causing later (possibly a Coolify/Docker network mode quirk on this host) before relying on Coolify's own rolling-update healthcheck gating.
- [ ] Coolify's "Exposed ports" field was flaky when set through the General page's Internal-access widget (silently reverted to `80` after save+reload for two resources) but reliable when set through the dedicated Networking sidebar page. Every app also now sets `PORT` (and `HOSTNAME` for web) explicitly as an env var as a defensive fix — don't rely on "Exposed ports" alone to determine what port the app binds.
- [x] Cleaned up two stray Coolify resource states (2026-09-28), found by spot-checking the project's resource list: `bsec-migrate` was stuck in a `Restarting` loop (expected — it's a one-shot job that exits 0, and Coolify's default restart policy loop-restarts anything that exits; the last two doc-only pushes retriggered a deploy and nobody had manually stopped it since — see the gotcha already noted above). Stopped it; now `Exited` as intended. Separately found a genuinely stray resource, `bsec:main-o99ubyhaj8qpgqyiwhoyzrgs` — an application built via Git+Railpack directly from the `bs-commerce-platform` GitHub source (not our GHCR Docker-image pipeline), with "Deploy on push" enabled, listening on port 3000 (colliding with `bsec-web`), stuck crash-looping. Not referenced anywhere in this repo's docs; almost certainly an artifact from connecting GitHub as a Coolify source earlier in the session. Confirmed with the user, then deleted it entirely (including its volumes/networks/config). Resource list is now exactly the 6 real resources: `bsec-admin`, `bsec-migrate`, `bsec-platform`, `bsec-postgres`, `bsec-web`, `bsec-worker`.

### Notes / decisions this session
- TypeScript pinned to 6.0.3, not 7.0.2: typescript-eslint 8.70 supports `<6.1`.
- Only the 6 M0 packages were created. payments, shipping, storage, email and blocks will be created in their milestones.
- The `migrate` image is a fifth image beyond the four apps. It carries the owner credentials so that no runtime image does.
- Local compose: if host port 5432 is taken, run with `POSTGRES_HOST_PORT=55432`. This machine needed it.

## Next: M1 · Tenant isolation proven
Schema for platform/identity/settings, full `tenantTable()` with composite FKs, `withTenant()`, host resolver, TenantContext, Better Auth staff and customer instances, memberships/roles, feature flags, and the generated isolation suite.

## Admin UI refresh (2026-10-01)

Store admin (`apps/admin`) moved to a new component system and layout. Standards and the "use this for everything new, upgrade old screens when touched" rule are in [docs/admin-ui-standards.md](docs/admin-ui-standards.md).

- [x] shadcn (Base UI, preset `b1D2d9ge`/base-mira) added to the admin and mapped onto the existing Supabase-style tokens in `src/index.css` (our token names stay the source of truth). Light/dark still via `data-theme`.
- [x] Shell: collapsible icon sidebar (Ctrl/Cmd+B, remembered), 25% narrower (12rem), white sidebar on a grey canvas so white cards stand out.
- [x] Orders: server-driven table (search, filters, sort, paging, rows per page, selection and "select all results", bulk actions with progress, filter chips, Columns menu, sticky header, quick-actions menu, mobile cards and Filters/Sort sidebars, all state in the URL). Order detail and create-order are full pages (`/orders/$orderId`, `/orders/new`). Customer name shown first in the table.
- [x] Same table system on Products (status/stock/created filters, bulk activate/draft/archive/delete), Inventory (stock tabs, adjust dialog), Customers (repeat/marketing/joined filters; detail is a page `/customers/$customerId`), Discounts (status/type; create is a page `/discounts/new` with minimum order value, per-customer limit, combinable, schedule).
- [x] Shared kit: `components/data-table/*`, `simple-select`, `date-range-picker`, `scroll-tabs`, `confirm-dialog`, frosted popups.
- [x] Settings is one workspace (`/settings/*`): compact left navigation (dropdown below `lg`), one route per section so back/forward work, consistent header with the primary action, single card with dividers, unsaved-changes warning when switching sections, 12px type scale like the tables.
- [x] Backend (existing columns only, no migrations): orders list gained sort, date range, COD flag, customer name, name search and a single grouped query for item counts (was one query per row); products/inventory/customers/discounts lists gained sort and filters (stock, repeat, marketing, type, created range).
- [ ] Not browser-tested: the Playwright e2e suite (two specs updated for the Settings workspace and the new state dropdown), CSV downloads, bulk fulfil/invoice/cancel on orders, dark mode, tablet widths.
- [ ] Old-style screens still to upgrade: Online Store (Themes, Pages, Navigation, editors), superadmin and platform UIs; edit flows for customers and discounts; order refund/return actions.
- Gotchas: after changing `packages/contracts` or `packages/domain`, restart the Next dev server (new query params are silently dropped otherwise). Pages that use the table kit or `useUnsavedGuard` must render inside a router in tests.

