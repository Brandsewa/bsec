# Updates batch (logged, not started)

Status: items 14 to 19 built (#211); items 1, 4, 7, 8, 9, 11, 12, 13 and part of 2 were already in main; item 10 (link hover), 3, 5 and 6 not verified or built.

## 1. Multi card: "Internal server error" on save (About Us page)

Reported: in the theme builder, the Multi card block works on the home page, but on the About Us page, entering a heading and text in a card and saving gives "Internal server error".

Finding so far (read only, not verified by running it): `MultiCardItemSchema.text` is `max(400)` in `packages/blocks/src/registry.ts:1586`. The first card's text in the screenshot is about 420 characters, so the page likely fails block validation on save. Two things to check when building:
- Confirm the length is the cause by reproducing locally.
- A validation failure should come back as a clear field error, not a 500. Find where the save path turns the schema error into a 500.

Possible fixes (owner decides): raise the text limit, and/or show a character counter in the editor, and/or return a 400 with the field name.

## 2. Blog archive header layout (all blog/archive category pages)

Reported (screenshot: "Wholesale & Bulk Teas" archive): the heading, description and category filter tabs sit side by side and push against each other.

Wanted layout, same rule for every blog or archive category page:
- Desktop: one row with the heading in one column and the description in the other (owner's words: "header on the right column, on the left column description"), and below that row only the category filter tabs.
- Mobile (and desktop stacking): everything stacked: heading, description, category filters.

Open question: the message names the heading as the right column and the description as the left. Confirm whether the heading should really sit on the right, or on the left with the description beside it.

## 3. Storefront header: nested menu dropdowns not showing

Reported: nested items were created in the admin menu (Header Menu: Home, Shop, Private Label Tea > Low MOQ Private Label Tea, Wholesale > Bulk Tea Export, Tea Dropship). The admin header preview shows the dropdown arrows, but the live storefront header does not load the dropdowns. Owner asked to find and fix the cause (to be done at build time).

What the screenshots show: the storefront header lists only Home, Shop and Private Label Tea. Wholesale and Tea Dropship are missing entirely, and Private Label Tea shows no dropdown arrow. So the storefront may be rendering stale or flat menu data, or only reading top-level items.

To check when building: how the storefront loads and caches the header menu (cache tag and invalidation on menu save), whether children are returned by the Store API and the domain service, whether the header block renders children and dropdown UI on desktop and mobile, and whether the menu needs publishing or only saving. Also check for another menu assigned to the header than "Header Menu".

## 4. Admin Blog list: post counts on the status tabs

Requested: on the Blog page in the admin dashboard, show a small number counter inside each status tab (All, Published, Scheduled, Drafts) with the number of posts in that status.

Notes for building: counts must cover all posts in the store, not just the loaded page, so they likely need a count query in the domain service and the contract (tenant scoped). Counts should update after publish, schedule, delete or status change. Follow `docs/admin-ui-standards.md` for the tab and badge styling.

## 5. Theme settings colours: hex field not editable by typing

Reported: in theme settings > Colors, a colour can only be changed with the picker (swatch/colour wheel). The hex text field (e.g. "#334155" under "Text: Body text on light background") cannot be typed into.

Wanted: every colour field in the Colors section, and any other colour field in the theme builder, must accept manual typing of a hex value alongside the picker, with the swatch and picker staying in sync.

Notes for building: find the shared colour input component and fix it there so all colour fields benefit. Handle partial typing (allow `#` and 3 or 6 digits, only commit valid hex, show an error or revert on invalid). Values must still pass `hexColorSchema` in `packages/blocks`.

## 6. Collection grid (and other custom blocks): transparent background by default

Reported (screenshot: collection grid "Private Label, Wholesale & Tea Dropshipping Services"): the block paints a fixed background colour and has no option to change it. Changing the colour of the container it sits in has no effect on it.

Wanted:
- Collection grid: background transparent by default, so it follows the container's colour. No new colour option needed.
- Audit the other custom blocks (at least product carousel and related product sections, then the rest of our custom widgets): any block that sets a fixed background and has no per-block background option should become transparent. Blocks that already have their own background colour setting stay as they are.

Notes for building: check the block views and CSS in `packages/blocks` for hard-coded backgrounds (including `bsb-tone-*` classes), list which blocks were changed, and check text contrast still holds on light and dark containers. Block schema defaults may need a version bump only if saved props change (ADR-009).

## 7. Blog post page: table of contents shows H2 only, sticky on mobile

Reported (screenshots: desktop post with left-hand table of contents, mobile post with collapsed "Table of contents" accordion):
- The table of contents currently lists H2 and also lower headings (the FAQ questions appear indented under "Frequently Asked Questions"). It should list H2 headings only and ignore H3, H4 and below.
- On mobile (REVISED by owner, replaces the earlier "sticky at the top"): the table of contents is open by default at its normal place in the post. Once the reader scrolls down past it, it collapses into a bar stuck to the bottom of the screen, just above the mobile bottom navigation (Home, Explore, Search, Cart). Tapping the bar opens the list so the reader can jump to a section; it closes again after jumping or on tap.

Notes for building:
- Where the heading list is built (blog post renderer or block), filter to level 2. Check the anchor ids and the scroll-spy/active-section highlight still work, and that a post with no H2 hides the table of contents.
- Mobile bottom bar: position it above the bottom navigation (read its height, including the safe-area inset), make sure it does not overlap or fight other bottom elements (cookie banner, any floating buttons), let the opened list scroll if long and cap its height. Show it only after the inline one scrolls out of view. Applies to every blog post.
- Mind the storefront JS budget (project memory: product page budget is tight; check that this page's budget is not affected).

## 8. Slider pagination dots (pill style): subtler, smaller, theme-coloured

Reported (screenshot: slider with four pill-shaped dots, the active one dark and wide): across the whole website, wherever this flat pill-style slider pagination is used, it should use theme colours, be subtle, and be shorter and smaller, barely visible so it does not pop out.

Wanted:
- Colour from theme tokens (muted tone of the text/brand colour for inactive, slightly stronger for active), not hard-coded greys or near-black.
- Narrower and thinner pills, lower contrast, so they read as a quiet hint.

Notes for building: find every slider that renders these dots (multi card, product carousel, hero/slider blocks, testimonials, anything using `dots`/`dotsColor` or the `bsb-psc` slider styles in `packages/blocks`) and fix them through one shared style rather than per block. Decide what happens to the existing `dotsColor` option (light / dark / brand) so it still works. Keep a tap target reasonable on mobile even if the visible pill is tiny, and keep the active state distinguishable (contrast and accessibility).

## 9. Section header (title, description, link): 60/40 columns, no link underline, global

Reported (screenshot: collection grid header, "Private Label, Wholesale & Tea Dropshipping Services" with description and an "Explore Collections ->" link): a long title runs across almost the whole width and pushes the link to the far edge.

Wanted, global across every custom widget that uses this title + description + link header:
- Two columns: left column 60% holds the title and description; right column 40% holds the link/button (for example "Explore Collections").
- Remove the underline from the link.

Notes for building: find the shared section header used by the custom blocks (collection grid, product carousel, multi card, and any others with `title`, `subtitle` and a link or button) and change it once rather than per block. Decide where the link sits inside its 40% (right-aligned, vertically aligned with the title or the bottom of the description is assumed) and what happens on mobile (stack: title, description, link, matching item 2's stacking idea). Keep link hover/focus states visible without the underline (colour change or arrow movement), for accessibility. Long titles must wrap inside the 60% column.

## 10. Links: no underline on hover, muted colour instead (whole storefront)

Reported (screenshot: blog "Related posts", the hovered post title is underlined): across the entire website, hovering a link shows an underline.

Wanted: no underline on hover anywhere. Instead the link text colour becomes a little muted on hover. Applies to all links on the storefront (nav, blog, cards, footer, buttons styled as links, content links).

Notes for building:
- Fix it in the global storefront styles and the block CSS (`packages/blocks`, storefront theme CSS), not link by link. Search for `underline` and `text-decoration` in hover/focus rules.
- Related to item 9 (section header link, no underline): same rule, build them together.
- Keep a clear keyboard focus style (focus ring) so links are still discoverable, and keep links inside long body text (blog post content) distinguishable at rest, since removing underline on hover must not hide where the links are. Owner to confirm whether body-text links keep an underline at rest.
- Hover colour should come from theme tokens (muted version of the link/text colour), and work on light and dark tones.

## 11. Product page: remove the Description / Shipping & returns tabs section

Reported (screenshot: product page section with "Description" and "Shipping & returns" tabs on the left and a placeholder picture on the right): this section was built earlier and should now be removed completely, on every product single page and in the product single template, now and for any product page in future.

Notes for building:
- Remove it from the product page template and block set (view, registration, editor config, default templates, theme presets) so it cannot be added or rendered again. Stored pages/templates that already contain the block must not break: decide on a safe way to drop or ignore it (a block migration or the renderer skipping it) per ADR-009, and tell the owner which way was chosen.
- Check what content powers it (product description, shipping and returns text/settings) and make sure the product description is still shown somewhere on the product page after the tabs are gone; otherwise the description would disappear. Owner to confirm where the description should live.
- Also check the product page JS budget memory: removing it should help, but verify.
- Update tests, e2e selectors, and `docs/ARCHITECTURE.md` if the block or template list changes.

## 12. Hero slider (mobile): no empty white space when a slide has no text or button

Reported (screenshot, mobile): a hero slider slide with only a video/picture and no title, text or button still shows a blank white block under the media. The space looks like it is reserved for the text and link area.

Wanted: if a slide has no title, text, button or any other content, do not render the content area at all, so no blank space appears under the media. Slides that do have content keep their current layout.

Notes for building: check the hero/slider view in `packages/blocks` (the content wrapper, its padding, min-height and the slide height logic on mobile). Check every slide in a slider independently, since one slide can have text and the next not, without making slider height jump awkwardly. Also check desktop for the same empty wrapper, and any other custom block that reserves space for optional content (apply the same rule if found, and list them). Confirm the "product hero slider" naming: the owner called it the custom product hero slider; find the exact block.

## 13. Empty cart: "Browse categories" button linking to the categories archive

Reported (screenshot: cart drawer, "Your cart is empty." with a "Browse collections" button): the button currently goes to the collection archive page.

Wanted: by default the button reads "Browse categories" and goes to the categories archive page.

Notes for building: find the empty-cart state (cart drawer, and the cart page if it has its own empty state) and its label and href. Confirm which route is the "categories archive" in the storefront (a categories index page versus the collections index); if the route does not exist or the product categories and collections are the same thing, tell the owner before building. If the label or link is a store setting or block prop, change the default and note that stores that already saved a value keep theirs. Check the text in the tests and e2e selectors.

## 14. Super Admin Storefront > Settings: inside sidebar layout like the store admin

Reported: Settings should look like the customer (store admin) settings section: an inside sidebar listing the sections, with the selected section's content on the right. More sections will be added later. Today it is an index of cards that open separate screens.

Notes for building: reuse the store admin's settings layout (inner sidebar + content pane) in the Super Admin; sections now: Website visibility, Search engines, Customer privacy (Policies is removed, see item 16). Keep the routes under `/storefront/settings/...`.

## 15. Maintenance and coming-soon: hide header and footer

Reported: with Website visibility set to Maintenance, the public site shows the maintenance message but still shows the header and the footer. They should be hidden.

Notes for building: `PageFrame` and the home page draw `HomeNav` and `HomeFooter` around the holding block (`siteHold()` in `apps/web/src/components/marketing/home/SiteHold.tsx`). When a hold applies, render only the holding screen (no nav, no footer, no announcement bar from the layout). Check coming soon too, and that `/signup` and login stay untouched. Open question: should coming soon also hide them? Assumed yes for both.

## 16. Remove Policies from Super Admin Settings

Reported: remove the Policies section altogether from the Super Admin. There will be many different policy pages, so a fixed set will not cover it. The owner will create them manually as pages and link them from the footer.

Notes for building: remove the Policies screen, card and routes from the Super Admin; stop the public Terms, Privacy, Refund and Delivery pages from reading a published policy (they go back to their built-in text), and remove or leave unused the `marketing.policies` API (decide: removing the contract and handlers is cleaner). Existing drafts or published policy rows on the website record need a decision (leave them, they would be ignored). The footer must stay linkable to custom pages: the Footer tab's link columns already take any URL (`/pages/<slug>`).

## 17. Builder Theme settings: bring back design settings (layout, colours, fonts, cards, others)

Reported: the Theme tab for the website only has the announcement bar. Bring back the design settings the customer panel has (layout, colours, fonts, cards and other design elements) so the site can be customised with them. "Bring only what is needed."

Notes for building: this reverses my earlier decision (the website kept one fixed design). The store's `ThemeSettingsPanel` and tokens (`--bs-*`) would need to drive the website's own palette (`--pri`, `--bg`, `--ink`... in `marketing.css`) and fonts, saved on the website record and read by `apps/web` for the marketing host. Needs an owner decision on which groups are "needed" (colours and fonts are the obvious ones; layout width, corner radius, buttons, cards) and whether light and dark both get colour settings. Announcement bar stays in the same tab.

## 18. Builder sidebar: remove the Header and Footer tabs

Reported: remove the Header and Footer tabs from the builder's left rail. The header and footer can already be edited by switching to them with the page switcher in the toolbar, so the tabs are redundant.

Notes for building: in `BlockEditor.tsx` the website plugins list (Theme, Header, Footer, Blocks, Outline) drops the two tabs, leaving Theme, Blocks, Outline. The Header and Footer pages stay editable through the switcher; their settings are edited on the canvas when the page being edited is the header or footer itself (`editing`), so check that every setting (menu, buttons, brand, link columns, legal line) is still reachable there, not only through the removed tabs. The `MkHeaderPanel` and `MkFooterPanel` components would be unused unless the header and footer pages show them in the side panel; decide when building.

## 19. Website footer: collapsible link columns on tablet and mobile

Reported (mobile screenshot of bcom.si footer): the footer link columns (Product, Company, Legal) are always open. On tablet and mobile they should be collapsible, like the footer of the main (store) template.

Notes for building: applies to the `MkFooter` block view and the built-in footer (`BuiltInFooter`), so both look the same. Reuse the store footer's collapsible pattern (find it in `SiteFooter` in `packages/blocks`), with accordion headings on small screens and open columns on desktop; keep it working without JavaScript where the store version does, and keep the editor canvas preview in step.
