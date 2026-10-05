# Follow-up brief for Antigravity: re-test three fixes (short round, about 45 minutes)

**Role:** tester, same as your first round. Same rules: **own worktree** (reuse `C:\dev\bsec-antigravity-test`, but first `git fetch` and `git reset --hard origin/feat/settings-rebuild-phase-8` **inside your own worktree only**), local data only, **no code changes**, never merge, stage files by explicit path.
**Why:** your first report (`docs/changes/2026-10-05-antigravity-settings-browser-test.md`) found three defects. Claude fixed them at commit `a33bace`. Your report also could not test the Terms checkbox, because the admin switch for it was missing. Both are covered here.

Write down the commit you test (`git log -1`; it must be `a33bace` or later, and include `a33bace`). Rebuild and restart admin and web from that tree, hard-reload the browser (or use a fresh port) so you do not test a cached bundle. Setup is unchanged from `docs/prompts/settings-browser-test-antigravity.md` section 4. Flags: all six `settings.*` flags on, as in your main walkthrough.

## A. Terms agreement at checkout, end to end (the main item)

Fix: Settings -> Checkout now has a switch **"Require agreement to Terms"** (section "Consent at checkout").

1. **Switch exists, and refuses without a Terms policy.** Sign in as Owner, open Settings -> Checkout. Find the switch. With **no published Terms policy**, turn it on and Save: expect a clear message (the server says to publish the Terms policy first), **not** a generic error and not a silent success. Record the message and the HTTP status from the network tab (expected 412).
2. **Publish Terms.** Settings -> Policies -> Terms: save a draft with real text (no `[Store Name]`-style placeholders and no starter advice banner, or publishing is refused), publish it.
3. **Turn the switch on, Save.** Reload the page: it stays on.
4. **Storefront checkout (desktop):** add a product, open `/checkout`. Expect one **required** box above Place Order: "I agree to the Terms and Conditions and allow this store to email me about my order ...". The link opens `/policies/terms` (new tab) and shows the text you published.
5. **Without ticking:** click Place Order. Expect the form to refuse with "Please tick the box to agree to the Terms and Conditions before placing your order" (no order created).
6. **Replay without consent (server side):** in the network tab copy the `place-order` request, remove `termsConsent` (or set it false) and send it again (curl or DevTools "Edit and resend"). Expect HTTP 400 with "You must agree to the Terms of Service to place this order" and **no order row**. Record status and body.
7. **Tick the box and place a COD order.** Expect success. Then in the database: `SELECT number, terms_accepted_at, terms_policy_version_id FROM orders ORDER BY created_at DESC LIMIT 1;` Expect a timestamp and the id of the Terms version you published. Paste the row in the report.
8. **Edit and republish Terms** (change a word), place a second order: its `terms_policy_version_id` must be the **new** version; the first order must still point to the old one.
9. **Switch off** "Require agreement to Terms", Save, reload `/checkout`: the required box is gone and the plain notice ("We will email you about your order ...") is back. Place Order works without a box.
10. **Marketing box together:** also turn on "Email marketing opt-in checkbox" with a custom label. On `/checkout` you see both boxes; the marketing one is **unticked by default**. Place one order with it ticked and one without. In Customers: the first shopper is a subscriber, the second is not.
11. **375 px:** repeat steps 4-5 at 375 px. Boxes are readable, the text wraps, no horizontal scroll, the link is tappable.

## B. Mobile header at 375 px

Fix: the page header no longer overflows (store name truncates, switcher is narrow, "Password" is an icon only below `sm`).

1. Open `/settings`, `/settings/checkout`, `/` and one list page (for example `/orders`) at **375 px** with a store that has **more than one store** in the account (so the switcher shows) and a long store name.
2. On each page run in the console: `[document.documentElement.scrollWidth, document.documentElement.clientWidth]`. Expect `scrollWidth <= clientWidth` on **every** page. Record the numbers.
3. The header shows: sidebar toggle, a truncated store name (or the switcher), the icon-only password button, Sign out. Nothing wraps onto three lines. Take one screenshot.
4. At 768 px and desktop widths the header looks as before ("Password" label visible).

## C. Store switcher is no longer a native select

1. As a user with two or more stores, the header control labelled "Switch store" is a styled dropdown (not the OS dropdown). Inspect: there is **no** `<select>` element in the admin header.
2. Open it with the mouse, choose another store: the app reloads on that store's Home. With the **keyboard only** (Tab to it, Enter/Space, arrows, Enter): same result. Esc closes it without switching.
3. Dark mode: the dropdown and its options are readable.

## Report

New file `docs/changes/2026-10-0X-antigravity-settings-browser-retest.md` (format `docs/changes/README.md`: Date, Agent: antigravity, Branch, Area, Type: test, then **Summary**, **Verification**, **Docs updated**, **Definition of done**). For each numbered step: `[x]` pass, `[!]` defect, `[-]` not tested with the reason, and **paste the evidence** for A6, A7, A8 and B2 (HTTP status and body, the SQL row, the `scrollWidth` numbers); a bare "passed" is not enough for those. Screenshots go under `docs/test-evidence/2026-10-05-settings-browser/` (small files only; that folder, not `docs/changes/`). Defects: severity, numbered steps, expected, actual, evidence. Commit only your report and screenshots, update your `progress.md` In-flight line, and tell the owner the file name. Claude reviews it against the code.
