# Verification round — full prompt for a stand-alone tester session (2026-10-04)

Paste this whole file as the first message of a **new** Claude Code session opened in the `bsec` repo. It replaces the shorter `zcode-verification-round-2026-10-04.md` (same three tasks, A, B, C, with the setup spelled out). You are the **tester**: you find and report defects. You do **not** fix product code.

## 0. Rules that bind you (AGENTS.md is the full text)
- Read `AGENTS.md` sections 2, 5 and 6 first. Test only against the **local stack below**; never open, sign in to or create records on the live site (`bcom.si`, `admin.bcom.si`, `platform.bcom.si`, `superadmin.bcom.si`) and never touch Coolify or Cloudflare.
- Do not change product code, migrations or configs. The only file you commit is your change record. Work in your **own** git worktree off `origin/main` (`git worktree add ../bsec-verify-round -b test/verification-round origin/main`); never edit `C:\dev\bsec-theme-int` (the stack builds from it) or any other agent's worktree. Stage exact paths only; never `git add -A`, `git add .` or a directory.
- Secrets: sign-in values are in `C:\dev\bsec-int-test\CREDENTIALS.txt` (read that file; do not paste passwords into the change record, chat, screenshots you keep, or commits).
- Report honestly: say plainly what you ran, what passed, what failed and what you could not drive. Never write "verified" for something you did not do.
- Use the built-in browser (`mcp__Claude_Browser__*`; read `anthropic-skills:built-in-browser` first). Prefer `read_page` / `get_page_text` over screenshots for text; take screenshots as evidence of visual items and failures. Use `resize_window` for 375 px (mobile) and desktop 1280 px.

