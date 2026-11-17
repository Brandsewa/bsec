# Theme editor: page switch no longer saves the old page's blocks

- **Date:** 2026-11-17
- **Agent:** Claude Code
- **Branch:** `fix/editor-page-switch-stale-blocks`
- **Type:** fix

## What and why
On a live store, the Header page ended up holding a Gallery (header gone, "Lookbook" on every page) and Home was saved empty with a Blog archive block. Cause: `PageVisualEditor` hands `BlockEditor` the page's blocks once (`useState(initialFromProps)`), and the route component is reused when only `$pageId` changes. For an already-opened (cached) page the editor stayed mounted with the previous page's blocks, and Save draft / Publish sent them to the new page id.

Fix: `key={pageId}` on `PageVisualEditor` in the route, `key={page.id}` on `BlockEditor`, and a guard that shows the skeleton when the loaded page id differs from the route's. Source-level regression test `apps/admin/test/page-editor-switch.test.tsx`.

## Not done / open questions
- Not exercised in a browser; verify by opening Home, switching to Header and Gallery, and checking the canvas shows each page's own blocks.
- The live store was repaired by hand (header re-added, Home rolled back to its 16 Nov 07:05 version); the admin has no version-restore button.

## Definition of done
- [x] Gate: see PR. No schema, API, env or architecture change.

## Verification
- `pnpm --filter @bs/admin exec vitest run test/page-editor-switch.test.tsx`: 2 passed.
- `pnpm --filter @bs/admin typecheck` and `lint`: clean.
- `pnpm docs:check`: run after adding this section.
- Not run: full `pnpm build`, the browser walkthrough above.
