# Prompt for Google Antigravity: browser test round for the Settings rebuild (phases 3-8)

**You are:** Antigravity, acting as **tester** (AGENTS.md section 6, roles table). **Verifier of your report:** Claude Code. **Owner:** decides pricing, legal, providers, deleting data.
**Why you:** ZCode ran two rounds and then hit an error part-way through the third. You are taking over the rest. You do **not** write product code in this round and you **never merge**.

## 1. Read first (in this order, 15 minutes)

1. `AGENTS.md` (the rule book; section 6 "Rules for every agent" came from real failures).
2. `docs/prompts/settings-browser-test-zcode.md`: the full checklist. **You will run the parts listed in section 3 below.**
3. `docs/changes/2026-10-05-claude-settings-browser-test-fixes.md`: what was fixed after round 1 and what was added since.
4. `docs/changes/2026-10-05-zcode-settings-browser-test.md` and `...-retest.md`: ZCode's environment notes (how to run the stack locally on this Windows machine) and what is already verified.
5. `docs/runbooks/settings-rollout.md` section 4 (how stores get the new features).

## 2. Ground rules (non-negotiable)

- **Own worktree, always.** Create a sibling worktree of `feat/settings-rebuild-phase-8` (for example `git worktree add C:\dev\bsec-antigravity-test feat/settings-rebuild-phase-8` and work on a throwaway local branch `test/antigravity-settings-browser`). **Never work in `C:\dev\bsec-settings-p8`** (Claude's) or any other agent's checkout: ZCode working in it wiped uncommitted work once.
- **Test only the code that is on the branch tip.** Run `git log -1` at the start and write the commit hash in your report. Do not pull in other branches.
- **Local data only.** Never touch the live store or production, Coolify or Cloudflare; never rotate secrets; never add Razorpay or Shiprocket keys (those phases are gated and out of scope).
- **Do not fix code.** Report defects; Claude fixes them. If a defect blocks everything after it, say so and continue with what you can test through the API, marking those items "API only".
- **Stage by explicit path** (`git add <file>`), never `git add -A`, `.` or a directory. Your only commit is the report (and screenshots, if small).
- **Credentials:** use only the throwaway users you create locally. Do not paste real credentials, TOTP secrets or backup codes into the report.
- **Be honest.** Mark each checklist line `[x]` pass, `[!]` defect, or `[-]` not tested with the reason. Never write "verified" for something you did not run.

## 3. Scope of this round

Already verified in a browser by ZCode (do **only a quick regression spot-check**, 10 minutes): checklist sections **1, 2, 6**, and the maintenance watchdog in section 8.

**Not yet tested. This is your job:**

| Checklist section | What to cover |
|---|---|
| **3** Checkout, Customer accounts, Orders, Returns | Checkout settings reflected live in a real storefront checkout; customer-account sign-in toggles with `settings.customer_accounts` on and off; stale-save conflict with two admin tabs; order numbering; returns page |
| **4** Payments (UI parts) | COD fee/limits as Owner reflected at checkout; Razorpay is a catalogue entry only (no saving UI). Manager refusal is already verified |
| **5** Shipping, Taxes, GST | Shipping preview vs a real cart at the boundary of the free-delivery threshold; checkout totals with `settings.gst_v2` on (CGST+SGST same state, IGST other state, prices-include-tax toggle) and off; refund creates a credit note with the next sequence number |
| **7** Notifications, Policies, Customer privacy | Everything in section 7 of the checklist, including the **new** items: abandoned-cart reminder is **transactional** (sent whether or not the shopper subscribed; switching recovery off in Checkout settings stops it) and the **checkout consent line** (below). Policies: starter drafts, placeholder refusal, versions, restore, storefront page. Privacy: `/privacy-request` anti-enumeration, single-use link, **4th request for one address within an hour is refused**, admin queue export / erase (customer with orders is anonymised, without orders is deleted) / withdraw consent |
| **8** Storage | Usage by category, quota bar and warnings (set a low quota in Super Admin to see amber/red), jump links; flag off shows a clear unavailable state, not a blank screen |
| **9** Cross-cutting | Activity shows a row for every change you make (and the actor shows an email, not a raw UUID next to it); dark mode; **375 px** on every page you touch; keyboard-only focus and dialog focus trap / Esc; no native `<select>` or `window.confirm`; browser console clean |
| **10** Owner "Update available" prompt | The whole section, on a **fresh store with all six settings flags off** |

### 3.1 Checkout consent line (new, test it carefully)
On the storefront `/checkout`, above Place Order:
- **Checkout setting "Require agreement to Terms" OFF:** a small plain notice: "We will email you about your order: confirmation, shipping and delivery updates, and a reminder if you leave items in your cart." No tickbox.
- **Setting ON** (you must first publish a Terms policy in Settings -> Policies, otherwise enabling it is refused with a clear message): one **required** box: "I agree to the Terms and Conditions and allow this store to email me about my order ...". The link opens `/policies/terms`. Place Order is refused until it is ticked, in the UI **and** if you replay the request without `termsConsent` (use the network tab or curl). The order stores the acceptance time and Terms version (check the order row).
- **Marketing email box** (Checkout settings -> marketing email on): an optional box with the store's own label, **unticked by default**. Ticked = the shopper becomes a subscriber (see Customers); unticked = not.
- Marketing emails (newsletter, promotional) still need subscription: a non-subscriber gets nothing and the delivery log says "consent required".

### 3.2 Owner "Update available" prompt (new)
Flag `settings.update_offer` (Super Admin -> Features). Owner only; Managers see nothing. Dialog "Update available" lists six features with **Update now** / **Don't update**. Don't update only closes it (banner stays, nothing changes). Update now enables all six for **that store only** and writes a `settings.update_applied` audit row. Verify a second store is untouched. Section 10 of the checklist has the exact steps.

## 4. Setup (learned the hard way by ZCode)

- **Database:** Docker Desktop on this machine has hung before. If `docker ps` hangs, use a native PostgreSQL (the installed `postgresql-x64-16` binaries) on a spare port, create db `bsec`, then bootstrap and migrate with the built scripts in `packages/db/dist` (bootstrap, then deploy). Migrations through **0048** must be applied (`migrations ok`).
- **Servers** (ports 3000/5173 may be taken by other worktrees; pick free ones): web (3000), platform (4000), worker (4100 health; **start it**, maintenance and email jobs need it), admin (5173), superadmin (5174). Root `.env` (uncommitted, never commit it) needs `BETTER_AUTH_URL` for the web origin, `ADMIN_ORIGINS`, `SUPERADMIN_ORIGINS`, `PREVIEW_BASE_URL`.
- **Quirks:** `/api/saas/*` is only served for host `localhost` (or the marketing host), so send `x-forwarded-host: localhost:<port>` from curl. Admin API calls need header `x-store-id` (the SPA sets it). Super Admin sign-in needs TOTP.
- **Data:** seed the Demo Store per `DEPLOYMENT.md`; create two extra stores with an Owner each (via Super Admin) so you can test "only this store changes". Create a Manager by inviting someone with the `store_admin` role from Settings -> Users. Custom roles do not exist (deferred by the owner); skip the Analytics-only role.
- **Flags:** for the main walkthrough turn on the five flags in Super Admin -> Features (`settings.notifications`, `customer_accounts`, `storage`, `maintenance`, `policies`, `gst_v2`). For section 10 use a fresh store with all six off and only `settings.update_offer` toggled.
- **Email:** outgoing mail is not delivered locally. Judge email behaviour from **Settings -> Notifications delivery log / `email_log`** and the worker log, not from an inbox. Say which you used.
- **Browser:** use your own browser at 375 px and desktop, light and dark. If the browser tool hangs or pages stay blank with no console error, try a fresh origin (new port) before reporting a defect: ZCode lost time to a stale cached shell on a long-lived origin.

## 5. What to report

Create `docs/changes/2026-10-0X-antigravity-settings-browser-test.md` (format: `docs/changes/README.md`, `Type: test`, Agent: antigravity) containing:
1. Branch tip commit hash tested, stack setup (DB, ports), flags state.
2. The checklist with `[x]` / `[!]` / `[-]` per line for sections 3, 4, 5, 7, 8, 9, 10 and the regression spot-check.
3. For each defect: **severity** (High = blocks a main path or leaks/loses data; Medium; Low), page or API, **numbered steps**, expected, actual, evidence (response body, console error, SQL result, screenshot path under `docs/test-evidence/2026-10-05-settings-browser/`, small files only).
4. What you could **not** test and why.
5. Open questions for the owner.

Commit only that file (and small screenshots), update your line in `progress.md` "In flight", and tell the owner the file name. Claude will review each claim against the code, fix defects, and send anything needing re-testing back to you.

## 6. Definition of done for this round

- [ ] Every line of sections 3, 4, 5, 7, 8, 9, 10 has a mark and, for `[-]`, a reason.
- [ ] Every defect has steps another person can follow in five minutes.
- [ ] No code changed, nothing merged, no secrets or `.env` committed, own worktree used.
