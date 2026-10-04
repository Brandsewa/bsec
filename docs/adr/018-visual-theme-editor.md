# ADR-018: Visual theme editor on the block registry

- **Status:** Accepted
- **Date:** 2026-10-01
- **Plan reference:** PLAN §5.9, §9; extends ADR-009, ADR-010

## Context
ADR-009 planned "the Puck visual editor later, on the same registry". Platform staff need to build pre-made themes, store owners need to activate one and customize it without code, and none of it may break tenant isolation, the no-merchant-code rule (ADR-010) or the storefront performance budget.

## Decision
- **Platform theme = `theme_templates`** (platform table, no RLS). `default_pages`/`default_tokens` are the **published snapshot**; `draft_pages`/`draft_tokens` are the work in progress edited in the super admin. Publish copies draft to snapshot, sets `is_active`, and bumps `version`. Unpublishing (`is_active=false`) hides a theme from stores without touching stores that already copied it.
- **Store instance = the store's own `themes`, `pages` and `page_versions` rows.** Activation copies the snapshot into them (home page as a new published page version; landing pages only if the slug is free; tokens into `themes`; `template_version` remembers what was copied). The template is never edited by a store, and a template update never overwrites a store's pages. Switching or re-applying a theme adds a page version, so the previous design is one rollback away.
- **Blocks grow, versions do not.** New layout blocks (Section, Container, Grid, FlexRow, FlexColumn) hold children in a `content` slot. Documents stay `version: 1`; validation, migration and rendering recurse through slots with hard limits (depth 6, 300 blocks per page). All other additions are optional fields with defaults, so existing documents stay valid (ADR-009 "additive only").
- **No free-form styling.** Props are enumerated (tone, spacing, width, alignment...), links are restricted to `/`, `#`, `https:`, `mailto:`, `tel:`, videos to YouTube/Vimeo/direct https files, images by media id. Block CSS lives in `@bs/blocks/blocks.css` and is driven by `--bs-*` variables that the store's brand/theme tokens set. This also fixes blocks being unstyled on the storefront (it never defined the Tailwind colour utilities the old blocks used).
- **Puck is an editing UI only.** `@bs/block-editor` converts block documents to Puck data and back (`puck-adapter`); nothing Puck-specific is stored. The editor is lazy-loaded (separate chunk) in the admin and super admin. The storefront never imports Puck: it renders with `renderBlockTree`.
- **Data-driven blocks resolve on the server.** `resolvePageRenderData` returns products/collections per block id plus media URLs, in one tenant transaction, inside the same `"use cache"` scope as the page. Pages with data blocks also carry the `product` and `collection` tenant tags, so catalog edits refresh them. The editor gets the same data through `admin.pages.blockData`.
- **Draft/publish reuses `pages`.** `savePageDraft` -> `publishPage` -> `rollbackPage` are unchanged. Publishing or rolling back a non-home page now invalidates `page:<slug>` (it previously invalidated nothing).

## Consequences
- Every new block needs: schema + defaults in the registry, a renderer in `views.tsx`, and an editor panel in `block-editor/config.tsx` (a test fails if any is missing or exposes a field the schema lacks).
- Platform mutations are audited (`theme_template.*`) and covered by the audit-coverage test; new store procedures are covered by the generated isolation suite.
- Media URLs need `CF_IMAGES_DELIVERY_URL` (Cloudflare Images) or `R2_PUBLIC_URL` on the web service; without either, image blocks show their placeholder.
- Phase 2: merge platform theme updates into a store on request (diff by block id), more page types (collection/product templates), storefront-hosted draft preview with a signed token, extra themes.

## Alternatives considered
- **Store Puck's native JSON:** couples stored data to a UI library and skips our versioning, validation and sanitizing.
- **Render with Puck `<Render>` on the storefront:** ships the editor runtime to shoppers for no benefit.
- **Per-theme code/templates (Liquid, JSX):** rejected by ADR-010.
- **Copy-on-write diffing of template updates into stores now:** deferred; version tracking plus rollback gives safety without merge complexity.

