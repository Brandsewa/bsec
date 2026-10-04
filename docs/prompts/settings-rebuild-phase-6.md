# Store Admin Settings rebuild — Phase 6 builder prompt (shipping, delivery, taxes)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the builder for **Phase 6 only**. Claude verifies against section 11 before Phase 7; you never merge your own PR.

Read first, in order: `AGENTS.md` (**rule 12: money and shipping are per store; shipping rates are store configuration, never hardcoded; prices and totals are recomputed on the server**); `docs/SETTINGS-PHASES-3-8-HANDOFF.md` (owner decisions §1, standards §3); `docs/ARCHITECTURE.md`; newest `docs/changes/`; `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §7 and §10; `docs/SETTINGS-SCHEMA.md` §7; `docs/PLAN.html` §15 (GST V1 rules) if present; `docs/adr/020-settings-capability-families.md`; `docs/admin-ui-standards.md`; `docs/migrations.md`.

## 0. Gate and state
- **Phase 5 must be merged.** If not, stop and tell the owner.
- Own worktree `../bsec-settings-p6`, branch `feat/settings-rebuild-phase-6`; claim in `progress.md`.
- **Slices 6A-6D are unconditional. Slices 6E and 6F are GATED** (owner decision 7: default zones and rates only for V1): do not build them unless the owner writes an explicit go in your session. Specify nothing in code for them; deliver 6A-6D, report 6E/6F as "not started (gated)".
- **GST correctness work needs a chartered-accountant (CA) review before it is enabled in production.** Everything money-affecting in 6A ships behind the feature flag `settings.gst_v2` (ADR-011 mechanism) that **fails closed to today's behaviour**; Claude and the owner enable it per tenant after review. State this in the change record.

## 1. Objective
Evolve the simplified shipping and tax setup into reliable, explainable, server-owned calculations without hard-coded money rules and without pretending international tax support exists. India only: INR, GST. Do not label anything "Duties".

## 2. Audit (verified 2026-10-04; re-verify before relying on it)

| Area | Where | Today |
|---|---|---|
| Shipping model | `packages/db/src/schema/shipping.ts` (`shipping_zones`: name, `countries[]`, `is_default`; `shipping_rates`: zone, name, `method` standard/express, `rate_type` `flat`/`free_above_threshold`, `price_paise`, `threshold_paise`, `min_days`, `max_days`) | Single-zone simplified model. |
| Shipping calc | `packages/domain/src/orders/shipping-rates.ts` (`calculateRateFromRule`, `getTenantShippingRates`, `getAdminShippingSettings`, `updateAdminShippingSettings`), `/settings/shipping`, contract `admin.shipping.{get,update}` | Pure evaluation against the cart subtotal; the same function serves cart estimate and `placeOrder`. Gated `settings.write`. |
| Tax config | `store_settings.checkout.tax {gstin, sellerState, pricesIncludeTax}`, `/settings/taxes` saves it through the **generic `settings.update`** | GSTIN is stored as free text; no validation of format or checksum. |
| GST calc | `packages/domain/src/orders/invoices.ts` (`calculateGstLineItem`: inclusive/exclusive, CGST+SGST vs IGST, discount before tax, integer rounding), `generateInvoice` | The pure calculator is sound. |
| Product tax data | `products.hsn text`, `products.tax_class_id uuid` (**no `tax_classes` table exists: a dangling column**), `order_items.hsn`, `order_items.tax_rate_bps default 0` | Rate has no source of truth. |
| Storefront checkout | `packages/domain/src/orders/checkout.ts` | **Computes no tax at order time** and does not snapshot HSN or rate onto the order lines (0 stays 0). |
| Admin create order | `packages/domain/src/admin/orders.ts` lines ~491, ~712, ~856 | `taxRateBps: 1800` **hard-coded**; origin/destination state fall back to **"Delhi"** when missing. |
| Invoices | `generateInvoice` | `taxRateBps: it.taxRateBps \|\| 1800` (**silent 18% default**); place-of-supply falls back to "Delhi". |
| Credit notes | `invoices.type` allows `credit_note`, sequence kind `credit_note`; `generateInvoice` accepts the type | **No caller creates a credit note**; recording a return refund issues none. |
| Invoice PDF | none | Known gap; out of scope. |

### Defects to fix first (each with a failing test first)
1. **Hard-coded 18%** in admin create-order (3 places) and the invoice fallback; rate must come from the product's tax class.
2. **Silent "Delhi"** place-of-supply fallback (orders and invoices): a missing seller state or destination state must raise a clear, field-level error ("Add your registered state in Settings > Taxes"), never guess.
3. **No tax snapshot at storefront checkout:** `placeOrder` must snapshot `hsn`, `tax_rate_bps` and the taxable/tax split on every `order_items` row so the invoice reproduces the order, even if the product's class changes later.
4. **Credit notes never issued** when a refund is recorded against an invoiced order (GST requires one).
5. GSTIN accepted without validation (format + checksum + state-code match).
All of 1-3 are behind `settings.gst_v2`; with the flag off, outputs are byte-identical to today (keep a parity test that locks today's numbers).

## 3. Slice 6A: GST correctness (flagged)

### Data (expand-only)
New tenant table `tax_classes` (`tenantTable()` + `forceRlsSql`):
```
id uuid pk default uuidv7(); tenant_id
name text not null check (char_length(name) between 1 and 60)
rate_bps integer not null check (rate_bps in (0, 250, 300, 500, 1200, 1800, 2800))   -- GST slabs; CHECK is the allow-list, widen by migration only
default_hsn text null check (default_hsn ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$')        -- 4, 6 or 8 digits
is_default boolean not null default false
created_at, updated_at timestamptz
unique (tenant_id, id); unique (tenant_id, name)
create unique index tax_classes_one_default on tax_classes (tenant_id) where is_default;
```
- Add the missing composite FK for `products.tax_class_id` → `tax_classes` using `tenantForeignKey` (`ON DELETE SET NULL`-equivalent: a class in use cannot be deleted: service guard) **after** a data check: the column is currently unused, so assert in the migration that no non-null values exist (fail loudly if any) rather than assuming.
- Seed per tenant lazily: when `settings.gst_v2` is on for a tenant and no class exists, the service creates a single **"Standard 18%"** default class (rate 1800) on first read, so behaviour equals today's default rate but is now visible and editable. Never auto-create other slabs.
- `order_items`: add `taxable_value_paise integer null`, `tax_paise integer null` (expand; snapshot for new orders; old rows stay null and are read through the existing calculator).

### Behaviour
- `resolveTaxClass(product)`: product class → store default class → error "no tax class" (never 1800 literal).
- One shared **tax engine** module `packages/domain/src/orders/tax-engine.ts` (pure, built on `calculateGstLineItem`) used by storefront `placeOrder`, `createAdminDraftOrder`/`estimateDraft`, and `generateInvoice`. No second implementation. Inputs: lines (unit price, quantity, discount share, class rate, HSN), `pricesIncludeTax`, seller state, destination state, shipping amount, shipping tax mode. Output: per-line taxable/CGST/SGST/IGST/total, shipping tax split, totals; **integer paise, per-line rounding half-up, invoice totals are sums of lines (no recompute)**.
- Place of supply (goods to a registered/unregistered consumer in India): destination state of the shipping address vs seller state; equal → CGST+SGST (half each; if odd paise, the extra paisa goes to CGST, documented), different → IGST. Seller state comes from `tax.sellerState`, else the GSTIN's state code, else the store address state; **if none, refuse** (defect 2). Destination state missing → refuse at checkout with a field error.
- Shipping tax: setting `shippingTax: "highest_line_rate" | "none"` (default `highest_line_rate`: the freight follows the highest GST rate among the order's goods, the conservative reading for a mixed supply). Flag this default for CA sign-off in the change record; it is configurable, never silent.
- Discounts reduce taxable value before tax (already true); apportion an order-level discount across lines by value with largest-remainder so the parts sum exactly.
- All computed server-side at checkout; the cart/checkout pages display the engine's result, never client math.

## 4. Slice 6B: Taxes settings (`/settings/taxes`, upgrade) (flagged where it changes calculations)
Contract `admin.taxSettings.{get,update}` plus `admin.taxClasses.{list,create,update,delete}`; permission `taxes.manage` in route **and** service (read `settings.read`); optimistic concurrency; audit with before/after; stale-write protection. The Phase 1 rule stands: GSTIN is **edited here and only here** (Store details links to it).
- Fields: `taxCollection` (on/off; **off means no GST lines at all**, for unregistered sellers below threshold; default on = today), `gstin` (nullable), `sellerState`, `pricesIncludeTax` (default true = today), `shippingTax`, default tax class; tax classes table CRUD with HSN. Money-affecting changes show a warning "applies to new orders only; existing orders and invoices are never recalculated".
- **GSTIN validation** (`validateGstin`, pure, unit-tested): 15 characters `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, valid **state code** (official list of GST state/UT codes), and the **check character** (mod-36 weighted checksum over the first 14 characters). On save: derive the state from the code and require it to equal `sellerState` (or set `sellerState` from it with confirmation). A GSTIN that fails is rejected with a field error. The platform does not call the government GSTN API.
- Product editor: tax class select and HSN field (Catalog UI, minimal change: reuse existing product form patterns; HSN falls back to the class default). **Do not redesign the product editor.**
- Migrate `/settings/taxes` off the generic `settings.update` `tax` key the same way Phase 5 moved COD: new contract, dual-read for one release, `settings.update` stops accepting `tax` after the window. Document the contract step as a later release.

## 5. Slice 6C: Shipping (default zone and rates, always)
Keep and test what exists; make it explainable; move permission to its family.
- Move `shipping.get/update` to `shipping.manage` (route + service; read `settings.read`); audit rows for changes (none exist today: verify and add); stale-write protection.
- **Admin preview** (`admin.shipping.preview`): input destination state/pincode (optional) and a cart subtotal (and, when 6E exists, product lines); output the exact rate list the checkout would offer with a **trace** ("Zone: Default; Rate: Standard flat ₹70; free above ₹1200 not reached"). The preview calls the same `getTenantShippingRates` code path as checkout (one implementation).
- Validation: money in rupees entered, stored in paise; free-shipping threshold ≥ 0; at least one active rate while the store is `live` (refuse a state that leaves checkout with no shipping choice, or show a blocking warning if the store legitimately sells only non-shippable products: check `requires_shipping`); delivery estimates `1 ≤ min ≤ max ≤ 60`.
- `placeOrder` already refuses an unavailable method and recomputes the amount: add tests that a client-supplied shipping total or method id is ignored.

## 6. Slice 6D: Credit notes on refunds (flagged, CA review)
When a return refund is **recorded** (`returns` → refund method/amount/`refundedAt`) for an order that has an issued invoice, issue a **credit note** in the same transaction path (reuse `generateInvoice` with `type: "credit_note"` and the original invoice reference): negative-signed lines for the returned items (partial returns proportionally; shipping refunded only if recorded), same place of supply, same rates **from the original invoice snapshot** (never today's class), its own gapless series (`CN-FY-…`, sequence kind `credit_note`, financial year rolled like invoices), linked to the original invoice id and the return id, immutable once issued, audited. Idempotent: recording the same refund twice yields one credit note (unique `(tenant_id, return_id)` where type = credit note; add the partial unique index in the migration). Orders without an invoice get none (nothing to credit). Show it on the order timeline and Returns detail. PDF generation stays out of scope.

## 7. Slice 6E (GATED): shipping profiles, zone coverage, rate types, conditions
Specified for the owner's later go; do not build now. Entities per SETTINGS-SCHEMA §7.1 (`shipping_profiles`, `shipping_profile_products`, `profile_id` on zones, `coverage jsonb`, rate `conditions jsonb`/`active`/`sort_order`, new rate types `flat_order`, `per_item`, `weight_tier`, `percentage` (basis points of eligible goods subtotal), `free`). Deterministic matching order **when built**: profile (explicit non-default else default) → zone (pincode exact > pincode range/prefix > state > country > default zone; ties by `sort_order` then id) → eligible rates by conditions (min/max order value, weight from `variants.weight_grams`, item count) → sorted by amount then `sort_order`; the admin preview explains every step. Pincode patterns: 6 digits, exact (`560001`), prefix (`5600*`), range (`560001-560103`); overlapping patterns inside a zone are rejected at save; the same pincode in two zones is allowed only with different `sort_order`. Integer math only; percentage rounds half-up. Migration must backfill each tenant's existing zone/rates into the default profile so behaviour is identical, and keep reading the old columns for a release.

## 8. Slice 6F (GATED): shipping classes and packages
`shipping_classes` and `shipping_packages` per SETTINGS-SCHEMA §7.1 (dimensions in mm, empty weight in g), optional, referenced by profiles later. No carrier, pickup, local delivery or Shiprocket work (AGENTS rule 14).

## 9. Tests
- **Unit:** `validateGstin` (valid samples, bad checksum, bad state code, lowercase, length), tax engine (inclusive/exclusive, intra/inter-state, odd-paisa split, discount apportionment sums exactly, shipping tax modes, multi-rate carts, zero-rate class, tax collection off), tax-class resolution, shipping calc and preview trace, credit-note line negation and proportional partial return.
- **Real Postgres:** each defect failing first; **flag-off parity** (today's order/invoice numbers byte-identical, including the 18% default and Delhi behaviour that the flag preserves); flag-on: class rate used, no 1800 literal, missing state refused, snapshot written and invoice reproduces it after the class changes; credit note issued once per refund (idempotent), gapless numbering, original rates used, none without an invoice; cross-tenant and permission (route + service) tests for every new procedure; `taxes.manage` and `shipping.manage` denial for an `analytics.read`-only role and a support session; stale-write conflicts; audit rows with no secrets; `placeOrder` ignores client shipping/tax values.
- **Isolation suite:** map every new `admin.*` procedure. **UI:** taxes page (GSTIN errors, warnings, classes), shipping page and preview, product tax-class field, order/return timeline credit-note entry. Update `e2e/` by prefix if `/settings/taxes` copy changed (an existing spec toggles tax settings: keep it green).

## 10. Do not build
Duties, VAT, reverse charge, multi-currency, markets, e-invoicing (IRN/QR) and e-way bills, GSTR filing exports, invoice PDF, carrier/pickup/local delivery, Shiprocket, 6E/6F without the owner's go.

## 11. Acceptance criteria
- [ ] Defects 1-5 fixed with failing-first tests; no `1800`/`"Delhi"` literal remains in tax paths (grep proves it).
- [ ] One tax engine; storefront checkout, admin create-order and invoice agree to the paisa for the same order (a cross-path test).
- [ ] All totals, rates and fees are recomputed server-side from server-owned config; the client cannot influence them; money is integer paise, rates integer basis points.
- [ ] `settings.gst_v2` off ⇒ identical to today; on ⇒ new behaviour; rollout and rollback documented; **CA review items listed** (shipping tax default, split rounding, credit-note timing, composite-vs-mixed supply) and the owner told they must be signed off before enabling in production.
- [ ] Tax and shipping settings enforced by `taxes.manage` / `shipping.manage` in route and service; ADR-020 enforcement section updated; stale writes rejected; audit rows without secrets.
- [ ] Credit notes: idempotent, immutable, gapless, original-rate, linked; none for uninvoiced orders.
- [ ] Migrations append-only, increasing journal, RLS forced, the dangling `tax_class_id` handled safely, backfills idempotent.
- [ ] Browser check at 375 px, tablet, desktop, light and dark, Owner/Manager/denied role. Gate: `typecheck`, `lint`, `build`, `docs:check`, fast suites, `@bs/domain` heavy (counts pasted).

## 12. Commit plan
1. `test(tax): lock today's GST numbers (flag-off parity)` 2. `feat(tax): tax_classes, tax engine, snapshot at checkout, remove hard-coded rate and Delhi fallback (flagged)` 3. `feat(tax): taxes settings, GSTIN validation, classes, product tax-class field` 4. `feat(shipping): shipping.manage, audit, preview with trace` 5. `feat(returns): credit notes on recorded refunds (flagged)` 6. `docs: ARCHITECTURE, ADR-020, CA review list, change record`.

## 13. Owner questions to raise (do not decide)
CA sign-off list above; whether to enable `settings.gst_v2` per store or globally; whether stores below the GST threshold should default to tax collection off at signup (not now); go/no-go for 6E and 6F.
