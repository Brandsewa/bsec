# Admin and Super Admin polish round: plan

Status: BUILT on branch `fix/admin-polish-phase-1` (2026-10-17) after the owner's answers (section 3a). Not yet checked in a browser or merged; see `docs/changes/2026-10-17-claude-admin-polish-phases-2-3.md` for what was verified. Sections 5 and 6 below are the original build plan.
Owner: Claude Code (plans and builds), per `AGENTS.md` section 6. Date: 2026-10-17. Branch to use when building: new `feat/...` branches per phase, cut from the latest `origin/main`.
Source: the owner's issue log in `admin-issues-log.md` (repo root, untracked working file; IDs below refer to it).

Evidence level: every finding in section 2 was read from the code in this repo (schema, domain, admin/superadmin pages). **Nothing was run live**: no dev server, no real-database test, no reproduction of the bugs. Where a root cause is stated it is from reading the code and says "likely". Production data (e.g. whether the deleted "Taste of Hills" store was already purged) was not inspected.

---

## 1. Summary

31 logged items, grouped into three phases: quick fixes and bugs (Phase 1), medium features and decisions (Phase 2), and four large features that each need their own plan doc and ADR (Phase 3). Several items turned out to be partly built already, which lowers the effort:

- Variants already store weight, barcode, dimensions, cost price, backorder and pre-order fields, and `product_options` exists. The variant builder is mostly UI plus option-matrix generation (PR-06).
- Shipping already has zones and rates tables and a rate calculator. It lacks regions, price/weight tiers (S-01).
- The Domains page already shows DNS records and a "Re-verify domain" button for domains that are not active yet. What is missing is guidance before adding a domain and a clearer status flow (F-01).
- A tenant deletion workflow already exists (grace period, export, purge of all rows, verify). It deliberately keeps the tenant row, invoices and audit trail (SA-01).
- The platform audit log already stores IP, user agent, request id and a diff, plus CSV export and an action filter. It lacks pagination and a detail view (SA-07).
- Categories and collections are both fully built (routes, sitemap, SEO). The default menus and seeded content only link to collections (C-01).

## 2. Findings per item (from the code)

### Likely root cause of the blank Edit screen (N-01)
`packages/domain/src/saas/provisioning.ts` (about line 742) seeds the default Main menu and Footer menu with items shaped `{ title, url }`. The `MenuItem` contract (`packages/contracts/src/admin.ts` line 1053) requires `id` and `type`, and the editor (`menus_.$handle.tsx`) keys and drags items by `item.id`. A menu created in the UI gets ids and types, which is why it edits fine. Likely effect: the `admin.menus.get` response fails contract validation or the editor crashes on missing ids. Not reproduced live.

### Default menus cannot be deleted (N-02)
Protected on purpose: `isProtectedMenu(handle)` blocks delete in `deleteMenu` (`content-services.ts` about line 1522) and in the UI (`menus.tsx` about line 274). Also, `getMenu` calls `ensureDefaultMenus` when a protected handle is missing, so a deleted default would silently come back when opened. That must change together with the delete rule.

### Tenant deletion (SA-01)
Workflow in `packages/domain/src/platform/deletion-*.ts`: request (grace 0 to 90 days, default 7) then export, stop billing, disconnect domains, schedule media removal, purge all tenant rows, verify, mark `deleted`. `PURGE_KEEP_TABLES` keeps `tenants`, `platform_invoices` (8 years), `platform_audit_logs`, `tenant_deletions`, exports and support records. So a store shown as "deleted" most likely already has its data purged, and only the small tenant row remains. Removing that row would conflict with invoice retention: `platform_invoices.tenant_id` is `ON DELETE CASCADE` from `tenants` (`saas.ts`), so a naive row delete would also delete invoices.

### Friendly IDs (PR-02, SA-02)
No short or sequential id exists on products or tenants; the UI shows the UUID (`products/$id.tsx` line 250, `TenantDetail.tsx` line 309).

