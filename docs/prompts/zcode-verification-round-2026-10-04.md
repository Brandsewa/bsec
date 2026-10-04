# ZCode verification round — 2026-10-04 (browser walkthroughs, no product code)

You are the tester for this round. Do not change product code. Report defects in a change record (`docs/changes/2026-10-04-zcode-verification-round.md`, "Type: test"): per defect, severity, steps, expected, actual, evidence; plus what you did not test. Local or ephemeral data only; never drive the live store (AGENTS §6). Use your own worktree; stage exact files only.

## A. Theme builder integration (`integrate/theme-builder`, PR #30, not merged)
Build the stack from that branch. It adds migrations 0031/0032, both idempotent. Take a `pg_dumpall` of any database you reuse first; a fresh database is safer because Drizzle skips migrations older than the last applied one. Check at 1280 px and 375 px:
1. Super Admin: Themes list tabs (Published / Drafts / Archive), archive, un-archive, delete a draft; the theme editor opens; Theme tab (colours, fonts, heading sizes per device); the preview link works and expires.
2. Editor widgets: HeroSlider, ProductShowcase, CartContents, Newsletter and Reviews render and save.
3. Store admin Themes: library, preview with the store's own products, activate, "newer version" notice.
4. Storefront after activating Modern Commerce: collection, product (sticky mobile buy bar, reassurance lines), cart (free-shipping bar, sticky checkout bar).
5. Regressions from the merge: "Request a quote" on a price-on-request product, the pre-order notice on a pre-order variant, sale price and savings, the reviews section, the SKU toggle; cart and checkout still price shipping server-side.
Report pass or fail per item with screenshots.

## B. Settings Phase 2 (merged, PR #29) on current `main`
With Owner, Manager (`store_admin`), a custom role with only `settings.write`, and a role with only `analytics.read`:
1. `/settings/users`: invite, revoke, change role, remove; the Store Owner card is read-only; last-owner and self-removal are refused; `/settings/team` redirects.
2. `/settings/activity`: only this store's rows, the area filter works, the expandable diff shows no secret-shaped values.
3. **Payments**: Owner can save and clear Razorpay keys; Manager sees status only (no form) and a direct API call is refused; the create-order screen still opens for Manager.
4. A denied role sees no Settings it lacks and gets a clear permission error on a direct URL.

## C. Customers Phase 1 and Segments (merged and deployed)
List filters and tabs, detail and edit, notes, a consent change with its confirm dialog, add to segment, the segment detail table, import dry-run (the file chooser may not be drivable: say so), delete vs anonymise. Check the list stays fast with a few thousand seeded customers.

Hand-off: the record above, plus a one-line summary to Claude.