## Update: theme builder (settings, five pages, header and footer)
A theme is now **settings + five page layouts**, all built in the super admin and all copied to the store on activation.
- **Settings (tokens)** have one editable shape: `colors` (primary, secondary, accent, background, surface, text), `fonts` (heading, body from a short curated list, loaded from Google Fonts only when chosen), `radius`, and `buttons` (solid/outline/soft, own radius, uppercase). The first launch template's `typography`/`shape` keys are still read. `computeThemeTokens` sanitizes every value; a pill radius applies to buttons only so cards and images never become circles.
- **Pages** are keys of `draft_pages` / `default_pages`: `home`, `collection`, `product`, `header`, `footer`. Header and footer are blocks (`SiteHeader`, `SiteFooter`). `ProductDetail` and `CollectionListing` are the dynamic core of the product and collection pages: the editor draws labelled placeholders, the storefront injects the real components through `RenderContext` (`renderProductDetail`, `renderCollectionListing`, `renderLink`, `renderCart`). The block picker is limited by page kind.
- **Store copies** of header/footer/product/collection live in `pages` with types `header`, `footer`, `product_template`, `collection_template` and slugs `template-*`. They are never served at `/pages/<slug>`, are hidden from the Pages list, and are edited from the Themes screen. A theme that lacks one unpublishes the previous theme's copy (history kept) so the built-in layout applies. The storefront falls back to the built-in header, footer, product and collection layouts whenever a store has no published copy.
- **Who decides the look.** Tokens carry `source: "theme"` once a store activates a library theme or saves theme settings; from then on they win over Branding colours/fonts (Branding keeps logo and identity). Stores that never did keep their Branding look unchanged (`resolveThemeTokens`).
- **Store customising:** Themes screen -> theme settings (same panel as the super admin, saves immediately) and one editor per page. Re-applying a newer template version replaces settings and layouts with the new version; each page's previous layout stays in its history.
- Migration 0016 gives the launch theme the four new pages and the editable token shape (idempotent, bumps its version to 2).

## Update: product showcase and the BCOM widgets group (2026-10-02)
- **`ProductShowcase`** is a product carousel with optional **collection tabs** (two or more tabs turn the tab bar on; one tab shows none), a card whose rows (reviews, title, price) can be reordered and hidden, a category/brand badge, sale badge, compare price, "Starts from" label, and a round add-to-cart button on the image, plus the slider's arrow and dot settings and optional autoplay. Data comes from a new block-data kind `product-tabs` (one product list per tab, resolved in the same tenant transaction; single-variant products also carry their variant id for quick add). The cart button posts to the existing `/api/storefront/cart/items`, so the server prices and validates it; products with several variants open their page instead. `HeroSlider` and `ProductShowcase` live in a separate **BCOM widgets** group (editor category `bcom`) in the block list; new in-house widgets go there.

## Update: hero slider and button sizes (2026-10-02)
- **`HeroSlider`** is a store widget: up to 6 slides (image or direct .mp4/.webm background, heading, subheading, two buttons), a bottom shade, autoplay / loop / dots / arrows, all enumerated settings plus optional #rrggbb button colours (validated, never free CSS). The markup is server-rendered as a native scroll-snap track (swipe and keyboard work without JavaScript); the storefront wraps it in `HeroSliderClient` through `RenderContext.renderHeroSlider` to add autoplay, arrows, dots and video play/pause imperatively (no React re-render). Only the first slide's image is eager/high priority; videos load only for the visible and next slide, pause off screen, and are skipped on Save-Data or reduced motion.
- **Theme button size** (`buttons.size` sm/md/lg) sets the default button padding and font (`--bs-btn-pad`, `--bs-btn-fs`); a Button block or the slider can follow it ("Match theme") or pick its own.
- The block panel groups a block's many settings into **accordion sections** (`block-editor/src/sections.tsx`): display-only header fields plus gated fields, with flat stored props.

## Update: cart page and Modern Commerce theme (2026-10-02)
- **Cart is a theme page** (`cart`, store type `cart_template`, slug `template-cart`). `CartContents` is its dynamic core, like `ProductDetail`: the storefront injects the real cart through `RenderContext.renderCartContents`; the editor draws a placeholder. Items, totals, discount code and the checkout button stay in storefront code (prices are recomputed on the server); the template only places them and picks enumerated layout options (summary side, sticky summary, discount box, shipping estimator). **Checkout is deliberately not a theme page.**
- `ProductDetail` gained the optional `stickyBuyBox` prop (default off, additive, no version bump).
- A store without a published cart template keeps the built-in cart layout, as for product and collection.
- **Modern Commerce** (`modern-commerce`) is seeded as an **unpublished draft** by `pnpm --filter @bs/platform seed:templates` (needs a platform staff email). It never reaches stores until staff publish it in Super Admin.