### Category labels (PR-05)
`products/$id.tsx` lines 500 and 535 render `${c.path} (${c.name})`. Top-level categories have path "/", hence "/ (Flavored Teas)".

### Sidebar hover (SA-08)
The behaviour is in the **shared** `packages/ui/src/layout/sidebar.tsx` (about line 168: `onMouseEnter` and `onFocus` open the group). Both the store admin and Super Admin use it, so removing it there changes both.

### Auth forms (A-01, A-02)
14 files use raw `type="password"` inputs; there is no shared password component. The shared `Label` (`packages/ui/src/components/ui/label.tsx`) has no spacing and auth forms place `Label` and `Input` directly without the `Field` wrapper that adds the gap.

### Feature flags (SA-06)
Table `feature_flags` (`packages/db/src/schema/platform.ts`): key, default_on, rules, kill_switch. No type, description, owner or retired state.

### Payments (P-01 to P-04)
Gateways enabled per platform live in `platform_payment_providers`; per-store credentials are encrypted (`tenant-secrets`); COD lives in `payment_methods`. The webhook URL shows `<your-store-domain>` because the page does not fill in the store's primary domain. Per rule 14 only test mode is in scope.

### Policies (PO-01)
Policies are stored as JSON blocks (`store_policies.draft_content`, immutable `store_policy_versions`). A rich text editor must save into a safe, validated format (ADR-010), not raw HTML.

### Shipping (S-01)
`shipping_zones` (name, countries, default flag) and `shipping_rates` (method standard/express, rateType flat/free_above_threshold, price, threshold, min/max days) plus `packages/domain/src/orders/shipping-rates.ts`. The UI edits one default zone with two flat rates.

### Blog URLs (B-01)
Flat `/blog/[slug]` was a deliberate choice (ADR-033); category in the URL was rejected there.

### Custom fields (F-03)
No custom-field tables exist. The theme builder binding to product data needs a research step in `packages/blocks` and `packages/block-editor` first.

---

## 3a. Owner decisions (2026-10-17) and what they change

| Q | Decision | Effect on the plan |
|---|---|---|
| 1 | Fully manual purge: data kept 30 days after deletion, then "Purge now" | SA-01: the automatic purge step in the deletion workflow must be changed to wait for the owner's button after 30 days (today it purges automatically after the grace period). |
| 2 | Keep a tombstone row, hide deleted stores by default | "Show deleted" filter; invoices and audit stay. |
| 3 | Platform owner only | Enforced server-side with `assertRoleAtLeast(..., "platform_owner")`. |
| 4 | Default menus still created, deletable and editable | N-01 fix + N-02; never re-created automatically after deletion. |
| 5 | Product ID format `BCPID-1042` | Per-store sequence, shown as `BCPID-<number>`. Store ID format not given: proposed `BCSID-0007` (see open points). |
| 6 | Remove sidebar hover-open from both apps | Change the shared `packages/ui` sidebar. |
| 7 | Replace bottom section; Razorpay lives inside the new Online gateways option | P-02 as planned. Test mode only. |
| 8 | Keep both; storefront currently shows only collections, so replace collections with categories on the storefront | C-01: the default navigation, seeded menu links and default listing surfaces point to categories (`/categories/...`) instead of `/collections/all`. Collections stay for campaigns. Needs a "shop all" categories index. |
| 9 | Flat `/blog/<slug>` plus breadcrumbs with structured data | B-01: no URL change. |
| 10 | Yes to all, best industry practice | SA-06 as recommended: kill switches (checkout, catalog, fulfillment) protected; `settings.*` flags retire-able; platform owner can restore. |
| 11 | Archive and export, no hard delete from the UI | SA-07 as planned. |
| 12 | Prepaid for the whole term, term options 6 / 1 / 3 (assumed 6 months, 1 year, 3 years) | SA-05: pricing phases are prepaid terms. |
| 13 | At the end, let the owner upgrade or choose a plan; suspend until they do | SA-05: expiry job suspends the store until a paid plan is chosen. |
| 14 | No GST for now | SA-05: no tax lines on platform invoices for now; keep a field to add later. |
| 15 | Customers keep the promo on upgrade | Promo phase carries over to the new plan. |
| 16 | Platform owner grants promos | Role check server-side. |
| 17 | Promo length cap 12 months | Promotion duration capped at 12 months (see open point on the 3-year term). |
| 18 | Store-level shipping only | No courier work. |
| 19 | All four rate types; zones by country and state | S-01: no PIN ranges in v1 (PIN-range support can be added later). |
| 20 | Storefront filtering by custom field: yes. Custom fields available from the second plan (Growth) and above, no limit on count | F-03: plan feature flag in `plans.features` (Starter has no custom fields), no per-store count limit, add storefront filter phase to the plan. |
| 21 | 3 options, 250 variants | PR-06 limits. |
| 22 | Convert policies on open | PO-01 as planned. |

