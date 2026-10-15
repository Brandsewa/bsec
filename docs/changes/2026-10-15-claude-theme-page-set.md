# Theme page set: collections archive, themed default pages, demo catalog

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `feat/theme-templates` (not merged yet)
- **Area:** blocks, domain, web, admin, platform
- **Type:** feature
- **Supersedes:** none

## Summary
Implements the first slice of `docs/THEME-TEMPLATES-PLAN.md`: a Collection Archive page (`/collections`), a payment-failed page, a themed 404, theme skin and `noindex` on checkout and order pages, a `?variant=` deep link on the product page, and a local catalog fixture for testing the page set through to a placed order.

## What changed
- New theme page `collections` (`collections_archive_template`); `CollectionGrid` gains `showAll` and shows product counts (`packages/blocks`, `packages/domain/src/themes/block-data.ts`). Editor kind `collections`; cache invalidation and media-usage labels know the new type. Modern Commerce theme defines an archive page.
- `apps/web`: `/collections` (+ `loading.tsx`), `/checkout/failed`, `not-found.tsx`; `.bs-skin` on checkout, thank-you and order status; `noindex` on cart, checkout, result and COD pages. `VariantSelector` reads and writes `?variant=` (via `useSyncExternalStore`, no setState in an effect).
- `seedThemeDemoCatalog` + `demo.js seed-catalog`: 6 collections, 14 products (1-3 options, sale prices, sold-out and low-stock variants, long title, draft and archived). No migration, no new env var.

## Decisions and trade-offs
ADR-032. Owner answers (2026-10-15): failure page built now and tested by direct visit; alternates per product/collection deferred (only the option to create one is wanted, not built yet); checkout stays token-only; one theme for now; demo store local only; extras kept.

## Verification
- `test/theme-demo-catalog.int.test.ts` 4/4 on real Postgres: seed, storefront visibility of draft/archived, archive counts, unpublished hidden, other-store isolation, idempotence. `themes.int`, `cache-invalidation`, `storefront-isolation.int` 53/53. `@bs/blocks` 137/137, `@bs/web` 184/184.
- Typecheck: blocks, block-editor, domain, admin clean; web clean except stale generated `.next/dev/types`. ESLint on the changed web files clean.
- By hand on a local database (`bsec_themedemo`, demo store, Next dev server): `/collections` lists 7 collections with counts; variant click updates price (Sand +Rs 200) and URL, deep link restores it; cart, COD checkout with the form filled, thank-you page; order `ORD-00020` grand total 274900 paise (2699 + 50 COD fee); `/checkout/failed?reason=<script>` shows fixed copy and noindex; an unknown product shows the themed 404 with search.
- NOT verified: mobile 375 px, Lighthouse/axe, keyboard-only purchase, checkout validation errors and double-submit (existing suites cover price recompute; not re-run), activating Modern Commerce with the archive page in the UI, `pnpm build`, full `pnpm lint`, `pnpm test:heavy:local`, Docker runtime. The failure page is not linked from checkout yet (online payment is deferred).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 10, last verified)
- [x] ADR-032
- [x] `DEPLOYMENT.md` not needed
- [x] `progress.md`

## Follow-ups and open questions
- Create-an-alternate-template option: needs a page-type convention for alternates and a picker; not built.
- Announcement bar setting and predictive search: deferred by the owner (later). Free-shipping bar inside the mini cart: not built.
- Demo products have no images; add local fixture images.

## Definition of done
Partially met: see NOT verified above. Do not merge until the gate in `AGENTS.md` section 4 has run.

