# Settings: Orders and Returns

Hand-off plan for Antigravity. Verifier: Claude. Read [ORDERS-SECTIONS-OVERVIEW.md](ORDERS-SECTIONS-OVERVIEW.md) first, **including its section 4 (look and feel), which is mandatory for every screen here.**

## 0. Goal

Give the store admin one place in **Settings** to customise how orders behave: numbering, processing rules, customer notifications, abandoned-checkout recovery, pre-order wording, and the returns and exchanges rules. Storify has an "Order Settings" page (prefix, tax rate, default shipping cost, free-shipping threshold, commission, withdrawal minimum, and a returns block with window, delivery refund, restocking fee, shipping fee, admin fee and cap). We use it as inspiration, **not as a copy**: bsec is single-seller, India GST, with shipping and tax already configured elsewhere.

## 1. What Storify's settings contain, and what we do with each

| Storify setting | Decision for bsec |
|---|---|
| Order number prefix | **Keep**, and **make it actually work** (see 2.1: today it is ignored). Add start number, digits and a live preview. |
| Tax rate (%) | **Do not add.** bsec is GST per product HSN and place of supply, configured in **Settings > Taxes**. A store-wide flat rate would bypass GST. |
| Default shipping cost, free shipping threshold | **Do not duplicate.** They already live in **Settings > Shipping** (standard and express rate, free delivery above a subtotal). Link to it. |
| Commission rate, minimum withdrawal | **Not applicable** (marketplace and vendor features; bsec stores are single-seller). |
| Return window (days) | **Keep**, as part of Settings > Returns (default 7 days). |
| Refund delivery on a return (never, our fault, always) | **Drop.** Refunds are manual (see the Returns plan); describe who pays return shipping in the policy text. |
| Restocking fee, return shipping fee, refund admin fee and cap | **Drop** for now (manual refunds; revisit with online payments). |

## 2. What bsec has (verified)

- Settings workspace: each section is its own route under `apps/admin/src/routes/_store/settings/`, listed in `components/settings/settings-nav.ts` (`SETTINGS_NAV`: General, Storefront, Branding, Shipping, Payments, Taxes, Team, Support access). Pages use `SettingsPageFrame`, `SettingsSection`, `HeaderActions`, `useUnsavedGuard` from `components/settings/settings-page.tsx`.
- `store_settings` (`packages/db/src/schema/settings.ts`): `order_prefix` column (default `#`), `checkout` jsonb (COD enabled and fee, tax mode), `notifications` jsonb (unused so far), `currency`, `timezone`.
- Per-store config pattern: `parseStoreConfig` in `packages/domain/src/admin/store-config.ts` reads jsonb with **defaults equal to the behaviour stores had before the option existed**, so existing stores do not change.
- Order numbers: `allocateSequenceNumber` (`orders/sequences.ts`) over `number_sequences` (`kind`, `prefix`, `next_value`, `padding`), gapless per tenant.
- Stock reservation for checkout holds for **30 minutes** by default (`inventory-reservations.ts`, `ttlMinutes`).
- Settings > General already shows "Order number prefix" with the hint "For example # or ORD-."

### 2.1 Defects found

| # | Finding |
|---|---|
| S1 | **The Order number prefix in Settings > General does nothing for orders.** `orders/checkout.ts` and `createAdminDraftOrder` pass a hard-coded `defaultPrefix: "ORD-"` and 5 digits to `allocateSequenceNumber`, and `store_settings.order_prefix` is never read there. A store that sets `#MYS-` still gets `ORD-00001`. (Provisioning writes `#ABC-` from the slug into `order_prefix`, which makes the mismatch visible.) |
| S2 | `allocateSequenceNumber` only uses the prefix and padding passed on the first insert; later changes to the setting would not apply unless the sequence row is updated. |
| S3 | `store_settings.notifications` exists but no code reads it, so there is nowhere yet to turn a customer email on or off. |

## 3. Navigation

Add two items to `SETTINGS_NAV` (permission `settings.write`, icons from `lucide-react`):

- **Orders** (`/settings/orders`): "Numbering, processing, emails, recovery".
- **Returns** (`/settings/returns`): "Returns and exchanges".

Keep the Order number prefix field in General **removed or read-only with a link** to Orders so there is one place to change it (do not leave two editors for one value). Each route needs `pendingComponent`.

## 4. Settings > Orders

All values load and save through one contract pair (`admin.orderSettings.get` and `update`), validated with Zod, `assertPermission(ctx, "settings.write")`, audited with a before and after diff (no secrets involved). Money is stored in paise and entered in rupees.

### 4.1 Section: Order numbers

| Field | Rule |
|---|---|
| **Prefix** | 0 to 10 characters from `A-Z a-z 0-9 # - _ /`. Default today: keep whatever `order_prefix` holds. |
| **Digits** | 3 to 8 (zero padding). Default 5. |
| **Next order number** | A number. It may only be **raised**, never set at or below the highest number already issued (orders must stay unique and gapless). Shown with the current next value. |
| **Preview** | Live: "Your next order will be `ORD-00042`." Computed from the three fields. |

Behaviour: saving updates the `number_sequences` row for `kind = 'order'` (prefix, padding, and `next_value` when raised) in one transaction. **Existing orders are never renumbered.** The checkout path and the admin create-order path both read the prefix and digits from here (fixes S1 and S2); remove the hard-coded `ORD-`. A new store starts with the value provisioning already wrote. Add a test that a changed prefix applies to the very next order, and that lowering the number is refused.

Invoices keep their financial-year series (`INV-FY-...`) and are **not** configurable here: GST requires a consecutive unique series.

### 4.2 Section: Order processing

