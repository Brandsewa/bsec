# Builder prompt: Store Admin Settings rebuild — Phases 0 and 1

You are the assigned builder for **Phases 0 and 1 only** of the Store Admin Settings rebuild in the `bsec` monorepo. Do not begin Phase 2 or later areas. Your work must leave a safe foundation for another builder to implement the remaining Settings sections.

## Objective

Replace the current flat Settings workspace with a grouped, permission-aware Settings shell and an operational **Overview** page. Migrate the existing General page to a canonical **Store details** route without losing settings, duplicating editors, or changing current business behaviour.

The intended result is not a visual mock-up. It is a working, tenant-isolated, audited and tested slice of the Settings rebuild.

## Scope boundary

### You must build

1. **Settings shell and information architecture**
   - Grouped navigation and routes for the completed/current settings pages.
   - Permission-aware navigation and direct-route protection using the existing permission model only.
   - Responsive desktop and mobile settings navigation.
   - A Settings Overview page at `/settings`.
   - Canonical `/settings/store-details` route and migration of the present General page.
   - Redirect or compatibility handling for the previous General route so existing links/bookmarks do not break.
   - Shared setting-status/empty/error/save primitives only where needed for this scope.

2. **Store Details migration**
   - Move existing store name, legal name, public support email/phone, business address, currency, timezone, weight unit and review moderation into `/settings/store-details`.
   - Add only the low-risk fields defined below if their persistence and behaviour are fully implemented in this phase: `businessType`, `ownerProfile` (display profile only), `locale`, `dateFormat`, `timeFormat`, `unitSystem`.
   - Preserve the current GST/tax configuration in its existing Taxes page; do **not** make a second GST editor here.
   - Preserve order number configuration in Settings > Orders; do **not** add a second order-prefix editor.

3. **Overview read model**
   - Server-verified setup/action cards for only facts the system can currently prove: store status, payment method availability, default shipping configuration, product existence, domain state, current plan/usage where the data is already safely available, and direct links to corrective pages.
   - Reuse `getOnboardingProgress` where appropriate, but do not create a competing static checklist.
   - Do not claim a setting is configured merely because a row exists; derive readiness from the actual current source of truth.

4. **Documentation and tests**
   - Contracts first, then domain, then UI.
   - Unit/UI tests and real-database tests required below.
   - Architecture documentation, change record and progress claim updates.

### You must not build

- The new granular permission system. It requires an ADR and owner decisions. Continue using `settings.write`, `staff.manage`, and existing permissions; encapsulate navigation configuration so a later permission split is straightforward.
- Payment provider work, Razorpay changes, Stripe, PayPal, Shiprocket, SMS, WhatsApp, or email sending.
- Checkout, customer-account, shipping-profile, GST engine, policy, privacy, notification, storage, billing, domain-provider or maintenance scheduling features from later phases.
- Merchant-owned storage configuration, provider credentials, arbitrary HTML/CSS/JS or email template code.
- A visual redesign outside Settings or new dependencies without a documented reason and approval.

If you discover a missing product decision that materially changes this phase, stop and ask the owner. Do not silently choose a policy.

## Read before writing code

Read all of these in order. They are binding requirements, not background reading.

1. `AGENTS.md`, especially sections 1–7.
2. `docs/ARCHITECTURE.md`, especially admin routes, APIs, settings data, tenant/RLS and testing sections.
3. Newest relevant files in `docs/changes/` and `progress.md` for overlap.
4. `docs/SETTINGS-REBUILD-PLAN.md` — sections 0–6 and 8.
5. `docs/SETTINGS-SCHEMA.md` — sections 0–3, 5, 10 and 14–15.
6. `docs/admin-ui-standards.md`.
7. `docs/ORDERS-SETTINGS-PLAN.md` — preserve the canonical Orders/Returns placement and do not reintroduce duplicate fields.
8. `docs/adr/001-modular-monolith.md`, `002-tenant-isolation-rls.md`, `004-nextjs-cache-components.md`, `006-pg-boss-jobs.md`, `010-no-merchant-code.md`, `014-platform-billing-separation.md`, `017-custom-domain-provider-adapter.md`, `019-customer-auth-and-platform-mailer.md`.
9. The current implementation files:
   - `apps/admin/src/components/settings/settings-nav.ts`
   - `apps/admin/src/components/settings/settings-layout.tsx`
   - `apps/admin/src/components/settings/settings-page.tsx`
   - `apps/admin/src/routes/_store/settings.tsx`
   - `apps/admin/src/routes/_store/settings/index.tsx`
   - all `apps/admin/src/routes/_store/settings/*.tsx`
   - `packages/contracts/src/admin.ts`
   - `packages/domain/src/admin/store-config.ts`
   - `packages/domain/src/saas/onboarding.ts`
   - `packages/db/src/schema/settings.ts`
   - `packages/db/src/schema/saas.ts`
   - current domain isolation-test mapping in `packages/domain/test/isolation.int.test.ts`

