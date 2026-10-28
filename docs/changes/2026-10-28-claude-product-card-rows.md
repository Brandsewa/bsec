# Product card rows for the carousel, related carousel and shop grid

- **Date:** 2026-10-28
- **Agent:** claude
- **Branch:** `feat/product-card-rows` (PR below once opened)
- **Area:** blocks, web
- **Type:** feature
- **Supersedes:** none

## Summary
Every product card now has three rows: row 1 is the review summary on the left (five stars, the average with one decimal, the count in brackets: `★★★★☆ 4.6 (12)`) and the category on the right; row 2 is the product name; row 3 is the price. This covers the Product Carousel widget, the Related Product Carousel (both are the `ProductShowcase` block) and the shop grid (collection and category listings). It follows the earlier shop-grid change in #147, which put reviews and category on one row but showed a single star.

## What changed
- `ProductShowcase` card (`ShowcaseCard` in `packages/blocks/src/views.tsx`): a new `bsb-psc-meta` row holds the rating (left) and the category (right, truncated on one line). The card order setting still orders title and price; the rating no longer moves, and "Rating" switched off hides it as before. `blocks.css` has the row styles.
- Shop grid card (`apps/web/src/components/catalog/ProductCard.tsx`): the rating shows five stars plus `4.6 (12)` instead of one star and two decimals.
- The legacy product card (`defaultCard`, used by older product blocks) shows the average next to its stars in the same format; its rows were not rearranged.
- Test `layout-blocks.test.tsx` now expects the rating before the category and the other rows.
- **Contact form fields like checkout** (`apps/web/src/components/blocks/ContactFormClient.tsx`): the same near-white `bs-field` inputs, border, radius, focus ring and 48px height as the checkout, with the name inside the field that shrinks to the top edge once there is text or focus (message box and the dropdown included). Required fields end in `*` (the old "(optional)" wording is gone); the "text alignment" setting still aligns the typed text. The editor's sample boxes got matching heights.
- **Coupon cards** (`apps/web/src/components/product/CouponCards.tsx`): compact on every screen size (10px padding, 6px between rows, about 93px tall) with three rows: what it gives on the left with "Ends 28 Oct 2027" on the right; the description (title and minimum-order text joined with a dot); the code with a copy icon button. Two cards per row on desktop, tablet and phone (it was one on phones); the "View all" drawer uses the same card, one per row. The copy button is a 25px square in light grey (`.bs-copy` in `globals.css`: a faint tint of the text colour, muted grey icon, darker on hover); after a press the icon becomes a tick for about two seconds and its accessible label reads "Copied". The icons are drawn by the server component and swapped with CSS, and the colours are CSS too, so the client button is tiny for the product page's JS budget. A row still wraps rather than cutting text if a code is too long. New test `apps/web/test/coupon-cards.test.tsx`.
- **Account menu in the header** (`storefront/AccountLink.tsx`, `storefront/AccountMenu.tsx`, `account/account-icons.ts`): when a customer is signed in the header button shows the photo or icon, the first name and a small arrow, and opens a menu with icons: Account (the dashboard), Orders, Profile, Address, Reviews, Notifications, then a divider and Logout. Desktop (1024px and up): a small dropdown under the button. Tablet and phone: a drawer that slides in from the right at 90% of the screen width with a dimmed backdrop, a "Hi, name" header and a close button; the page behind does not scroll, and the drawer covers the bottom navigation. Best practices followed: button with `aria-haspopup="menu"`/`aria-expanded`; menu role with menu items; arrows, Home, End move between items, Escape closes and returns focus to the button, Tab leaves the menu, outside click and the backdrop close it, the current page is marked `aria-current`; opening focuses the first item; it closes on navigation; the menu is drawn on the page body (the sticky header would cap its stacking level under the bottom navigation); slide animation is off for reduced motion; Logout posts to the existing sign-out API, disables Google auto sign-in and refreshes. Signed-out visitors still see "Login" as a plain link. The account sidebar and dashboard tile now say "Orders" instead of "Purchase History" (the route is unchanged); the sidebar's other labels are as before.
- **Header script size (product page JS budget):** the menu's code loads on first open, and to pay for the button's extra code the plain user icon is drawn by the server (`ThemeChrome`), and the avatar, the arrow, and the cart button's and count's long utility classes moved to CSS (`.bs-av`, `button.bsb-site-account::after`, `.bs-cart-pill`, `.bs-cart-count` in `globals.css`). The product page JS is again just under 50 KB, so there is still almost no headroom.
- **Gallery widget, no sample text:** a new Gallery no longer starts with the heading "Lookbook" (`GalleryBlock.defaultProps` is empty), and a Gallery with no pictures draws nothing on the storefront, heading included (the editors show "Add pictures to this gallery" so it can still be found). Galleries that already saved a heading or description keep them. New test `gallery-empty.test.tsx`.

## Decisions and trade-offs
- Pinning the rating to row 1 changes what "card order" means for existing blocks that put the rating after the title or price: their rating now moves up. That is what the owner asked for; it is not a data migration (props are unchanged).
- A product with no reviews shows only the category, on the right.

## Verification
- Ran: `pnpm typecheck` (15 of 15), `pnpm lint` (0 errors), blocks tests (261), `pnpm docs:check`.
- Exercised by hand (local `demo-store`): shop grid card shows `★★★★★ 4.7 (9)` left and the category right; the related carousel card on a product page shows category on the right and title and price below; with a rating added to that card the rating sits at the left edge and the category at the right edge on one line.
- NOT verified: the account menu with a real signed-in customer (the browser check stubbed the profile response in the page, so the links were not followed and Logout was not pressed), an unread count on Notifications (there is no unread-count API yet), a Google profile photo in the button, a Product Carousel on a home page (the demo store has none, so the related carousel stood in; both use the same card), narrow phone widths with a long category name beyond the CSS ellipsis check, and the editor's card order panel.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 10)
- [x] ADR: not needed