### Open points A-E: ANSWERED 2026-10-17 (all recommendations accepted)
A: store ID `BCSID-0007`. B: prepaid terms 6 months, 1 year, 3 years. C: promo discount applies only to the first 12 months of a prepaid term. D: correct (suspended until a paid plan is chosen). E: yes, homepage sections and product-grid blocks default to categories too.

Original wording of the open points:
- A. **Store ID format** (SA-02): `BCSID-0007`? (Only the product format was given.)
- B. **Term options** (Q12): 6 months, 1 year and 3 years, correct?
- C. **Promo cap vs prepaid term**: the promo discount lasts at most 12 months, but a customer can prepay 3 years. Does the discount apply only to the first 12 months of the prepaid term (rest at list price), or can a 3-year prepaid plan be charged as one discounted price? (Rec: discount applies only to the first 12 months.)
- D. **Q13 wording**: "upgrade or choose a plan" means the owner picks a paid plan (Starter/Growth/Pro) and pays; the store stays suspended (storefront shows a maintenance-style screen, admin stays reachable for billing only) until paid. Correct?
- E. **Q8 scope**: besides default navigation and seeded links, should the storefront homepage sections and product-grid blocks also default to categories (with collections still selectable)? (Rec: yes.)

---

## 3. Questions for the owner (original list, answered above)

Decisions that block or shape work. Where I have a recommendation it is marked **(rec)**.

**Deletion and data (SA-01)**
1. Today's workflow purges all store data automatically after a grace period (default 7 days). You asked for a manual "delete permanently" button that appears 30 days after deletion, for the Super Admin only. Should I (a) keep the automatic purge but change the default grace to 30 days and add "Purge now" for the platform owner after that, or (b) make the purge fully manual: deleted stores keep their data for 30 days, then the platform owner presses "Purge now"? **(rec: b, since you asked for a button)**.
2. Removing the last tenant row would delete invoices (8-year retention) through the foreign key. Keep a minimal "tombstone" row for every deleted store and hide deleted stores from the list by default with a "Show deleted" filter? **(rec: yes)**. Or do you want the row gone completely (needs a separate invoice archive first)?
3. "Super Admin" = the `platform_owner` role only (top role)? **(rec: yes)**.

**Navigation (N-02)**
4. Should new stores still be created with default Main/Footer menus (now deletable), or start with none? **(rec: keep seeding, but deletable and never re-created automatically)**.

**Friendly IDs (PR-02, SA-02)**
5. Format: product number per store like `#1042` (sequence per store), or short code like `PRD-1042`? Same style for stores, e.g. `ST-0007`? **(rec: per-store sequence shown as `#1042`; stores `ST-0007`)**. Existing items get numbers in creation order.

**Sidebar (SA-08)**
6. The hover behaviour is shared. Remove it for both apps? **(rec: yes, both, keep tooltip flyouts in collapsed mode)**.

**Payments (P-02)**
7. Is the new "Online payment gateways" flow meant to replace the existing section at the bottom of the page? **(rec: yes)**. Razorpay stays test-mode only (rule 14).