## Update 2: default page settings, mini cart, free-shipping bar (same branch)
- **Default page settings:** `packages/blocks/src/default-pages.ts` (schema, built-in text, `resolveDefaultPages`, `validateDefaultPages`); `saveThemeTemplateDraft` rejects bad copy (HTML, over-long, wrong types, unknown sections); Super Admin theme editor gets a "Default pages" form (`DefaultPagesForm.tsx`) and a "Collection archive" tab; checkout, order success, payment failed, search empty state and 404 read the copy via `getCachedDefaultPages`. No migration.
- **Mini cart:** `MiniCartDrawer.tsx` opened from the header cart link (modified clicks and `/cart`, `/checkout` still navigate), and after add to cart. Focus trap, Escape, scroll lock, focus return. `CartBadge` now reads the count cookie through `useSyncExternalStore`, which removes the server/client count mismatch noted above.
- **Free-shipping bar:** the built-in cart now shows it whenever the store has a free-shipping threshold (previously only theme cart templates did). The theme demo seed sets Rs 50 standard shipping, free from Rs 2,999 (store config, not code).
- **Tested:** `@bs/blocks` 141/141 (4 new), `themes.int` 26/26 (new real-DB test: bad copy rejected, good copy reaches the activating store only), typecheck and lint clean for blocks, block-editor, domain, admin, web, superadmin. By hand on the local demo store: drawer open from the header and after add to cart, quantity change, badge sync, Escape, scroll lock and focus return; cart shows "Add Rs 2,750 more for free shipping" for a Rs 249 cart; theme copy visible on `/checkout`, `/checkout/failed`, the 404.
- **Not verified:** the Super Admin form itself in a browser (typechecked and linted only); 375 px, axe, keyboard walk of the drawer beyond Escape and focus return; free-shipping bar inside the drawer (not built; the drawer says shipping is worked out at checkout).
- **Earlier claim corrected:** the first background run of the full domain suite never started (wrong flag). It is re-run for this update.

## Update 3: collection archive cards and descriptions
- **Migration `0060_collection_description`** (expand only): `collections.description` text, nullable. Domain: `cleanCollectionDescription` (plain text, max 300, no angle brackets) on create and update; returned by the admin list and detail and by the archive block data. Contract: `description` on collections create (max 300) and update (nullable). Admin: "Description" textarea with counter on the new and edit collection forms.
- **Archive look:** `CollectionGrid` cards are borderless: rounded 4:5 image, title, description limited to two lines (`-webkit-line-clamp`), more space between cards. The heading's description is the block's own "Description under the heading" field, so merchants and theme authors set it in the theme editor; the default archive says "Browse everything we sell." The product-count line was removed from the card. Block editor labels updated (`showAll` is now a switch).
- **Tested:** `theme-demo-catalog.int.test.ts` 5/5 (description saved, trimmed, HTML and 301 characters rejected, shown on archive data, blank clears), `@bs/blocks` 143/143, typecheck and lint clean for blocks, block-editor, domain, admin, web, contracts, platform. By hand locally: cards render with descriptions; a 280-character description is cut at two lines.
- **Local fixture only:** Taste of Hills photos, four products and three collections exist only in the local `bsec_themedemo` database and a scratch media folder; nothing from them is in the repo.
- **Not verified:** the admin description textarea in a browser (typechecked and linted only), 375 px layout, the migration against a populated production-size table (it is a nullable column add).

## Update 4: responsive collection grid and image placeholder
- `CollectionGrid`: `columnsTablet` (2 or 1, default 2) and `columnsMobile` (1 or 2, default 1) next to desktop `columns` (4, 3 or 2); breakpoints 640 and 1024 px. Tablets used to show the desktop count; they now default to 2. Centred heading fixed for this block only (the shrink-wrapped heading box is also in other blocks, not changed).
- **Image placeholder:** the supplied grey hills picture is `placeholder.png` in `apps/web`, `apps/admin` and `apps/superadmin` `public/`, used with `object-fit: cover` wherever a product or collection has no picture: block product and collection cards, showcase cards, `ProductCard`, product gallery, cart rows, checkout summary, mini cart. Constant `PLACEHOLDER_IMAGE_URL` in `@bs/blocks` and `apps/web/src/lib/placeholder.ts` (separate so client code does not import the block library). Hero backgrounds, logos and avatars keep their own fallbacks.
- Tested: `@bs/blocks` 144/144, web 184/184, typecheck and lint clean; browser: sale collection cards and the hoodie product page show the placeholder with `cover`. Not checked: admin and superadmin editor preview showing it (files are in place), order status page items.

