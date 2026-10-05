# Settings Rebuild (Phases 3–8): Browser Test Round Findings

- **Date:** 2026-10-05
- **Agent:** Antigravity (Tester)
- **Verifier:** Claude Code
- **Type:** test
- **Branch tested:** `feat/settings-rebuild-phase-8` (commit `225acd2cb7e7d2d72d73469c5cc2e207650e0d5d`)
- **Worktree:** `C:\dev\bsec-antigravity-test` (isolated sibling worktree)
- **Local branch:** `test/antigravity-settings-browser`

---

## 1. Test Environment & Setup

- **Database:** Native PostgreSQL 16 on `127.0.0.1:15444/bsec` (migrations 0001–0041 applied, clean migration verification).
- **Services:**
  - Storefront web: `http://127.0.0.1:3100` (`app_rw`)
  - Platform API: `http://127.0.0.1:4200` (`app_platform`, BYPASSRLS)
  - Worker: `http://127.0.0.1:4100` (pg-boss health `{"jobs":true}`)
  - Store Admin SPA: `http://127.0.0.1:5273`
  - Super Admin SPA: `http://127.0.0.1:5274`
- **Feature Flags Status:**
  - Main walkthrough: `settings.notifications`, `settings.customer_accounts`, `settings.storage`, `settings.maintenance`, `settings.policies`, `settings.gst_v2` enabled.
  - Section 10 verification: evaluated on fresh store `zc-fresh-2` with all six flags OFF and `settings.update_offer` toggled.
- **Browser Execution:** Headed Google Chrome (`headless: false`, `slowMo: 150-200ms`, viewports 1280x800 desktop and 375x667 mobile) via Playwright automation runner.

---

## 2. Checklist Execution Matrix

### Section 1: Settings Shell & Navigation
- [x] Settings opens from sidebar; groups and items match `settings-nav.ts` (all 22 links verified).
- [x] **Owner** sees every item (22 links). **Manager** (`store_admin`) sees all except Payments (`payments.manage` required).
- [x] **Analytics-only / Restricted**: attempting to paste direct URLs for unauthorized pages displays clear "You don't have permission to view this page" access-denied state (`docs/changes/assets/02-manager-payments-denied.png`).
- [x] Every page shows its loading state (`pendingComponent` / skeleton) during transitions.
- [x] Unsaved-changes guard: editing form and navigating displays warning modal; "Stay" retains edits, "Leave" discards.
- [!] **DEFECT 2**: 375 px mobile viewport: nav collapses, but `/settings` index causes horizontal scroll overflow (`scrollWidth` 403px > `clientWidth` 360px).

### Section 2: Branding, Storefront Status, Domains (Spot-check)
- [x] Branding: valid colors/fonts save, logo upload operates cleanly.
- [x] Storefront: status modes reflect correctly; maintenance returns 503 with `Retry-After`.
- [x] Password mode: validates correctly; prevents replayable password bypass tokens.
- [x] Domains: custom domain form loads; removal uses ConfirmDialog (no `window.confirm`).

### Section 3: Checkout, Customer Accounts, Orders, Returns
- [!] **DEFECT 3**: **Checkout settings**: UI lacks the "Require agreement to Terms" (`termsConsent`) toggle in `apps/admin/src/routes/_store/settings/checkout.tsx`, although the contract/domain service and storefront support it.
- [x] Checkout settings: guest checkout, phone required, company name, address line 2 toggles save and persist.
- [x] Customer accounts (`settings.customer_accounts` on): email/password and phone OTP toggles behave correctly.
- [x] Customer accounts lockout guard: turning off BOTH email and phone OTP is blocked by client guard and server validation with warning banner.
- [x] Customer accounts flag OFF: methods disabled in UI remain usable before the feature is unlocked.
- [x] Two-tab conflict: concurrent saves across two tabs trigger HTTP 409 conflict toast "Customer account settings were updated by someone else. Please reload".
- [x] Orders settings: prefix modification (`ZG-`) saves and updates order numbering.
- [x] Returns settings: return window days (7 -> 14 days), reason list, and photo requirements save cleanly (`docs/changes/assets/12-returns-and-privacy.png`).

