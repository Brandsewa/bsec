# Settings rebuild (phases 3-8): browser test checklist for ZCode

**Tester:** ZCode. **Verifier of results:** Claude. **Branch:** `feat/settings-rebuild-phase-8` (contains phases 3-8). Claude has already run the code gate: typecheck, lint, build, 1688 real-database tests. This round covers only what those cannot: the screens in a browser.

Ground rules (AGENTS.md section 6):
- **Local data only.** Never touch the live store, Coolify or Cloudflare. Never add Razorpay or Shiprocket keys (phase 5B and 6E/6F are gated and out of scope).
- Work in your **own worktree**; stage by explicit path; never `git add -A`.
- Findings go in the repo: one file `docs/changes/2026-10-0X-zcode-settings-browser-test.md`, "Type: test", using the format in `docs/changes/README.md`. For each defect: severity, page, steps, expected, actual, screenshot path. Never write "verified" for something you did not do.
- Test at **375 px and desktop**, **light and dark**. Hints belong behind an (i) icon pop-up, not inline text (owner preference); note any that are inline.

## 0. Setup

1. `pnpm install`, start Postgres (`pnpm test:heavy:local` starts the Docker one; or your usual local DB), run migrations, then `pnpm --filter @bs/web dev` (3000), `pnpm --filter @bs/platform dev` (4000), `pnpm --filter @bs/admin dev` (5173), `pnpm --filter @bs/superadmin dev` (5174). Seed the demo store per `DEPLOYMENT.md` ("Demo store").
2. Four of the six rollout flags are off by default and change behaviour when on. **Super Admin (5174) -> Features**: turn on `settings.notifications`, `settings.customer_accounts`, `settings.storage`, `settings.maintenance`, `settings.policies`, `settings.gst_v2` (global default; there is no per-store override screen, so this applies to the whole local DB).
3. Prepare three store users: **Owner**, **Manager** (`store_admin`), and a **custom role with only Analytics read**. Invite them from Settings -> Users.
4. Keep the browser console and network tab open. Any console error, 4xx/5xx you did not cause, or layout overflow is a finding.

Each section below: tick `[x]` pass, `[!]` defect (write it up), `[-]` not tested (say why).

## 1. Settings shell and navigation (all roles)

- [ ] Settings opens from the main sidebar; the groups and items match the table in `apps/admin/src/components/settings/settings-nav.ts`.
- [ ] **Owner** sees every item. **Manager** sees every item except Payments (it needs `payments.manage`, owner-only). **Analytics-only** role sees no settings items (or only what `settings.read` allows) and no broken links.
- [ ] Pasting a URL for a page the role may not see shows a clear no-access state, not a blank page or a crash.
- [ ] Every page shows its loading state (`pendingComponent`) on a throttled network.
- [ ] Unsaved-changes guard: edit a field, click another settings link: you are warned; "stay" keeps the edit, "leave" discards it.
- [ ] 375 px: nav collapses usably; no horizontal page scroll on any settings page.

## 2. Phase 3: Branding, Storefront status, Domains

- [ ] **Branding:** upload logo/favicon (valid image accepted; wrong type and oversize refused with a clear message); colours and fonts save; contrast warning appears for a low-contrast pair; Activity shows the change.
- [ ] **Storefront:** switch Live / Coming soon / Password / Maintenance. Open the storefront (3000) logged out in a private window after each: correct screen, correct HTTP status (check network: coming soon and password show their screens; maintenance returns 503 with a `Retry-After` header).
- [ ] Password mode: wrong password refused, right password lets you in; the old replayable-token behaviour is gone (reloading with the password in the URL does not stay unlocked).
- [ ] Staff preview link bypasses the status; copy/rotate works; old link stops working after rotate.
- [ ] **Domains:** add a custom domain (DNS instructions shown), verify (expect a clear "not verified yet" locally), set primary, remove (confirm dialog, not `window.confirm`). Manager can do it; analytics-only role cannot.

## 3. Phase 4: Checkout, Customer accounts, Orders, Returns

- [ ] **Checkout:** change required fields/options, save, then go through a real storefront checkout and confirm the change is live (field required or hidden as set).
- [ ] **Customer accounts** (flag `settings.customer_accounts` on): turn email/password off -> storefront registration and login refuse with a clear message; turn phone OTP off the same. Turning both off is refused. Turn both back on.
- [ ] With the flag **off** (turn it off in Super Admin and retry): methods turned off in settings are still usable (behaviour before the feature). Turn the flag back on.
- [ ] Two admin tabs: save in tab A, then save stale tab B: tab B shows "changed by someone else, reload", not a silent overwrite.
- [ ] **Orders** settings (numbering prefix, processing) save and affect a new order number. **Returns** page loads and saves.

## 4. Phase 5: Payments, Plan and billing

- [ ] **Payments:** COD shows as the only method; Razorpay appears as a catalogue entry only (no key fields that save).
- [ ] COD fee/limits: Owner saves and a storefront checkout reflects them. **Manager is refused** (clear message, nothing saved).
- [ ] **Plan and billing:** plan, usage and invoices visible; "request change" works for the Owner and shows the request as pending; Manager cannot request; request can be cancelled. No self-service payment UI anywhere.
- [ ] Super Admin (5174) -> Plans: the request appears; decide it (approve or decline); the store sees the decision.