## Update 5: collection page (archive single)
- **Cards:** borderless with a rounded image, title, rating, price; discount and category badges; second image on hover; small cart icon at the image's bottom right (one variant: adds directly and opens the mini cart; several variants: quick-buy popup with options, stock per combination, quantity, Add to cart, Buy now and an optional "View full product details" link; both can be switched off, then the icon links to the product page). Out-of-stock products show "Sold out" and a disabled icon.
- **Page:** description under the title, breadcrumb off by default, left filter sidebar (the store's `filter` menu: availability, price, categories, collections, options, tags) that can be hidden on desktop and opens as a drawer on phones, grid / list switch, "Showing X of Y" with Load more (default 12 per load, theme setting 12, 24 or 36; works with filters and sort), cards per row for desktop 4/3/2, tablet 2/1, phone 2/1.
- **Data:** `buildProductSummaries` now returns `secondaryImage`, `categoryName` and `quickAdd` (options, variants with price and whether each can be bought now); `getStorefrontCollection` returns the collection `description`. No migration. Existing documents keep the old look through the block schema defaults (bordered cards, breadcrumb, no new controls); new blocks and the Modern Commerce theme carry the new look.
- **Tested:** `theme-demo-catalog.int.test.ts` 6/6 (quick-add data incl. a sold-out variant and an unavailable product, never directly addable), `@bs/blocks` 146/146, `@bs/web` 184/184, typecheck and lint clean. Browser: collapse sidebar, list view, hover swap, Load more 12 to 24, quick buy (price follows the variant, Add to cart opens the mini cart), direct add, tablet 2 columns, phone 1 and 2.
- **Not verified:** the Super Admin editor fields for these settings in a browser; quick-buy popup keyboard walk beyond focus move and Escape; "Buy now" through to the order; the product reviews shown are the card ratings (count and average) only; an in-stock-only toggle is no longer in the toolbar when a store has no availability filter (add one in the filter menu).
- **Follow-ups for the backend pass:** a small product JSON endpoint for quick buy if listings grow past 100 products (the data is embedded in the page now); Load more beyond 100 uses numbered pages.

## Update 6: toolbar, price slider, skeleton, review summary
- **Toolbar order:** Filters, product total, then Sort and the view switch. On phones Sort is a button like Filters and opens a bottom sheet (radio list); tablet and desktop keep the select. Filters are a sheet on phone and tablet, a hideable sidebar on desktop.
- **Price filter** is a two-handle slider in rupees (`PriceSlider`); the address and query still use paise, and the address updates when a handle is released. Dragging back to the full range removes the filter. This also fixes the old min/max boxes, which showed paise under a rupee label.
- **Skeleton:** cards are replaced by shimmer placeholders (same grid and view) while a filter, price range or sort is being applied; filter and sort changes also reset "Load more" to the first page.
- **Reviews:** the product page shows a review summary above the title (partly filled stars for the average, the number and "(N reviews)", linking to the reviews section; "No reviews yet. Be the first to review" when empty). It follows the existing "Show rating" setting of the product block. The rating comes from the existing review system's stored average and count, which is also what the listing cards show.
- **Tested:** `@bs/web` 189/189 (5 new: review summary, slider, skeleton). Browser: toolbar order, slider drag (min to Rs 2,082 gave 5 products, `?price=208200-`), skeleton seen while ticking a category, phone Sort sheet (Price low to high put Gundruk first), summary with a temporary 4.3 / 27 rating (restored to 0 afterwards).
- **Not verified:** the slider with keyboard and touch, the Sort sheet's keyboard focus, the review summary on the 375 px product page.

## Update 7: product page
- **Gallery:** thumbnails below, left or right of the picture (phones always below) with small arrow icons to move through them, large-view dialog (arrows, Left/Right/Escape, swipe, focus kept inside, neighbours preloaded), previous/next arrows and a counter on the main picture, swipe, video in the main view and the large view.
- **Buy box order:** review summary (nothing at all when there are no reviews), title, SKU (on/off), short description cut at two lines with a Read more popup showing the long description, options as small pills / buttons / dropdowns, price with a note under it (default "Tax and shipping calculated at checkout."), quantity and Add to cart on one row with Buy it now below (labels and four colours are block settings), secure payment picture (media library, built-in badge otherwise), delivery estimate ("Arrives Mon 19 Oct if you order in the next 4 hrs 1 min. Ships within 24 hrs.": cut-off hour, delivery days, dispatch note and time zone are block settings; computed in the browser, no Sundays), up to four highlight cards (icon and text) that slide on phones. The in-stock and pincode widget (`StockEtaHole`) is removed; low and no stock show as a short line under the price.
- **Second section:** new `ProductInfoTabs` block: tab 1 is the product's long description, tab 2 is plain text from the theme (blank line = paragraph, "- " = bullet), a picture on the other side (media library, placeholder by default, left or right). Reviews now sit below both. The Modern Commerce product page uses it in place of its FAQ and highlight strip.
- **Compatibility:** product blocks saved before these settings keep the old look through the schema defaults; new blocks and Modern Commerce get the new layout. New block count 36.
- **Tested:** `@bs/blocks` 150/150, `@bs/web` 198/198 (delivery dates incl. Sunday skip and time zones, Read more, tabs and list rendering, thumbnail placement, pills and dropdown, price note, button row and colours), `commerce-templates` 3/3, production build and the `/products/[slug]` bundle budget (100 KB gzipped) pass, typecheck and lint clean. In the browser: new layout, thumbnails on the left, enlarged view open, next picture, Escape, delivery estimate text, three highlight cards, tabs.
- **Not verified:** the Super Admin editor fields in a browser; the phone look beyond measurements (thumbnails sit below in a row, highlight cards scroll sideways, no sideways page scroll at 375 px) and the Read more popup on a phone; screen-reader pass on the gallery and dialogs; the Read more popup with a real long description in the browser (unit-tested only).

## Update 8: payment badge file and highlight cards
- `apps/web/public/secure-payment.svg` is now the supplied "Secure checkout" badge (payment-method logos, 176 x 10 units, shown at the width of the buy box up to 28 rem). It is the built-in default; a picture chosen from the media library still replaces it. The file carries third-party payment brand marks supplied by the owner.
- Highlight cards: bare icon (no coloured circle), bold title and a short description, in a bordered soft card like the old badge. Each card has an optional `description` (max 80 characters); defaults and the Modern Commerce theme carry descriptions.
- Fixed in passing: the side thumbnail strip had no height (only a sliver showed); it now matches the picture's height.
- Tested: `@bs/web` 200/200 (cards, payment picture and no review text without reviews), typecheck and lint clean. Browser: badge loads at 448 x 26 px, three cards with descriptions, thumbnail strip 484 px tall beside the picture.

## Update 9: mini cart redesign
- **Design:** serif heading with count and a square close button; line items with a larger rounded picture, serif title, variant, bold price, a small remove cross at the top right and the quantity stepper at the bottom right; footer with the free-shipping progress bar (in place of the coupon box), a large total with small print, a full-width Checkout button with an arrow, an outline Continue shopping button, and a row of three reassurance items. "View cart" is gone from the drawer; the `/cart` page still exists.
- **Editable from the back:** a `miniCart` section in `tokens.defaultPages` (heading, checkout and continue labels, small print, free-shipping bar on/off, reassurance row on/off, up to four reassurance items with an icon and text), shown in Super Admin's "Default pages" form (with an item editor), validated as plain text and copied to stores with the theme. The root layout supplies it through `MiniCartConfigProvider`.
- **Free shipping:** `GET /api/storefront/cart` now also returns `freeShippingThresholdPaise` (the store's own amount, null when none). The icon set moved to `@bs/blocks/svg-icon` so the browser bundle does not import every block.
- **Tested:** `@bs/web` 206/206 (drawer content, free-shipping states, theme wording and switches, fallback equals shared default, setting validation), `@bs/blocks` 150/150, `themes.int` 26/26, production build and the product page bundle budget pass, typecheck and lint clean. In the browser: new layout, "Add Rs 2,750 more for free shipping", total, buttons, reassurance row.
- **Not verified:** the Super Admin item editor in a browser; the drawer on a phone; a theme that overrides the wording, in the browser (unit-tested).

## Update 10: compact mini cart rows, and the reviews section was not connected
- Mini cart: smaller picture (56 px), title, variant and price in small type, the remove cross at the top right with the quantity stepper directly under it, and smaller Checkout (44 px) and Continue shopping (40 px) buttons.
- **Bug found and fixed:** the product page's review section asked for `/api/storefront/reviews?productId=...` (GET) and `/api/storefront/reviews` (POST), which do not exist (the contract serves `/api/storefront/products/{productId}/reviews`), so it always showed "0 reviews" and could never list or submit a review. It now uses the real addresses. The contract's `page` and `limit` also needed `z.coerce` because query values arrive as text (without it the list answered 400). Checked in the browser: list answers 200; a submitted review is stored as "on hold" for moderation; once published it appears in the section.
- Tested: `@bs/contracts` 22/22 (path and query coercion), `@bs/web` 206/206, typecheck and lint clean.
- Not verified: the review form through the UI, moderation publishing from Store Admin and the cache refresh that should then update the summary above the title (the summary reads the product's stored average and count; I published a test review by SQL, so that refresh path was not exercised), review emails.

## Update 11: checkout look and mobile summary
- Form sections (contact, address, shipping method, payment, notes, consent) have no card borders, shadows or padding boxes any more: a section is a heading and its fields. Inputs keep a soft hairline (`border-border/60`, rounded) that darkens on hover and focus; the shipping and payment options are soft cards that tint when chosen (`has-[:checked]`). The order summary is a borderless soft grey panel (`bg-muted/60`), sticky beside the form on desktop.
- On phones the summary comes first, collapsed behind a bar ("Show order summary", the total on the right); tapping opens it. It is one component instance, so its discount code field exists once. Pricing is unchanged (`priceOrder`, recomputed on the server at checkout).
- Tested: `@bs/web` 208/208 (new `checkout-layout.test.ts`), typecheck and lint clean. Browser: desktop layout, phone summary collapsed then opened (no sideways scroll at 375 px), and a COD order placed through the new form to the thank-you page.
- Not verified: online payment (still deferred), keyboard and screen-reader pass on the collapsible bar, validation error states in the new styling.
- Checkout, follow-up: "Address Line 2" removed from the form (the API still accepts it, nothing sends it), and the form and summary tightened (smaller headings, field and option padding, gaps and item thumbnails; summary thumbnails 44 px). `@bs/web` 208/208; browser: fields are email, phone, name, address line 1, city, state, pincode, notes.

## Update 12: business order, separate shipping address, notes accordion
- **Business Order** checkbox under the contact fields opens Company Name (required) and Tax ID (GSTIN, optional, validated). They are stored on the order's `billingAddress` (`companyName`, `taxId`), shown in Store Admin's order page under a "Billing address" block, and the invoice's buyer GSTIN falls back to that `taxId` when none is given.
- **Address:** the form reads "Billing & Shipping Address" with a "Ship to a different address?" checkbox on its right. Ticked, the first form becomes "Billing Address" and a "Shipping Address" form opens with its own contact (phone required, email optional), stored in `shippingAddress` (`phone`, `email`); the buyer's own email and phone stay on the order. GST place of supply and the tax destination now follow the shipping state.
- **Order instructions** sit in a collapsed bar that opens a text box.
- **API:** `POST /api/storefront/checkout/place-order` takes optional `businessOrder` and `shipTo`; `placeOrder` re-checks them (`checkoutContactProblem`) and refuses bad input before anything is created. No migration (the address columns are JSON).
- **Tested:** `checkout-business-shipping.int.test.ts` 6/6 on real Postgres (company and GSTIN only on billing, delivery contact on shipping, buyer contact kept, supply state follows shipping, bad input creates no order), `@bs/web` 208/208, typecheck and lint clean. Browser: boxes open and close, headings change, a business order with a different delivery address was placed and stored as expected (ORD-00023).
- **Not verified:** the invoice picking up the GSTIN (code path typechecks; not run), courier or email use of the delivery contact (no courier or email is live), GST tax lines for an inter-state delivery in the demo (tax engine is off for that store), keyboard use of the new accordion.
- Checkout, follow-up: field names now sit inside the fields (floating labels: the name reads as the placeholder, then shrinks to the top edge once there is text or focus; the state list and phone number keep a small name at the top). `@bs/web` 208/208; browser: empty label 14 px, filled 11 px, phone and state small at the top.

## Update 13: customer account check, and two bugs found and fixed
- The customer account area exists: `/account` (orders list), `/account/orders/[id]`, `/account/addresses`, `/account/profile`, plus sign in (phone code or email and password), create account, forgot and reset password and verify email.
- **Bug 1:** `account/layout.tsx` wrapped every `/account/*` page in the sign-in gate, so a visitor who clicked "Create account" (or opened a password-reset or verify-email link) saw the sign-in screen again; the public pages could never be reached. The signed-in pages now live in an `(dashboard)` route group with the gate (URLs unchanged); the public pages sit outside it.
- **Bug 2:** the order detail page (`/account/orders/[id]`) crashed ("This page could not load") because a server component called `buttonVariants`, which was exported from a client module. It now lives in `packages/ui/src/components/ui/button-variants.ts` (no "use client"), exported from `@bs/ui` and `@bs/ui/server`.
- **Walked locally** (demo store, a generated test customer, no email delivered so I minted the account setup link in the local database): create account, set password on the reset page, sign in, empty orders, place an order with that email, it appears in "Orders", order detail, saved addresses (empty), profile (details and change password).
- Tested: `account-routes.test.ts` (gate placement, loading files, server-safe button class), `@bs/web` 211/211, `@bs/ui` 45/45, typecheck and lint clean.
- Seen, not fixed: the theme toggle logs a hydration mismatch on account pages (server renders "System" selected, client reads the stored choice); the order detail page shows a grand total that includes the cash-on-delivery fee without a line for it; after signing in, the sign-in form stayed on "Signing in…" until I opened /account myself (the session was set).

## Update 14: account area full width with a sidebar

- `/account/*` is full width with a left sidebar (Dashboard, Purchase History, My Reviews, Address, Profile, Notifications); on phones it is a scrolling row of pills (`AccountNav`).
- Routes: `/account` is now the Dashboard (order count, total spent, recent orders, shortcuts); the orders list moved to `/account/orders`; new `/account/reviews` (uses new domain query `getCustomerReviews`) and `/account/notifications` (read-only: order updates always on, offers and news state with a link to Profile; no message inbox yet).
- Checked in the browser as the local test customer; web typecheck, lint and `account-routes.test.ts` pass. Not run: domain heavy tests for `getCustomerReviews` (no test yet), mobile layout.

## Update 15: consolidation and gate

- Checkout: signed-in shoppers start on their default saved address (card, Edit, "Choose another address" popup, "Add a new address", "Manage addresses" to `/account/addresses`); guests get a Login link and a "Create an account" box. `place-order` accepts `createAccount` and, after the order is placed, calls `registerCustomer` (set-password email); a failure there never fails the order.
- Account: sidebar layout, `getCustomerReviews` (own reviews, any status, tenant-scoped), Notifications page is read-only.
- Fixed in the gate: four mocked tests in `storefront-catalog.test.ts` broke when listing summaries gained second image, category name and quick-add queries; the stubs now return chainable rows.
- Tests added: `getCustomerReviews` (real DB, `reviews.int.test.ts`), checkout guest/saved-address rendering (`checkout-layout.test.ts`).
- Gate results: `pnpm typecheck` 15/15, `pnpm lint` 15/15 (0 errors), `pnpm build` 6/6, `docs:check` ok; unit: blocks 150, block-editor 17, ui 45, contracts 22, web 213, admin 82, platform 105; domain `test:fast` rerun after the fix (catalog file 8/8), `test:heavy` 109 files / 2122 tests passed.
- Not run: e2e (CI on main only; no admin or sidebar labels changed), platform integration suites, the `createAccount` path end to end (no mail locally), mobile layouts of the new account, checkout and listing UI, Super Admin default-pages form in a browser.
- Untracked, not mine and not to be committed: `apps/web/.impeccable/`, `apps/admin/public/`, `apps/superadmin/public/`, `.claude/launch.json` edits: owner to decide.
