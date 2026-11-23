# AI access: categories, collections, blog, website pages, menus and redirects

- **Date:** 2026-11-23
- **Agent:** claude
- **Branch:** `feat/ai-content-tools` (not merged yet)
- **Area:** agent-capabilities, domain (matrix, page block helpers, usage meter list), contracts, admin (Settings > AI access)
- **Type:** feature
- **Supersedes:** none

## Summary
After the whole product, the same was done for the rest of the store's content (`docs/MCP-CONTENT-MAP.md`): categories, collections in full, blog posts and blog categories, website pages (text, links, sections), menus and the redirect manager can be read, added, edited, published and deleted by an AI app, under their own permission rows in Settings > AI access.

## What changed
- New permission rows (read, write, delete) for Categories, Blog posts, Website pages and Redirects; the Collections delete cell is now a real switch. All new cells are off for existing stores. `storePermissionFor` maps them to products.* (categories, collections) and content.write (blog, pages, redirects).
- 42 new or expanded tools: categories (`get_category`, create, update, delete), collections (full fields, `set_collection_products`, `delete_collection`), blog (list, get, create draft, update, publish or schedule, unpublish, copy, delete; blog categories), pages (`list_pages`, `get_page` outline, `get_page_block`, `list_block_types`, `describe_block_type`, create, update, `set_page_block_props`, `add_page_block`, `move_page_block`, `remove_page_block`, `set_page_block_hidden`, publish, unpublish, delete), menus (list, get, create, update, delete), redirects (list, create, update, delete).
- Page edits go to the page's draft through `savePageDraft` (the page builder's own validation); the live page changes only on `publish_page`. New domain helper `packages/domain/src/ai/page-blocks.ts` (store block types, a type's props as JSON schema, pure tree edits).
- Capability layer: new optional `alsoNeeds` (a second store permission; `publish_page` needs `theme.publish` as well as the publish switch).
- The "Allow publishing" switch now covers blog posts, pages and menu edits; the approve screen, the admin text and the change log labels were updated.
- Usage meter (`WRITE_TOOL_NAMES`) lists every new write tool.

## Decisions and trade-offs
- **Delete of live content (owner decision needed, surfaced in the PR):** blog posts, pages, collections and redirects have no recycle bin, so "delete" is permanent. The AI may only delete an item that is already hidden (draft, unpublished, inactive), with `confirm: true`; to remove live content it hides it first. Products still only archive. The store's own guards (home and system pages, children, menu links, products in a category) apply on top.
- Menus have no draft, so `update_menu` is treated as publishing (needs the switch). Only navigation menus are offered, not filter menus.
- Redirect destinations accept store paths only, so an AI app cannot send visitors to another website.
- Blog body accepts HTML but goes through the store's safe-text filter; no markdown conversion was added (it would need `@bs/blocks` in the capability package).
- Page props are validated by the existing block schemas, not by a second copy of the rules; `describe_block_type` generates the description from the same schemas.

## Verification
- Ran: `tsc` on domain, agent-capabilities, contracts and mcp (clean); eslint on agent-capabilities and `domain/src/ai` (clean); `packages/domain/test/ai-matrix.test.ts` and new `ai-page-blocks.test.ts` pass; `registry.test.ts` passes (names unique, write list equals the usage meter list).
- Real database (local Postgres, port 55432): `agent-capabilities` suites 38 pass, including 12 new tests in `content-full.int.test.ts` (permission rows, categories, collections, blog, pages draft versus live, publish permission, menus, redirects, audit).
- NOT verified: the admin screen in a browser (the admin typecheck shows route-tree errors for the redirects page that come from a stale generated `routeTree.gen.ts` in this worktree, not from this change); against the real Claude chat or the production store; the heavy domain suite and e2e were not re-run.

## Docs updated
- [x] `docs/MCP-CONTENT-MAP.md` (new), `docs/ARCHITECTURE.md` section 24
- [x] ADR not needed (extends ADR-050)
- [x] `progress.md`

## Follow-ups and open questions
- Owner: confirm the delete rule above (only hidden items, with confirm).
- Not covered: bulk edit, restoring an old page version, image upload or by URL, filter menus, importing redirects.

## Definition of done
Gate steps run before the PR is opened.
