# Settings rebuild Phases 0+1 — grouped shell, Overview, Store Details migration

- **Date:** 2026-10-04
- **Agent:** zcode
- **Branch:** `feat/settings-rebuild-phase-0-1` (from `origin/main` c7ccbec, which merged the planning docs as PR #24)
- **Area:** admin settings UI, contracts, domain, web api wiring
- **Type:** feature
- **Prompt:** `docs/prompts/settings-rebuild-phase-0-1.md` (Codex)

## Summary

Replaces the flat Settings workspace with a grouped, permission-aware shell, adds an operational `/settings` Overview backed by one narrow server read model (`admin.settingsOverview.get`), and migrates the General page to the canonical `/settings/store-details` route without changing stored data or business behaviour.

## Map of settings routes and data before this change (Commit 1 audit)

| Route | Contract used | Stored fields | Notes / divergences found |
|---|---|---|---|
| `/settings` (General) | `admin.settings.get/update` | `store_settings`: storeName, legalName, supportEmail/Phone, address, currency, timezone, orderPrefix, autoPublishReviews (+ checkout cod/tax via contract) | orderPrefix already rendered read-only with a link to Orders (ORDERS-SETTINGS-PLAN §3 done). Currency and timezone already read-only inputs. |
| `/settings/orders` | `admin.orderSettings.get/update` | `number_sequences` (prefix/padding/next) + `store_settings.order_settings` | Canonical order-number editor. |
| `/settings/returns` | `admin.returnSettings.get/update` | `store_settings.return_settings` | Canonical returns editor. |
| `/settings/storefront` | `admin.storefront.getStatus/updateStatus` | `store_status` | Canonical store-status editor. |
| `/settings/branding` | `admin.branding.*` | `brand_settings` | Unchanged. |
| `/settings/shipping` | `admin.shipping.get/update` | `shipping_zones`, `shipping_rates` | Simplified single-zone model; default zone + rates. |
| `/settings/payments` | `admin.payments.*` | `store_settings.checkout.cod`, `tenant_secrets` (razorpay, write-only) | States online-payment unavailability honestly (`ONLINE_PAYMENT_AVAILABLE = false`). |
| `/settings/taxes` | `admin.settings.get/update` with `tax` key | `store_settings.checkout.tax` | **Taxes persists through the generic settings contract** (taxes.tsx:82). `settings.update` therefore remains a superset (orderPrefix/cod/tax keys) and must stay intact. |
| `/settings/team` | `admin.memberships/roles/invitations` | identity tables | Label becomes "Users"; route path unchanged (conservative reading of the prompt's conditional). |
| `/settings/support` | `admin.support.*` | `support_sessions`, standing consent | Moves to "Compliance & advanced" group. |

### Divergences between the prompt's assumptions and the code (documented, not silently resolved)

1. **Timezone** is *not* currently editable in the General UI (read-only input; the update contract accepts free text). This phase makes it an editable controlled select with contract validation added.
2. **Weight unit** exists in `store_settings` schema but is **absent from the settings contract and has zero consumers** in domain/web code. Surfacing it would be a setting with no enforced behaviour, so it is *not* added to the UI in this phase.
3. `businessType`, `ownerProfile`, `locale`, `dateFormat`, `timeFormat`, `unitSystem` (prompt's conditional low-risk fields) are **deferred**: no domain consumer exists this phase, and schema doc §1 rule 5 forbids rendering unconsumed settings.
4. **Address shape** uses `state`/`pincode` keys (schema doc §2.3 targets `stateOrProvince`/`postalCode`). The existing keys are preserved; `countryCode: "IN"` is added to the stored address on save (jsonb key, no migration).
5. `getOnboardingProgress`'s `domain_connected` step counts *any* active domain row (`type != 'subdomain'` matches `platform_subdomain` rows too, onboarding.ts:68). My overview derives `hasCustomDomain` from `type = 'custom' AND status = 'active'` instead. The onboarding quirk is pre-existing and **not changed** here (flagged for the owner).
6. `updateStoreSettings` wrote **no audit log**; this phase adds one (before/after, no secrets) per AGENTS.md rule 6.

## What changed

### Commit 1 — foundation and read model
- `packages/contracts/src/admin.ts`: `SettingsOverview`/`SettingsOverviewAction` schemas + `settingsOverview.get` procedure.
- `packages/domain/src/admin/settings-overview.ts`: `getSettingsOverview` (asserts `settings.write`; reuses `getOnboardingProgress`, `getTenantSubscription`, `listTenantDomains`, `parseStoreConfig`; one `withTenant` read for store_status/cod/shipping/products) and pure `deriveSettingsOverviewActions` for the readiness matrix.
- `apps/web/src/server/api.ts`: handler wiring (`settings.write`).
- `packages/domain/test/isolation.int.test.ts`: dispatcher case + presence assertions + tenant-scoped readiness data test.
- `packages/domain/test/settings-overview.test.ts`: unit matrix for every readiness condition (shown/omitted) + contract parse tests.

### Commit 2 — shell and Overview UI
- `apps/admin/src/components/settings/settings-nav.ts`: `SETTINGS_NAV_GROUPS` (Overview / Store / Selling / Operations / People & account / Compliance & advanced), `visibleSettingsGroups` omitting empty groups after permission filtering; team item relabelled **Users** (route unchanged).
- `settings-layout.tsx`: grouped sticky desktop sidebar + grouped mobile/tablet chooser; `simple-select.tsx` gains optional `groups` (existing flat `options` API untouched).
- `/settings` renders the Overview (loading / error-retry / populated / nothing-to-do states).
- General editor moved to `/settings/store-details`; order-prefix field dropped (Orders canonical), currency read-only with hint.
- `apps/admin/test/settings-shell.test.tsx`: nav grouping/permission matrix, Overview states, store-details migration rendering — inside the in-memory router.

### Commit 3 — Store Details completion
- Contracts: `STORE_TIMEZONES` curated IANA list + `StoreTimezone` validator now guarding `settings.update.timezone`; `StoreAddress.countryCode` (alpha-2, optional).
- Domain (`store-config.ts`): **`updateStoreSettings` now writes `audit_logs`** (`store_settings.update`, before/after diff of the aggregate's own fields, no secret-shaped values); address writes default `countryCode` to the existing value or `"IN"`; orderPrefix untouched when omitted.
- Store details UI: editable timezone `SimpleSelect` (curated list, was a read-only input), read-only Country (India), **Tax identity** section showing the GSTIN read-only with a "Managed in Settings > Taxes" link (no second editor), review section retitled **Review moderation**.
- Compatibility: the old General entry `/settings` now shows the Overview (by design); the editor lives at `/settings/store-details`; no legacy `/settings/general` route ever existed, so no redirect is required — covered by the UI tests.
- Int tests (`store-settings.int.test.ts`): audit row with before/after diff and no secret-shaped values, append-only on re-save, `countryCode` defaulting/preserving, timezone persistence, orderPrefix untouched when omitted.

### Deliberately not built (prompt's conditional fields)
`businessType`, `ownerProfile`, `locale`, `dateFormat`, `timeFormat`, `unitSystem` and `weightUnit` in the UI: none has a domain consumer this phase, and SETTINGS-SCHEMA.md §1 rule 5 forbids rendering a setting before a domain consumer enforces it. Migration slot 0032 remains free because no new column/table was needed (countryCode lives in the address jsonb; timezone already existed).

## Verification

### Gate

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | 15/15 packages pass |
| Lint | `pnpm lint` | pass (0 errors) |
| Build | `pnpm build` | 6/6 pass |
| Docs | `pnpm docs:check` | ok |
| Contracts tests | `pnpm --filter @bs/contracts test` | 17/17 (3 new: overview procedure, timezone/countryCode) |
| Domain fast | `pnpm --filter @bs/domain test:fast` | 247/247 incl. 10 new settings-overview unit tests |
| Admin tests | `pnpm --filter @bs/admin test:fast` | 32/32 incl. 7 new shell/overview/store-details router tests |
| Web tests | `pnpm --filter @bs/web test:fast` | 17/17 files pass |
| Real-DB isolation | `vitest run test/isolation.int.test.ts` | 761/761 (incl. 5 auto security tests for `settingsOverview.get` + tenant-scoped readiness data test) |
| Real-DB store settings | `vitest run test/store-settings.int.test.ts` | 16/16 (incl. 4 new audit/countryCode/timezone/orderPrefix tests) |
| Full heavy suite | `pnpm --filter @bs/domain test:heavy` | **63/63 files, 1202/1202 tests, 0 failures, exit 0** (12m35s, Testcontainers Postgres 18). A first run during the local walkthrough showed the known Windows teardown/worker flake (non-zero exit, no test failures); the clean rerun above is the reported result. |

### Browser walkthrough (local docker Postgres 55432 + `@bs/web dev` + `@bs/admin dev`, seeded demo store — never production)

1. Desktop 1280px light: `/settings` Overview — grouped sidebar (6 groups), "Store is not live" with working **Fix** → `/settings/storefront`, honest "Using the platform subdomain" informational card (no link), status grid (Coming soon / walkthrough.bcom.si / Cash on delivery / 4/5 steps), 2 qualifying quick links. `/settings/store-details` — all fields populated, Save disabled when clean.
2. 375px light + dark, 768px tablet dark: grouped chooser above content, preserves the active route, form single-column and readable.
3. Dirty-form guard: editing Support phone enables Save; SPA sidebar click → "Discard unsaved changes?" dialog (Keep editing keeps, Discard leaves); hard `goto` while dirty aborted by the beforeunload handler.
4. Save: phone change persisted across reload; audit row verified in psql — `store_settings.update` with a minimal `{"supportPhone": {"before", "after"}}` diff on update (full diff with nulls on row creation), no secret-shaped values; address jsonb gained `"countryCode": "IN"`.
5. Not manually exercised in the browser: save-server-error retry state (covered by the admin router error-state test) and a role without `settings.write` (nav filtering covered by unit tests, 403s by the isolation suite). No production store or credentials were touched; the walkthrough stack was a disposable docker container.

## Open questions for the owner

1. Onboarding `domain_connected` semantics (divergence 5 above): keep counting the platform subdomain, or fix to custom domains only?
2. Overview visibility is gated on `settings.write` for parity with the old General page (no `settings.read` exists in the current model). Widen to all staff when the permissions ADR lands?

## Definition of done

- [x] Code follows AGENTS.md §2/§3; gate passes (counts above).
- [x] Tests added, including real-DB isolation for the new procedure.
- [x] `docs/ARCHITECTURE.md` updated (routes/API sections) and "Last verified" bumped.
- [x] Change record (this file) and `progress.md` In-flight updated (claim stays until merge).
- [x] No secrets, generated files or unrelated edits in the diff (the temporary walkthrough seed script and docker container were removed after verification).
- [x] Honest status in Verification: browser walkthrough items 1–5 exercised live; item 5 lists the two states covered by tests but not driven by hand.