## 1. The local stack (already running; compose project `bsecint`)
Built from branch `integrate/theme-builder` (PR #30: theme builder merged with current `main`; migrations through 0032 on a **fresh** database).

| Surface | URL |
|---|---|
| Super Admin (platform staff) | http://localhost:18095 |
| Store admin | http://localhost:18090 |
| Storefront (demo-store) | http://localhost:13010 |
| Platform API | http://localhost:14020 |

- Check it is up: `docker compose -p bsecint ps` (all `healthy`). If stopped: `docker compose -p bsecint -f C:/dev/bsec-theme-int/docker-compose.yml -f C:/dev/bsec-int-test/docker-compose.override.yml up -d`.
- Seed: store `demo-store` (10 products, 8 customers, 19 orders, 3 discounts), the platform themes (Essential Commerce, Fashion Editorial, Gourmet Artisan, Starter Minimal) and an unpublished draft **modern-commerce**.
- Super Admin sign-in forces authenticator enrolment the first time: use the Super Admin screen to generate the secret, compute the 6-digit code yourself (RFC 6238 TOTP, SHA-1, 30 s: `node -e` with `crypto`, or `npx otplib`), enter it, and keep the backup codes in a **local file outside the repo**. If enrolment was already done by the owner, ask for the code instead of resetting it.
- Store admin sign-in: owner account from `CREDENTIALS.txt`. Switch to "Demo Store" top right if asked.
- Reset a broken state: `docker compose -p bsecint down -v` then re-seed (see `CREDENTIALS.txt`); only do this if you cannot continue, and say so in the record.

## 2. Deliverable
One file: `docs/changes/2026-10-04-<your-agent-name>-verification-round.md` using `docs/changes/TEMPLATE.md` ("Type: test"). It must contain:
1. A results table: every numbered check below, `PASS` / `FAIL` / `NOT TESTED (why)`.
2. For each FAIL: severity (blocker / major / minor / cosmetic), exact steps, expected, actual, evidence (screenshot name or console/network line), and whether it reproduces after a reload.
3. A list of everything you did not test.
4. A final recommendation per part: A "merge PR #30" / "do not merge, fix first"; B and C "no defects" / "defects, see table".
Commit only that file (`git add <path>`), push `test/verification-round`, and open a PR (`gh pr create --base main`). The change record is a docs-only change, so CI takes the fast path. Add one line to `progress.md` "In flight" while you run and remove it in the same PR.

## 3. Part A — Theme builder (PR #30). Check at 1280 px and 375 px
Super Admin (http://localhost:18095):
- A1 Themes list shows tabs **Published / Drafts / Archive**; `modern-commerce` is under Drafts; the four seeded themes under Published.
- A2 Archive a published theme: it moves to Archive and disappears from Published; Un-archive moves it back to Drafts (it keeps its published snapshot). Create a throwaway theme (**New theme**, copy of another) then **Delete** it from Drafts or Archive: it is removed and a confirm dialog appears first. Published themes cannot be deleted (the button is absent or refused with a clear message).
- A3 Open `modern-commerce` in the editor. Tabs for **Home, Collection, Product, Cart, Header, Footer** exist. The sidebar rail has **Theme** (first), **Blocks**, **Outline**. Theme tab sections: **Colours, Fonts, Corners, Buttons**; under Fonts, **Heading sizes** H1-H6 with Desktop / Tablet / Mobile pixel values. Change the H1 desktop size, switch the canvas preview to Desktop, Tablet (768) and Mobile (375): the heading size follows the right value for each width, and the preview switcher order is Desktop, Tablet, Mobile with width labels.
- A4 Editor widgets render and their property panels open: HeroSlider and ProductShowcase (Home), Newsletter, Reviews, CartContents (Cart). Save draft succeeds with no console errors; reload keeps the changes.
- A5 **Preview** (top bar): a preview link is created, opens on the storefront host, shows the theme with sample products, and returns a "not found / expired" page for a bogus code.
- A6 Publish `modern-commerce` (it is a local database; publishing is fine): it moves to Published.

Store admin (http://localhost:18090), then storefront (http://localhost:13010):
- A7 Online store > Themes: the library lists the published themes, **Preview** shows the store's own products, **Activate Modern Commerce**. Afterwards the storefront home renders the theme's header, footer and home blocks.
- A8 Storefront at 1280 px and 375 px: collection page (columns, image shape, sale badge); product page (sticky mobile buy bar appears on phone width, reassurance lines under Add to cart, SKU shown or hidden per theme); cart page (free-shipping progress bar, sticky checkout bar on phone width, "continue shopping").
- A9 **Regressions from the merge with `main`** on the product page: a price-on-request product shows "Request a quote" and opens the quote dialog (create one in store admin Products by switching **Price on request** on); a pre-order variant (store admin Products > a variant > pre-order with a ship date) shows the pre-order notice and "ships on" date; a variant with a compare-at price shows the strikethrough and "Save N%"; the Reviews section renders; the sticky bar's Add to cart jumps to the buy box (`id="buy-box"`).
- A10 Add to cart, open the cart, go to checkout, place a **COD** order with the demo data: shipping is priced by the store's own rates (not hardcoded), the thank-you page shows an `ORD-` number, the order appears in store admin Orders.
- A11 Console and network: no uncaught errors or 5xx on any page above (`read_console_messages`, `read_network_requests`).

## 4. Part B — Settings Phase 2 on current `main` (the stack includes it)
Create three extra staff in store admin **Settings > Users** by invitation (the invite link is shown once; open it in a **separate** incognito-like context or a second browser tab after signing out, set a password, sign in):
1. a **Manager** (system role `store_admin`);
2. a **custom role holding only `settings.write`** (create the role if the UI offers it; if custom-role creation is not available in the UI, say so and test with the Manager only);
3. a **custom role holding only `analytics.read`**.
Checks (sign in as each, as applicable):
- B1 `/settings/users`: owner sees the read-only **Store Owner** card, the members table, invite, revoke invitation, change role, remove member. Removing yourself and removing the last owner are refused with a clear message. `/settings/team` redirects to `/settings/users`.
- B2 `/settings/activity`: lists audit rows for this store only; the area filter and paging work; expanding a row shows a diff with **no** password/secret/token/key values.
- B3 **Payments owner-only**: as Owner, **Settings > Payments** shows the Razorpay form; save a fake test key pair (`rzp_test_AbCdEf123456` and any 20-character secret) and see "configured" with only a key hint; Replace and Disconnect work. As Manager the Razorpay area is **read-only status** ("can only be changed by the Store Owner"), no form; a direct `fetch` to the save procedure from the browser console is refused (403 / forbidden). The Manager can still open **Orders > Create order**.
- B4 The `settings.write`-only role: every Settings page it should reach opens; Razorpay save/clear is refused like the Manager.
- B5 The `analytics.read`-only role: Settings pages it lacks are absent from the nav and a direct URL (for example `/settings/activity`, `/settings/store-details`) shows a clear permission error, not a blank page or a redirect to a placeholder.
- B6 Settings Overview (`/settings`) and `/settings/store-details` load for Owner: timezone is an editable select, GSTIN is read-only with a link to Taxes, Country is India.

## 5. Part C — Customers Phase 1 and Segments (merged and live in production)
As Owner in store admin:
- C1 Customers list: tabs All / Customers / Guests / Blocked; stats strip; filters (marketing, tag, location, segment); bulk add/remove tag and set status with the "N done, M skipped" result; Export CSV downloads (if downloads are not drivable, say so).
- C2 Customer detail: edit profile (email only editable for guests or unverified accounts), add and delete a note, change marketing consent (a confirm dialog appears and the consent history updates), add/edit/delete an address, status Block / Unblock. A blocked customer cannot sign in via phone code or check out on the storefront (try it with the storefront as a customer).
- C3 Import: open the dialog, check the column help and consent notice; the file chooser may not be drivable in the browser tool: say so and do not mark it passed.
- C4 Delete: a customer with no orders is deleted; one with orders is **anonymised** (name "Deleted customer", email `deleted-…@invalid`, orders kept).
- C5 Segments: create a manual segment, add customers via the list's **Add to segment**, view the segment table (search, sort, select, bulk remove in edit mode), create an **automatic** segment with a rule and see the preview count; the customer detail **Segments card** shows manual memberships (removable) and automatic matches (read-only).
- C6 Performance sanity: seed about 3,000 customers (a few SQL inserts into the **local** database are fine: `docker compose -p bsecint exec -T postgres psql -U postgres -d bsec`; use `demo-store`'s tenant id, `is_guest = false`, unique emails) and confirm the Customers list loads in a reasonable time and sorts by total spend and by last order. Note the load time you observed and delete nothing else.

## 6. Hand-off
Final message to the owner: PASS/FAIL counts per part, the blockers (if any), the recommendation for PR #30, the PR link for your change record, and anything you could not test.