If any required file or plan is missing, stop and report it. Do not substitute guessed architecture.

## Git and collaboration protocol

1. Run `git fetch` first.
2. Work in your **own worktree** on a new branch from the latest `origin/main`: `feat/settings-rebuild-phase-0-1`. If the plan documents are not on `origin/main`, ask the owner which commit/branch to base on. Do not edit this prompt branch.
3. If the worktree is not clean, stop; do not stash, reset, discard or sweep up other agents' files.
4. Before code, add exactly one line to `progress.md` “In flight” with your agent name, branch, area, date and scope. Check for an existing Settings claim and coordinate rather than editing the same files concurrently.
5. Keep all work local. Do not push, merge or force-push. Stage exact files only; never use `git add -A`, `git add .`, or `git add <directory>`.
6. Make focused commits with your own configured agent trailer. Leave a new change record `docs/changes/YYYY-MM-DD-<agent>-settings-rebuild-phase-0-1.md` before hand-off.

## Product and UX specification

### A. Target routes for this phase

| Route | Phase-0/1 action |
|---|---|
| `/settings` | New Overview. It replaces the old General screen. |
| `/settings/store-details` | New canonical Store details editor. |
| `/settings/orders` | Keep current route/page; navigation moves it into Operations. |
| `/settings/returns` | Keep current route/page; navigation moves it into Operations. |
| `/settings/storefront` | Keep current route/page; navigation moves it into Store. |
| `/settings/branding` | Keep current route/page; navigation moves it into Store. |
| `/settings/shipping` | Keep current route/page; navigation moves it into Selling. |
| `/settings/payments` | Keep current route/page; navigation moves it into Selling and must continue to state online-payment unavailability honestly. |
| `/settings/taxes` | Keep current route/page; navigation moves it into Selling. |
| `/settings/team` | Keep current functionality; relabel navigation as **Users** only if the existing route/API still works and the compatibility redirect is tested. Otherwise leave the route name but label the nav item “Users”. |
| `/settings/support` | Keep current route/page; navigation moves it into Compliance & advanced. |

Do **not** add empty future routes to the visible navigation. A route may exist only if it has useful, authorized content. Future pages belong in the plan, not as placeholder UI.

### B. Grouped navigation

Use these navigation groups, omitting empty groups after permission filtering:

| Group | Items in this phase |
|---|---|
| Store | Store details, Branding, Storefront |
| Selling | Payments, Shipping, Taxes |
| Operations | Orders, Returns |
| People & account | Users |
| Compliance & advanced | Support access |

Desktop: a compact sticky grouped sidebar inside the existing Settings layout. Each item has label, concise description and existing icon family. Do not import another icon package or change the project icon system.

Mobile/tablet: one accessible grouped section chooser above content. It must work with `SimpleSelect`/existing kit conventions, preserve the active route, and never navigate away without triggering the unsaved-changes guard in a dirty child form.

Use the current router's `pendingComponent` conventions on every changed or added admin route.

### C. Overview page

Use `SettingsPageFrame` and the existing admin tokens/components. Do not create a dashboard with generic bento cards or new visual language.

Required content:

1. **Action required**: render only actionable conditions with server proof. Candidate conditions:
   - store is not live;
   - no active COD/payment option currently usable;
   - no effective default shipping rate;
   - no product;
   - no custom domain (informational, not a blocker while a valid platform subdomain exists);
   - incomplete store details only if the needed field can be assessed reliably.
2. **Store status**: current lifecycle mode, safe storefront link, and a link to Storefront settings.
3. **Readiness/progress**: reuse server `getOnboardingProgress` output; do not hard-code progress on the client.
4. **Quick links**: maximum four priority links based on missing prerequisites.

Strict requirements:

- No health/plan/payment card may expose secrets, raw provider errors, platform environment state or another tenant's information.
- If a data source is unavailable due to permissions or an unimplemented feature, omit the card or explain the limitation precisely. Do not fabricate a green/success state.
- Design full loading, empty and recoverable error states.
- The page needs one new, narrow contract/domain read model. It should not have the admin SPA query database-like endpoints separately.

### D. Store details editor

Use independently saveable sections only if updates have distinct validation/lifecycle; otherwise one form with an obvious primary save and the shared unsaved guard. Preserve the current UX standards.

#### Business identity

| Field | Rule for this phase |
|---|---|
| Store name | Existing field; 1–120; existing behaviour preserved. |
| Business type | Optional enum in schema; show only if migration/service/contract are implemented. |
| Legal business name | Existing optional field; max 200. |
| Registered address | Country, line 1, line 2, city, state, PIN/postal code. Extend existing address safely with `countryCode: "IN"` default only if present data stays valid. |
| GSTIN/Tax ID | Read-only “Managed in Taxes” link in this phase. No duplicate editor. |

#### Store owner

| Field | Rule for this phase |
|---|---|
| Display name/designation/contact profile | Optional new `ownerProfile` only if persisted as a versioned object and audited. |
| Actual owner account/email | Show a read-only summary from membership/account only if readily available and authorized. Changing owner is out of scope; link/explain rather than pretending it is editable. |

#### Public contact

Existing support email and phone remain the source for storefront/invoice/reply-to display. Validate email accurately and sanitize/validate phone without rewriting the user's number unexpectedly.

#### Regional defaults

| Field | Rule for this phase |
|---|---|
| Currency | Show INR/current value. Do not make it editable when an order exists. If no safe edit workflow exists, leave it read-only with plain explanation. |
| Language/locale | Default/display only unless the field is fully persisted and only `en-IN` is supported. Do not imply translations exist. |
| Timezone | Existing editable IANA timezone; default Asia/Kolkata. Use a controlled/selectable list, not free text. |
| Date/time format | Optional new persisted enum only if straightforward; otherwise display current standard and defer UI. |
| Unit system/weight unit | Existing weight unit must remain compatible. If adding unit system, it only determines display/default selection; product/order stored values must not be silently converted. |

#### Review moderation

Move the existing `autoPublishReviews` control to the bottom as **Review moderation**, or leave it at its existing behaviour with a clear explanation. Do not create a Reviews navigation route in this phase.

### E. Data and API requirements

Follow exact order: contract → domain service → API handler wiring → UI.

1. Do not extend an untyped generic settings endpoint. Use a narrow `admin.settingsOverview.get` contract for the Overview and appropriately typed Store Details get/update shape.
2. Any new stored fields require an append-only migration. New tenant table: `tenantTable()` plus `forceRlsSql`, composite FKs, grants and migration-journal update. Prefer a versioned `store_settings` group for the small Store Details additions only if its lifecycle/permissions match existing fields.
3. Every mutation calls `assertPermission(ctx, "settings.write")` for this phase, writes a `audit_logs` row with before/after **excluding any secret**, and calls cache invalidation after commit.
4. A getter must not be called inside the transaction that wrote a setting. Commit first, then read/invalidate as the existing code pattern requires.
5. All tenant reads/mutations run inside `withTenant`; no app imports `@bs/db`, Drizzle or drivers.
6. Preserve old defaults exactly for stores that have no saved new fields. No existing store may change checkout, tax, currency, timezone, unit, review, payment, shipping or storefront behaviour solely because this ships.

### F. What to inspect before modifying current data

- Verify whether `store_settings` has an existing row for every provisioned tenant. Preserve `getStoreSettings` fallback behaviour.
- Identify the existing onboarding and payment/shipping/domain sources before defining Overview readiness. Read each real source, do not inspect table names and assume semantics.
- Inspect current API handler mappings and the isolation test's procedure dispatcher before adding `settingsOverview.get`; map the new procedure in `packages/domain/test/isolation.int.test.ts` in the same change.
- Check the latest adjacent changes in `docs/changes/` for active work on domains, customers, orders/returns or themes before editing shared settings files.

## Required test matrix

### Contracts/domain