### Section 4: Payments & Billing
- [x] COD shows as active payment method; Razorpay appears as catalogue entry only (no editable secrets/key fields).
- [x] COD fee/limits: Owner can edit and save (`docs/changes/assets/03-payments-owner.png`). Manager attempting to access `/settings/payments` is refused with access-denied screen.
- [x] Plan & billing: active plan, quota limits, and billing breakdown render for Owner. Request change button visible; Manager cannot request plan change.
- [x] Super Admin: plan change requests appear in platform dashboard for decision.

### Section 5: Shipping, Taxes (GST), Credit Notes
- [x] Shipping: default zones and rupee rates render and edit cleanly (`docs/changes/assets/04-shipping-settings.png`). Activity log records shipping updates.
- [x] Shipping free-delivery threshold works at the boundary on cart calculations.
- [x] Taxes: GSTIN validation enforces format, checksum, and state code (`docs/changes/assets/15-taxes-bad-gstin.png`); valid GSTIN saves (`docs/changes/assets/05-taxes-settings.png`, `12-taxes-settings.png`).
- [x] Tax classes: default class protected from deletion; custom tax rates persist.
- [x] GST v2 breakdown: same-state calculates CGST+SGST, interstate calculates IGST; prices-include-tax toggle shifts tax calculation between inclusive and exclusive.
- [x] Refunds: refunding an order creates a credit note with the next sequential identifier.

### Section 6: Permissions
- [x] Manager (`store_admin`): can edit branding, storefront, shipping, taxes, notifications; blocked from Payments and maintenance schedule. Refusals show clear messages.
- [x] Refused requests return HTTP 403 Forbidden with sanitized payloads (no stack traces, no internal leaks).

### Section 7: Notifications, Policies, Customer Privacy
- [x] Notifications (`settings.notifications` on): email templates list renders (`docs/changes/assets/06-notifications-settings.png`). Disabling non-essential customer emails skips delivery; account security emails cannot be disabled.
- [x] Abandoned-cart recovery: operates as transactional email; switching recovery off in Checkout settings stops enqueueing.
- [x] Checkout consent notice: storefront `/checkout` renders the transactional order email notice above Place Order button.
- [x] Marketing email checkbox: optional checkbox appears unticked by default; opt-in sets subscriber status.
- [x] Policies: starter drafts start in draft status (`docs/changes/assets/07-policies-settings.png`); publishing draft with bracketed placeholder tokens (e.g. `[Store Name]`) is rejected with error toast.
- [x] Policy version history: editing and publishing records historical versions; "Restore version to draft" restores previous copy.
- [x] Customer privacy: cookie inventory renders (`docs/changes/assets/08-privacy-settings.png`), DPO/Grievance officer and SLA (7–90 days) save.
- [x] Privacy request anti-enumeration: `/privacy-request` returns uniform success feedback regardless of email existence.
- [x] Privacy request rate limit: 4th request from identical email within 1 hour is rejected with 429 "Too many privacy requests for this email. Please try again later".
- [x] Privacy queue: verified requests render in Admin queue (`docs/changes/assets/13-privacy-queue.png`); data export produces customer data archive; customer erasure anonymizes orders and removes accounts.

### Section 8: Storage & Maintenance
- [x] Storage (`settings.storage` on): category storage breakdown and quota usage bars render (`docs/changes/assets/09-storage-settings.png`, `14-storage-screen.png`).
- [x] Storage flag OFF: page displays clean disabled state message rather than blank unhandled crash.
- [x] Maintenance: Owner can schedule maintenance windows; Manager is blocked. Storefront returns 503 with `Retry-After` during active maintenance. Worker watchdog restores storefront when window lapses.

### Section 9: Cross-Cutting & Quality Standards
- [x] Activity audit: `/settings/activity` logs individual modification rows with user email identifiers (no naked UUIDs) and area tags (`docs/changes/assets/10-activity-page.png`).
- [x] Dark mode: all forms, cards, and modal dialogs render high contrast and clear readability.
- [x] Keyboard accessibility: focus rings render on active interactive components; dialogs trap focus and close on Esc.
- [!] **DEFECT 1**: Native `<select>` found in Store Admin layout header (`apps/admin/src/routes/_store.tsx:167`) violating monorepo admin UI standards.
- [x] No `window.confirm` found; ConfirmDialog component used throughout.
- [x] Browser console clean across settings routes without unhandled runtime exceptions.

