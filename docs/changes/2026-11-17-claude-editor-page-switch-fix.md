# Theme editor: a page switch no longer saves the old page's blocks

- **Date:** 2026-11-17
- **Agent:** claude
- **Branch:** `fix/editor-page-switch-stale-blocks` (not merged yet)
- **Area:** admin
- **Type:** fix
- **Supersedes:** none

## Summary
On a live store the Header page ended up holding a Gallery (header gone, "Lookbook" on every page) and Home was saved empty with a Blog archive block. `PageVisualEditor` hands `BlockEditor` the page's blocks once (`useState(initialFromProps)`), and the route component is reused when only `$pageId` changes. For an already-opened (cached) page the editor stayed mounted with the previous page's blocks, and Save draft / Publish sent them to the new page id.

## What changed
- `apps/admin/src/routes/_editor/online-store/editor/$pageId.tsx`: `key={pageId}` on `PageVisualEditor`.
- `apps/admin/src/components/page-editor/PageVisualEditor.tsx`: `key={page.id}` on `BlockEditor`, and the skeleton shows when the loaded page id differs from the route's.
- New `apps/admin/test/page-editor-switch.test.tsx`.

## Decisions and trade-offs
The test is source-level (checks the keys and guard exist) because rendering the Puck editor in a unit test is heavy. A browser walkthrough is the real check.

## Verification
- `pnpm --filter @bs/admin exec vitest run test/page-editor-switch.test.tsx`: 2 pass.
- `pnpm --filter @bs/admin typecheck` and `lint`: clean.
- NOT verified: full `pnpm build`, and a browser walkthrough (open Home, switch to Header and Gallery, check each canvas shows its own blocks).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, no structure change
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
- The live store was repaired by hand (header re-added, Home rolled back to its 16 Nov 07:05 version). The admin has no version-restore button.

## Definition of done
No schema, API, env or secrets changes; one regression test added; gate partly run (see Verification).