- Store Details schema accepts valid field boundaries and rejects invalid store name, email, enum, timezone, unit, country and address input.
- Existing-store/no-new-fields parsing produces the same current defaults.
- Authorized `settings.write` actor can read/update only their tenant's settings.
- Unauthorized staff actor is refused by the domain service, not merely by UI hiding.
- Cross-tenant update/read is refused in a **real Postgres** test.
- Every mutation writes a correct audit log with before/after relevant values and no secret/credential fields.
- New Overview read model is mapped into the isolation suite and cannot surface another tenant's readiness state.
- Each readiness condition has a test for both shown and omitted/cleared state; it must match real configured behaviour.

### Admin UI

- Grouped desktop navigation shows current items only to authorized users and selects the right active item.
- Mobile chooser navigates correctly and carries the active value.
- `/settings` has loading, error, populated and no-actions-needed states.
- Store Details loads, saves valid updates, displays server errors, disables save when clean, and blocks navigation/refresh while dirty.
- Legacy `/settings` General entry reaches the new Overview; Store Details has a clear route. Any compatibility redirect is explicitly tested.
- Render routes inside the in-memory router using established test helpers; do not test components in a router-less context.

### Browser verification

Run the admin locally against only local/ephemeral data and manually exercise:

1. `/settings` and `/settings/store-details` desktop.
2. The same at 375px and a tablet width.
3. Light and dark themes.
4. Dirty-form navigation confirm/cancel; browser refresh warning.
5. Save error and retry behaviour.
6. A role without `settings.write`/relevant permission, if local fixtures permit it.

Never use a live production store or credentials.

## Required implementation order and commits

### Commit 1 — foundation and read model

- Map existing settings routes/data and document any divergence found.
- Add typed Overview contract/domain read model, permission enforcement and real-DB isolation mapping/tests.
- Do not touch visual navigation until the data model/read state is trustworthy.

### Commit 2 — shell and Overview UI

- Implement grouped settings navigation, responsive chooser and Overview route/UI.
- Keep existing functional routes accessible; add UI tests.

### Commit 3 — Store Details migration

- Add only approved/persisted low-risk fields, migration if needed, contract/domain/audit/cache work, Store Details UI and compatibility redirects.
- Remove/redirect the old General editor only after its fields are proven represented in one canonical place.

### Commit 4 — verification/docs fixes

- Fix test/build/documentation findings only. Do not smuggle in later settings features.
- Update `docs/ARCHITECTURE.md` with every new route/procedure/table and bump its “Last verified” reference as required.
- Add the change record and update/remove your `progress.md` in-flight claim only when handing off a complete branch.

If commit groups cannot be cleanly separated due to a hard dependency, explain the dependency in the change record; keep the diff focused.

## Acceptance criteria

- [ ] `/settings` is an operational Overview, not the old General form.
- [ ] `/settings/store-details` is the sole canonical editor for General/store-detail fields in scope; Taxes and Orders remain the canonical editors for their own fields.
- [ ] Desktop navigation is grouped; mobile/tablet navigation is accessible, route-driven and unsaved-change safe.
- [ ] No empty future section, duplicate editor or unimplemented toggle is visible.
- [ ] Overview derives each displayed status from real tenant-scoped server data and includes loading/error/empty states.
- [ ] Store Details preserves all existing General data and current defaults; any new field has migration, Zod validation, domain authorization, audit logging and real behaviour.
- [ ] Every changed admin route declares `pendingComponent`.
- [ ] All reads/mutations preserve RLS, domain-layer authorization and cache/audit rules.
- [ ] New domain procedure is added to the real-DB isolation suite; tests prove another tenant cannot access or infer settings/readiness data.
- [ ] UI is tested in a router and manually exercised at desktop, tablet and 375px in light/dark mode.
- [ ] The complete gate passes: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, relevant `@bs/contracts`, `@bs/domain`, `@bs/admin`, and `@bs/web` fast tests; `pnpm --filter @bs/domain test:heavy` run alone against Docker/Testcontainers or `TEST_DATABASE_URL_SUPERUSER`.
- [ ] A change record reports exact command output/counts, browser walkthrough, skipped checks and any discovered issues honestly.
- [ ] No unrelated files, generated files, secrets, provider integration changes or production actions appear in the diff.

## Hand-off format

When you finish, reply with:

1. branch name and commit hashes;
2. concise list of files/behaviour changed;
3. every test/build command and result, including real-DB counts;
4. browser walkthrough details and anything not tested;
5. exact owner questions or follow-up work; and
6. the path to your change record.

Do not call this complete until a verifier checks this prompt's acceptance criteria and the repository gate.