**Categories vs collections (C-01)**
8. Do your stores need a nested category tree (Teas > Green Teas)? And should the main navigation follow categories? **(rec: keep both, categories = permanent tree and nav, collections = campaigns/homepage sections)**.

**Blog URLs (B-01)**
9. Keep flat `/blog/<slug>` and add breadcrumbs with structured data **(rec)**, or move to `/blog/<category>/<slug>` (needs a new ADR, redirects, sitemap work)?

**Flags (SA-06)**
10. Which flags are permanent kill switches (keep) and which are release flags (retire-able)? **(rec: keep checkout, catalog, fulfillment as kill switches; the settings.* flags are retire-able)**. Can a retired flag be restored by the platform owner? **(rec: yes)**.

**Audit log (SA-07)**
11. Replace bulk delete with archive and export, with a retention purge only for the platform owner? **(rec: yes; audit rows are never hard-deleted from the UI)**.

**Promotions and free stores (SA-05)**
12. Billing during a discount: monthly, yearly, or prepaid for the whole term? 13. At the end of a free year: auto-charge, downgrade to a limited tier, or suspend? 14. GST on free and discounted periods (accountant to confirm). 15. Upgrade during a promo: keep the promo or end it? 16. Who can grant promos: any staff, or `platform_owner` only? **(rec: platform_owner and platform_admin grant, logged)**. 17. Cap on promo length (suggest up to 36 months)?

**Shipping (S-01)**
18. This is store-level rate configuration, no courier or Shiprocket work (rule 14). Confirm. 19. Which rate types in the first release: flat, price tiers, weight tiers, free above threshold? Zones by country only, or by Indian state and PIN ranges? **(rec: state and PIN ranges, all four rate types)**.

**Custom fields (F-03)**
20. First-release types and limits (text, rich text, image, dropdown, multi-select; products first, collections in phase 3)? Is filtering the storefront by a custom field wanted soon? Should plan tiers limit the number of fields?

**Variants (PR-06)**
21. Maximum options per product (Shopify uses 3) and maximum variants (Shopify 2,000)? **(rec: 3 options, 250 variants for v1)**.

**Policies (PO-01)**
22. Existing policies are block-based. Convert them into rich text on first open, or keep old drafts read-only until re-saved? **(rec: auto-convert on open; keep the old published versions untouched)**.

---

## 4. Security and quality rules that apply to every phase

Derived from `AGENTS.md` section 2 and best practice:

- **Server-side enforcement, never UI-only.** Every hidden button (purge, delete menu, retire flag, grant promo) is also checked in the domain service with `assertPermission` or `assertRoleAtLeast`.
- **Tenant isolation.** New tenant tables use `tenantTable()` + `forceRlsSql()` + `tenantForeignKey`; platform-wide tables (flags, promotions, audit) stay platform-only. Add every new `admin.*` procedure to `packages/domain/test/isolation.int.test.ts`.
- **Audit.** Every platform mutation writes `platform_audit_logs`; store settings, money, access and content changes write `audit_logs`. Destructive actions get a typed confirmation and a `ConfirmDialog` (no `window.confirm`).
- **Secrets.** No keys in code, logs or responses; gateway credentials stay encrypted and shown as set/not-set. Copying the webhook URL never includes secrets.
- **Safe content.** Rich text (policies, custom fields) is sanitised through the same pipeline as the blog (ADR-033/ADR-010); no raw HTML or merchant code. Image values must belong to the same tenant.
- **Money.** Prices, shipping and promotion amounts are computed on the server and never trusted from the client; amounts in paise.
- **Migrations.** Append-only, expand/migrate/contract, backfills idempotent, no drop or rename in the same release.
- **Password UI.** The show/hide toggle must not log or store the value, must be a `type="button"`, keyboard accessible, with `aria-label` and `aria-pressed`; keep `autocomplete` attributes correct.
- **Cache.** Invalidate only after commit via `cache-invalidation.ts`, tenant-prefixed tags.
- **Side effects after commit via pg-boss** (purges, expiry warnings, promo conversions).
- **UI standards.** `docs/admin-ui-standards.md`: shared kit, no native `<select>`, tokenised borders, drawers about 40% wide, `pendingComponent` on admin routes, `loading.tsx` for storefront pages.
- **Tests.** Real-database tests for tenancy, permissions, money and deletion; update e2e selectors when labels change. Gate per phase: `pnpm typecheck`, `lint`, `build`, `docs:check`, affected tests, and `test:heavy` where the domain changed. Use the app in a browser for UI changes and say plainly what was not exercised.