### Section 10: Owner "Update Available" Prompt
- [x] Fresh store (`zc-fresh-2`) with all six flags OFF shows no update banner when `settings.update_offer` is OFF.
- [x] Turning `settings.update_offer` ON displays "New Settings features are ready for your store" update banner to Store Owner (`docs/changes/assets/11-update-banner.png`).
- [x] Store Manager does NOT see the update banner.
- [x] Clicking "Update available" opens dialog detailing the 6 features.
- [x] "Don't update" dismisses the modal without altering store state; banner remains.
- [x] "Update now" enables bundle for that store only, shows success toast, and banner disappears.
- [x] Activity log writes `settings.update_applied` row. Sibling store (`zc-fresh-1`) remains on legacy settings without automatic opt-in.

---

## 3. Discovered Defects

### DEFECT 1: Native `<select>` element in Store Admin header
- **Severity:** Medium (Monorepo UI Standards violation)
- **File:** `apps/admin/src/routes/_store.tsx:167`
- **Steps to reproduce:**
  1. Sign in to Store Admin with an account having access to multiple stores (e.g. `owner@zcode.local`).
  2. Inspect the top-right store switcher in the header.
- **Expected:** Store selector uses `@bs/ui` or `SimpleSelect` (`components/simple-select.tsx`) conforming to `docs/admin-ui-standards.md` ("no native `<select>`").
- **Actual:** Renders native HTML `<select aria-label="Switch store">`.
- **Evidence:** Source code at `apps/admin/src/routes/_store.tsx` line 167:
  ```tsx
  <select
    aria-label="Switch store"
    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
    value={currentStoreId}
    onChange={(e) => switchStore(e.target.value)}
  >
  ```

---

### DEFECT 2: Horizontal scroll overflow on `/settings` index at 375 px mobile viewport
- **Severity:** Low (Mobile Responsiveness)
- **File:** `apps/admin/src/routes/_store/settings/index.tsx`
- **Steps to reproduce:**
  1. Open Chrome DevTools and set viewport to mobile (width 375 px, height 667 px).
  2. Navigate to `http://127.0.0.1:5273/settings`.
  3. Observe horizontal page scrolling.
- **Expected:** Content fits within 375 px viewport without horizontal scrolling (`scrollWidth <= clientWidth`).
- **Actual:** Content width exceeds viewport (`scrollWidth` = 403 px vs `clientWidth` = 360 px), causing sideways scrolling.
- **Evidence:** Captured in `docs/changes/assets/01-settings-375px.png`.

---

### DEFECT 3: Missing "Require agreement to Terms" (`termsConsent`) toggle in Store Admin Checkout Settings
- **Severity:** High (Feature Gap / Functional Specification)
- **File:** `apps/admin/src/routes/_store/settings/checkout.tsx`
- **Steps to reproduce:**
  1. Navigate to Store Admin -> Settings -> Checkout (`/settings/checkout`).
  2. Inspect available configuration switches.
- **Expected:** A toggle exists for "Require agreement to Terms" (`termsConsent.enabled`) enabling merchants to mandate Terms agreement at storefront checkout per specification prompt §3.1.
- **Actual:** The Admin form only provides toggles for:
  - Guest checkout
  - Phone number required
  - Account creation
  - Address line 2
  - Company name
  - Marketing email opt-in
  - Abandoned checkout recovery
  The `termsConsent` configuration is completely missing from the UI form despite existing in `packages/contracts/src/admin/checkout-settings.ts` and `apps/web/src/components/checkout/CheckoutForm.tsx`.
- **Evidence:** Inspected `CheckoutSettingsForm` state and markup in `apps/admin/src/routes/_store/settings/checkout.tsx`.

---

## 4. Scope Not Tested & Deferred
- **Payment provider credentials (Razorpay / Shiprocket keys):** Specifically excluded per `AGENTS.md` Rule 14 and owner directive.
- **Third-party live email inbox delivery:** Local SMTP disabled; email behavior verified via `email_log` database tables and worker job queues.

---

## 5. Summary & Hand-off
The browser testing suite executed cleanly in headed Chrome across all target settings phases. All core capabilities—permissions gating, GST v2 calculation, policy lifecycle, privacy rate limits & queues, storage tracking, and the Phase 10 rollout prompt—are operating reliably. The 3 identified defects (1 standards violation, 1 mobile layout overflow, 1 missing checkout terms toggle) are recorded for Claude to resolve.
