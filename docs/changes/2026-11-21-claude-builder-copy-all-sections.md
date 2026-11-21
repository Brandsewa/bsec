# Builder: Copy all sections, per-section Copy, distinct icons

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `feat/builder-copy-all-sections`
- **Area:** block-editor
- **Type:** feature
- **Supersedes:** none (follows `2026-11-21-claude-builder-copy-paste-delete.md`, merged in #303)

## Summary
The Outline's top Copy button copied only the selected element, and looked almost the same as Puck's Duplicate icon. Now the top button copies every section on the page, each Outline row has its own Copy button for just that section, and the three copy icons (Copy all, Copy section, Duplicate) are visibly different.

## What changed
- `packages/block-editor/src/OutlineActions.tsx`
  - Top button is **Copy all sections** (stack-of-layers icon): copies all top-level sections of the current page, with their nested elements and settings. Disabled when the page is empty.
  - Every Outline row gets a **Copy this section** button (clipboard-with-arrow icon) placed just before Puck's own Duplicate and Delete, shown on row hover like they are. Puck's row actions are not overridable, so the button is added to the row's DOM by a debounced `MutationObserver` and removed on unmount; it reads the latest page through a ref and copies that row's element with its subtree, without changing the selection.
  - Paste icon is now a clipboard with a down arrow. The right-click menu keeps Copy (the selected element), Paste, Duplicate, Delete, and Paste says what it holds ("Paste 5 sections" / "Paste Section").
  - Paste of a copied page inserts all sections, with fresh ids, at the top level right after the top-level section holding the selection (or at the end of the page when nothing is selected). It works on a different page because the clipboard survives page switches. One `setData` with `recordHistory`, so Undo and Redo treat it as one step.
- `packages/block-editor/src/section-clipboard.ts`: the clipboard holds `{ kind: "item" | "page", items }` (storage key `bs:builder-clipboard:v2`; the v1 key from #303 is no longer read, so an old copied element is simply gone). New pure helpers `findById` and `topLevelInsertIndex`.
- `packages/block-editor/test/section-clipboard.test.ts`: tests for both helpers.

## Decisions and trade-offs
- Row buttons are DOM-injected because Puck 0.23 renders its row actions internally. It is a small, self-cleaning hack; re-check the selectors (`Layer-content`, `LayerActions`) if Puck is upgraded.
- Copy all copies only the top-level list, so pasting it elsewhere reproduces the page's section order exactly; it never nests the pasted sections inside a selected container.
- The old stored single-element clipboard is dropped rather than migrated; the feature was a few hours old.

## Verification
- Ran: `pnpm typecheck`, `pnpm test` (40 pass) and `pnpm lint` (0 errors) in `@bs/block-editor`.
- Exercised by hand in the Browser pane with a temporary harness rendering `BlockEditor` with three Section > Container > Heading sections (harness deleted afterwards): Copy all showed "3 sections copied", Paste showed "Paste 3 sections" and took the page from 3 to 6 top-level sections with unique ids; the row Copy button copied just that section (clipboard `kind: item`, one item) and Paste added one section; the hovered row shows [Copy section][Duplicate][Delete] and the header shows distinct icons.
- NOT verified: inside the real Super Admin / store admin editors, pasting a copied page into a different page of a multi-page workspace (the code path is the same, the clipboard is module level), Undo/Redo of a pasted page (same `setData` path as #303), the 375 px layout, row button on touch devices (no hover).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, no structure, route, table or env change
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
- Optional: Ctrl+C / Ctrl+V.
- Touch devices have no hover, so the row Copy button (like Puck's own row actions) only appears with a pointer.

## Definition of done
Gate for `@bs/block-editor` run (typecheck, lint, test); the full repo gate (`pnpm build`, `docs:check`) is left to the pre-push hook and CI. No secrets or generated files in this change.
