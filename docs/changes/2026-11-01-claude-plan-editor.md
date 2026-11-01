# Super Admin plan editor, invoices and transactions page, saved plan copy on signup and billing

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `feat/plan-editor` (merged in #184, 3bf4711)
- **Area:** db, contracts, domain, platform, superadmin, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
The owner can now edit, from Super Admin, everything a merchant sees about a plan: prices (INR and USD, monthly and yearly), the customer-facing copy (tagline, audience, badge, card line items), the enforced limits and the long comparison table. Signup and Plan and billing render whatever is saved. Invoices moved off the Plans page into a new Invoices and transactions page that also lists payments taking place in merchants' stores. Strategy and numbers: `docs/PLANS-AND-PRICING-STRATEGY.md`.

## What changed
- **Plans page** (`apps/superadmin/src/pages/Plans.tsx`, `pages/plans/`): cards laid out like the merchant view, an edit dialog per plan, and an editable compare table below. Only platform admins can edit.
- **Limits are enforced from the same place they are edited.** Saving a plan's limits writes the plan's size tier (`quota_tier_limits`, via `updatePlatformQuotaLimits`, so the Quotas page and enforcement agree) and mirrors them into `plans.limits`. `max_extra_markets` is read from `plans.limits`. Lowering a limit never removes what a store already has.
- **Card lines and compare rows can link to a limit** (`packages/contracts/src/plan-content.ts`): the text uses `{value}` and the renderer prints the enforced number, so the screen cannot drift from the quota.
- **Public side:** `listPublicPlans` now returns tagline, badge, rendered bullets and the enforced limits; `GET /api/saas/plan-compare` and the admin `planAndBilling.compare` return the grouped table. The signup page shows tagline, badge and bullets and a "Compare all features" section; Plan and billing replaces its hard-coded feature list with the plan's bullets and a compare dialog.
- **Invoices and transactions page** (`/ledger`, `pages/Ledger.tsx`): platform invoices (moved) and store transactions across tenants (`packages/domain/src/platform/ledger.ts`, read-only, filters by store or order number, status and method).
- New platform procedures: `plans.editor`, `plans.updatePlan`, `plans.saveCompare`, `ledger.storeTransactions`; new admin procedure `planAndBilling.compare`.
- Migration `0092_plan_editor`: plans gain `tagline`, `audience`, `badge`, `card_bullets`; new table `plan_compare_rows`; seed copy for the three plans and about 40 compare rows (including "Coming soon" rows). Prices and limits are NOT changed by the migration.

## Decisions and trade-offs
- Prices and limit values are left as they are in the database; the owner sets the new ones (₹999 / ₹4,999 / ₹9,999, products 1,000 / 5,000 / 10,000, variants 3,000 / 15,000 / 30,000, emails 2,000 / 6,000 / 25,000, no order cap shown) in the editor. This avoids a surprise change to the live plan prices (two stores pay Growth today) and to live Razorpay plans.
- A price change returns `priceChanged` so the editor says to sync the gateway plans; gateway plans are immutable and existing subscribers keep their amount.
- Limit edits are refused for a plan without its own size tier, since they would otherwise change a shared tier.
- `updatePlan` edits the tier limits and then the plan row in separate transactions (the quota function owns its transaction). A failure between them leaves the new limits and old copy; both writes are audited.

## Verification
- Ran: `pnpm typecheck` (16 tasks pass), `pnpm lint` (0 errors), `pnpm build` (6 tasks pass), `pnpm docs:check` ok; real-database `plan-editor.int.test.ts` (6 pass); `isolation.int.test.ts` (1712 pass); platform `audit-coverage`, `rbac`, `read-endpoints` (125 pass); admin `settings-shell` (13 pass); web unit tests (237 pass). Migration 0092 applied to the dev database.
- NOT verified: the new screens have not been driven in a browser (the Super Admin login needs the dev staff password, which this session was not allowed to read); the signup compare section and the Plan and billing dialog were only type-checked; the e2e suite was not run (it only runs in CI on `main`; sidebar label "Plans & Billing" is now "Plans", and a new "Invoices & transactions" entry was added, so check `e2e/` selectors).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration 0092, tables, procedures, plan editor paragraph)
- [x] `docs/PLANS-AND-PRICING-STRATEGY.md`
- [ ] ADR: not needed (no new architectural rule; billing remains per ADR-014, 036, 037, 040)
- [x] `progress.md` in-flight line added and removed after merge

## Follow-ups and open questions
- Owner: enter the new prices and limits, then sync Razorpay plans; decide the Pro to Scale rename (the code stays `pro`).
- Variant limit semantics changed in the strategy (3,000 / 15,000 / 30,000); existing stores above a lowered limit are not cut.
- Email caps: only the number is editable; pausing campaign mail at 100% and the order-mail floor are not built.
- Intro pricing (₹10 for 3 months, $1 for 2 months), PayPal Subscriptions and add-ons are separate work (see the strategy doc, section 9).

## Definition of done
Gate passes except the browser check and the e2e selector update noted above. ARCHITECTURE.md updated.
