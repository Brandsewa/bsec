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