| Setting | Default | Notes |
|---|---|---|
| **Hold stock during checkout (minutes)** | 30 | 5 to 120. Replaces the hard-coded `ttlMinutes`. |
| **Minimum order value (Rs)** | 0 (none) | Server-enforced at checkout; the cart shows the shortfall. |
| **Mark shipped orders delivered automatically after (days)** | Off | For stores with no courier integration. 1 to 30 days after `shipped`; a daily job; audited as the system actor. |
| **Cancel unconfirmed COD orders after (days)** | Off | Only if the store uses the COD confirmation link. Releases stock through the existing cancel path. Verify the COD confirmation flow (`orders/actions.ts`, `confirmCodOrder`) before exposing this. |
| **Cancel unpaid online orders after (hours)** | Hidden | Online payment is not live; add the field when it is. |

Show only settings whose behaviour exists. **A setting with no effect is a bug** (that is exactly S1). Each setting ships with its enforcement and a test.

### 4.3 Section: Customer emails

One switch per event, backed by `store_settings.notifications` (fixes S3): **Order confirmation**, **Order shipped**, **Order delivered**, **Order cancelled**, **Refund recorded**, **Return status updates**. Defaults on. A note at the top: "Email delivery goes live with the platform email service; these switches take effect from then." Also **Alert me about new orders** (switch) and **Alert email** (defaults to the support email) for the store's own notification. Each job checks the setting before sending.

### 4.4 Section: Abandoned checkout recovery (from the Abandoned checkouts plan)

**Detect abandoned checkouts after (minutes)** (default 60), **Send recovery emails** (default off), and the **schedule** of up to three reminders (delays in hours, defaults 1, 24, 72, shown as three rows with an on/off switch each). Disabled with the reason "Email delivery is not enabled yet" until the platform email service is live. Disabled rungs are not scheduled.

### 4.5 Section: Pre-orders (from the Pre-orders plan)

**Show "Ships soon" when a date has passed** (default on), **Remind customers before the ship date (days)** (default 2; 0 turns it off), **Notify customers when the date changes** (default on), and the default **message** shown on pre-order products (max 200 characters). Product-level date and message override these.

### 4.6 Links, not duplicates

A short "Related settings" card: **Shipping rates** and **Free delivery** (Settings > Shipping), **Cash on delivery** and fee (Settings > Payments), **GST** (Settings > Taxes). Link text only; no fields.

## 5. Settings > Returns and exchanges

Exactly the settings in the Returns plan, section 3.1: Accept return requests, Allow exchanges, Return window (days, default 7), Window starts at delivery, Reasons (editable list, max 12), Photos required per reason (required, optional, not asked), Instructions for the customer after approval, Policy text shown on the request form. Each saves through `admin.returnSettings.get` and `update`, audited, `settings.write`. The portal and the server both read these values; there are no constants left in `manual-lifecycle.ts` (`RETURN_WINDOW_DAYS` goes away).

## 6. Data

Expand migration only (`docs/migrations.md`):

- `store_settings.order_settings jsonb` and `store_settings.return_settings jsonb`, both nullable; a versioned shape (`{ "v": 1, ... }`); parsed by `parseOrderSettings` and `parseReturnSettings` next to `parseStoreConfig`, **defaults equal to today's behaviour** (hold 30 minutes, no minimum, no automations, emails on, returns window 7 days). A store with no row behaves exactly as now.
- `notifications` jsonb is reused for the email switches (do not add a new column for them).
- Sequence changes use the existing `number_sequences` row; no new table.
- Read settings once per request inside the existing `withTenant` transaction; if they are ever cached, use `tenantTag(ctx, ...)` and invalidate through `cache-invalidation.ts` (rule 5).

## 7. Build order

1. Domain: `parseOrderSettings`, the contract, get and update with audit; wire the **prefix, digits and next number** into `checkout.ts` and `createAdminDraftOrder` (fixes S1, S2). Smallest change, highest value.
2. `/settings/orders` UI with the Order numbers and Order processing sections; hold time and minimum order value enforced.
3. Customer emails switches and the checks in the jobs.
4. `/settings/returns` UI after the Returns plan's data migration.
5. Abandoned checkout and Pre-order sections when their features ship (each plan lists the exact fields).
6. Automations (auto-deliver, cancel unconfirmed COD) with their daily jobs.

## 8. Acceptance criteria

- [ ] Settings > Orders and Settings > Returns exist in the settings navigation, load with `pendingComponent`, and are visible only with `settings.write`.
- [ ] Changing the order prefix, digits or next number changes the **next** order's number from both checkout and admin create-order; existing orders keep their numbers; lowering the next number below the highest issued is refused; two concurrent orders never share a number (concurrency test).
- [ ] The hard-coded `ORD-` and `5` are gone from `checkout.ts` and `createAdminDraftOrder`; the old prefix field in General is removed or read-only with a link.
- [ ] Every setting shown has enforced behaviour and a test; no placeholder switches. Unsupported ones are absent or disabled with a stated reason.
- [ ] With no saved settings, behaviour is identical to today (test: a store with a null `order_settings` produces the same order number, hold time and return window as before).
- [ ] Money fields are entered in rupees and stored in paise; validation matches section 4 and 5 ranges and returns field-level errors.
- [ ] Every save writes `audit_logs` with a before and after diff; permission refusal tested; another tenant's settings are never readable (RLS test).
- [ ] The look and feel follows overview section 4 (shared settings frame, shadcn base-mira components, 12px body type scale, `SimpleSelect`, `ConfirmDialog` where needed, unsaved-changes guard).
- [ ] Gate passes; change record and `ARCHITECTURE.md` updated; UI exercised by hand and reported honestly.