---

## 5. Build plan (step by step)

Each phase is its own branch and PR, verified by the gate before the next starts. Parallel work only on disjoint files. Each phase writes a change record in `docs/changes/` and updates `progress.md`.

### Phase 0: Decisions
Owner answers section 3. I then fix the open points in this file and in the log.

### Phase 1: Bugs and quick fixes (small, low risk)
1. **N-01/N-02 menus.** (a) Normalise legacy menu items on read in `getMenu` (add `id`, infer `type` from the URL, keep `children`); (b) fix the seed in `provisioning.ts` to emit full items; (c) one-time idempotent repair of existing menus (data migration or admin-safe script, owner approves running it on production); (d) allow deleting default menus (remove `isProtected` block in `deleteMenu` and the UI), stop `ensureDefaultMenus` from resurrecting deleted defaults, warn in the confirm dialog if the menu is in use; (e) make the storefront header/footer render gracefully when no menu is assigned and let the user assign a new menu to the Header/Footer slot. Tests: real-DB for delete and no-resurrect, storefront test for missing menu, editor test for legacy items. Reproduce the blank screen first and record the actual error.
2. **A-01/A-02 auth forms.** New shared `PasswordInput` in `@bs/ui` and replace the 14 raw password inputs; add a shared auth field wrapper (or fix `AuthShell` spacing) so label-to-input gap is consistent in admin, Super Admin and storefront auth.
3. **Shared drawer.** One change in the shared sheet/drawer for width (about 40% on desktop, full width on mobile, padding, tokenised borders) fixes **P-03** and **PG-02** together.
4. **V-01** Store visibility cards as single rows (title left, description right; wrap on mobile).
5. **PR-01, PR-03, PR-05** product page: remove breadcrumbs (title only), status as a `SimpleSelect`, category labels as plain names (nested as "Parent > Child").
6. **PG-01** pages table checkboxes and bulk actions via the shared data-table kit (Home not deletable).
7. **SA-03, SA-04** tenant detail: Suspend/Delete (and Archive) in a "More" menu; replace the white tab border with `border-border`.
8. **SA-08** remove hover-open from `packages/ui/src/layout/sidebar.tsx` (per answer 6), update e2e selectors.