## 5. Phase 6: Shipping, Taxes (GST), credit notes

- [ ] **Shipping:** default zone and rates editable in rupees, stored correctly; the preview calculator matches a real storefront cart for the same state and subtotal; free-delivery threshold works at the boundary. Shipping changes appear in Activity (this was a fixed defect: confirm the audit row exists).
- [ ] **Taxes:** GSTIN validation (bad format, bad checksum, state mismatch each refused with a clear message); a valid one saves; tax classes create / edit / delete; the default class cannot be deleted.
- [ ] Checkout totals (`settings.gst_v2` on): same-state order shows CGST + SGST, different-state shows IGST; prices-include-tax toggle changes the maths as expected; the total in the order matches the cart.
- [ ] Refund an order from admin: a credit note is created with the next sequence number and links to the invoice.
- [ ] With `settings.gst_v2` **off**: totals match the old behaviour (no breakdown), nothing crashes.

## 6. Permissions (the part tests cannot see)

- [ ] **Manager** (`store_admin`): can change branding, storefront status, checkout, shipping, taxes, notifications, policies, privacy; **cannot** save COD/Razorpay, cannot schedule or end maintenance, cannot request a plan change. Each refusal is a clear message in the UI, and the page does not pretend it saved.
- [ ] **Analytics-only** role: every settings write is refused; reads that need `settings.read` are refused too.
- [ ] Open the browser network tab and replay a refused request: status is 403, response has no secret or stack trace.

## 7. Phase 7: Notifications, Policies, Customer privacy

- [ ] **Notifications** (`settings.notifications` on): switch off a customer email (for example shipping update), trigger it from a test order, confirm no email is sent and the delivery log says skipped (preference off). Account-security emails cannot be switched off.
- [ ] Marketing consent: an abandoned-cart recovery email goes **only** to a shopper subscribed to marketing; to a shopper who never subscribed, nothing is sent and the log says consent required. (Owner decision pending on whether this stays; just report what you see.)
- [ ] Emails that are marketing carry an unsubscribe link; opening it unsubscribes and the next marketing email is skipped.
- [ ] **Policies:** starter drafts are labelled as drafts and are **not** auto-published; publishing a draft that still contains `[Store Name]`-style placeholders is refused; edit, publish, see version history, restore an older version as a draft. The storefront `/policies/privacy` shows the published text (flag `settings.policies` on) and the platform boilerplate when off.
- [ ] **Customer privacy:** cookie inventory lists the cookies; settings (contact email, grievance officer, SLA 7-90 days) save, out-of-range refused.
- [ ] Storefront `/privacy-request`: submit an access request. You always get the same neutral confirmation (even for an unknown address). The email link verifies once; reusing it fails. Submit the same address 4 times in an hour: the 4th is refused with a "try again later" message (rate limit).
- [ ] Admin queue: verified request shows with a due date; run export (download has the shopper's data and nothing from other shoppers), erase (customer with orders is anonymised; customer without orders is deleted), withdraw consent. Each action shows up in Activity.

## 8. Phase 8: Storage, Maintenance

- [ ] **Storage** (`settings.storage` on): usage by category, quota bar, jump links to files / products / themes work. Upload files and watch it change. With the flag off, the page shows a clear unavailable/error state (not a blank screen).
- [ ] **Maintenance** (`settings.maintenance` on, **Owner only**): schedule a window starting 2 minutes ahead. The storefront stays live until the start, then shows the maintenance screen with 503 and `Retry-After`, add-to-cart and checkout are refused with a clear message, staff preview (if allowed) still sees the store. At the end time the store returns to its previous mode on its own (the worker must be running: `pnpm --filter @bs/worker dev`).
- [ ] Cancel a scheduled window before it starts; end an active window early; transition history lists each change with its reason.
- [ ] Manager cannot schedule/cancel/end (message says only store owners).
- [ ] Stop the worker during a window past its end time, restart it: the watchdog restores the store within about a minute.

## 9. Activity, audit, cross-cutting

- [ ] Settings -> Activity lists a row for each change you made above (store details, branding, storefront, checkout, customer accounts, payments, shipping, taxes, notifications, policies, privacy, maintenance). No row shows a secret, password or token.
- [ ] Super Admin audit log shows the platform-side actions (plan decision, flag changes).
- [ ] Dark mode: every page above is readable; focus ring visible on every control with the keyboard alone (Tab / Shift+Tab / Enter / Esc); dialogs trap focus and close on Esc.
- [ ] No native `<select>` or `window.confirm` anywhere in Settings.
- [ ] Reload every settings page: values persist; no console errors.

## 10. Report

Write the change record (see ground rules), list every unchecked box with the reason, and attach screenshots under `docs/changes/assets/` only if small (otherwise reference a path). Do not fix code in this round unless the owner asks; report and hand back to Claude.