### Phase 2: Medium features
9. **PR-02 / SA-02 friendly IDs.** Per-store counter table (atomic increment) + `products.number`, platform sequence + `tenants.store_number`; expand-only migration, backfill in creation order, unique per tenant; UI shows the short ID with a copy button, UUID kept in a "details" section.
10. **PR-04 media lightbox.** Click an image to open a dialog with prev/next, keyboard arrows, counter; does not conflict with drag reorder.
11. **P-01/P-02/P-04 payments.** Remove placeholder cards; two catalogue cards (Manual, Online gateways); pick a gateway, add it, Configure opens the drawer; fill the webhook URL with the store's primary domain; verify the real path end to end in test mode only: save keys (encrypted), test connection, activate, webhook signature, and what checkout does when online checkout is off.
12. **F-01 domains.** Pre-add guide card (which records, where to add them, how long it takes, copy buttons); after adding, show records at once; "Check status" button plus gentle auto-refresh while pending; clear Active / SSL active states. Uses the existing verify service.
13. **PO-01 rich text policies.** One editor per tab, saved into a validated JSON document (reuse the blog/editor pipeline), auto-convert existing blocks on open, versions and Preview unchanged; tests for sanitisation and legacy conversion.
14. **SA-06 flags.** Migration adding `kind` (release / kill_switch), `description`, `retired_at`; "Retire" action with confirm and audit; "Show retired" filter; protected kill switches cannot be retired; list grouped by type.
15. **SA-07 audit log.** Server-side pagination (cursor), filters (actor, action, tenant, date range), sort, row checkboxes, bulk export, row-click detail drawer (diff, IP, user agent, request id, copy as JSON with redaction). Archive column and retention purge only if answer 11 says so (append-only otherwise).
16. **SA-01 purge.** Per answers 1 to 3: show "Delete permanently" 30 days after deletion for `platform_owner` only, enforced in the domain service; typed confirmation; export first; job via pg-boss; keep the tombstone and invoices; default "Show deleted" filter off.
17. **C-01 categories/collections.** Per answer 8: wire categories into default navigation and category-first grids where chosen, add one-line explanations in admin, no data model change unless you choose collections-only. Small ADR if the model changes.
18. **B-01 blog URLs.** Per answer 9: breadcrumbs plus BreadcrumbList structured data on posts; URL change only if chosen (new ADR, 308 redirects, sitemap, tests).

### Phase 3: Large features (each needs its own `docs/*-PLAN.md`, ADR and phased PRs)
19. **PR-06 variant builder** (after answer 21). Phases: (a) options editor + generated variant matrix using the existing `product_options` and `variants` columns, (b) per-variant drawer for SKU, price, compare-at, cost, weight, barcode, dimensions, image, inventory flags, pre-order, (c) bulk edit table, (d) storefront selector check. Mostly no migration. Required before weight-based shipping.
20. **S-01 shipping** (after answers 18, 19, and after PR-06 weight data). Phases: (a) regions per zone (states/PIN ranges) + multiple zones UI, (b) rate tiers table (price and weight tiers) with a one-time migration of today's two flat rates into a default zone, (c) server-side calculation extension in `orders/shipping-rates.ts` and the calculator, (d) checkout verification. No courier integration.
21. **SA-05 promotions, trials and free years** (after answers 12 to 17). Phases: (a) pricing phases on subscriptions + promotions table (platform-only, no RLS), (b) billing calculation and invoice lines (GST net amounts), (c) free/comped grant with end-of-term job and warnings at 30 and 7 days, (d) Super Admin promotions UI and tenant Billing tab, (e) promo code at signup. Billing stays in test/disabled provider mode (ADR-014, rule 14).
22. **F-03 custom fields** (after answer 20). Phases: (a) definitions + values tables, contracts, domain, admin settings page and product card, (b) theme builder "Custom field" binding and storefront rendering (needs a research step in `packages/blocks`; block version bump per ADR-009), (c) collections and extra types, (d) import/export and storefront filtering.

### Suggested order
Phase 0, then Phase 1 (one PR per numbered group 1 to 8, or two PRs), then Phase 2 in the order 9, 11, 12, 14, 15, 16, 13, 10, 17, 18, then Phase 3 in the order 19, 20, 22, 21 (promotions last because billing is not live yet).

## 6. Verification and hand-off
- Per phase: acceptance criteria are the numbered steps above plus the section 4 rules. Claude verifies against the criteria and runs the gate (`pnpm typecheck`, `lint`, `build`, `docs:check`, `test:affected`, domain `test:heavy` where relevant) before the next phase.
- UI phases: run the admin and Super Admin dev apps, check dark and light theme, 375 px and desktop; state what was and was not exercised.
- Docs to update when building: `docs/ARCHITECTURE.md` (tables, routes, jobs, flags), `docs/migrations.md` notes, `progress.md` in-flight line, and a change record per phase.
- Production data actions (menu repair, purge) need the owner's explicit yes in the session.
