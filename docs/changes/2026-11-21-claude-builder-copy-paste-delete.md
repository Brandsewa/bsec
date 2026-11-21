# Copy, Paste and Delete buttons in the page builder Outline

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `docs/go-live-hardening-plan` (working tree, not committed, not merged yet)
- **Area:** block-editor
- **Type:** feature
- **Supersedes:** none

## Summary
The native page builder (Puck) had Duplicate and Delete only in the floating bar over the canvas. The Outline panel now has Copy, Paste and Delete buttons beside its title, so a whole section (or any element) can be copied, reused elsewhere on the page or on another page of the same workspace, and removed after a confirmation.

## What changed
- `packages/block-editor/src/OutlineActions.tsx`: the three buttons, a "Section copied / pasted" toast and a delete confirmation dialog. Hooked in through Puck's `outline` override in `BlockEditor.tsx`, so no builder state or save path changed.
- `packages/block-editor/src/section-clipboard.ts`: the clipboard (module level, mirrored to `localStorage`, so it survives page switches and a reload), `cloneWithNewIds` (every nested element gets a fresh id), `insertIntoZone` (pure insert at the page level or into any slot), `countNested`.
- Copy takes the selected element with its whole subtree and all props (content, styles, responsive settings). Paste inserts a fresh-id copy right after the selected element in the same zone, or at the end of the page when nothing is selected, and selects it. Paste is disabled until something is copied. Delete is disabled with no selection; the dialog names the element and how many elements sit inside it.
- Right-click menu (Copy, Paste, Duplicate, Delete) on Outline rows and on canvas elements: right-click selects the element first, then opens the menu at the pointer (mapped through the canvas iframe's scale). Escape or a click elsewhere closes it. The logic lives in an always-mounted `SectionActionsProvider` (in Puck's `puck` override), so the canvas menu works on any sidebar tab; the Outline buttons use it through context. Duplicate is Puck's own `duplicate` action.
- Paste is one `setData` with `recordHistory: true`, so Undo and Redo treat it as one step. Delete uses Puck's own `remove` action.

## Decisions and trade-offs
- Paste uses `setData`, not Puck's `insert` + `replace`: `replace` dropped the nested slot content of a pasted Section in practice. It also keeps the "wrap a dropped widget in Section > Container" rule (`onAction`) out of the way, since that only reacts to `insert`.
- The clipboard is per browser (localStorage), not the system clipboard, to avoid permission prompts. Pasting into a different store's editor in the same browser also works; it is plain JSON of the element.
- The confirmation is a small inline dialog because `@bs/block-editor` cannot import the admin's `confirm-dialog`.

## Verification
- Ran: `pnpm typecheck` pass and `pnpm test` 34 pass in `@bs/block-editor` (new `test/section-clipboard.test.ts`); `pnpm lint` 0 errors (3 existing warnings in files I did not touch).
- Exercised by hand in the Browser pane with a temporary harness page (deleted afterwards) rendering `BlockEditor` with two Section > Container sections: copy with toast, paste (new Section appears in the canvas and Outline, selected, with its Container and content), Undo removes it, Redo restores it, Delete shows the confirmation ("the Section and the 2 elements inside it"), Delete removes it and the saved draft no longer contains it. Context menu: right-click on an Outline row and on a canvas element selects it and opens the menu; Duplicate added a third section; Paste on a selected Heading put a copy of a Section inside its Container (nested paste), selected.
- NOT verified: inside the real Super Admin / store admin editors (the full dev stack was not running), Delete from the context menu and Escape/click-away closing (code only), the 375 px layout of the Outline buttons, keyboard shortcuts (none added).

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed, no structure, route, table or env change
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
- Optional: Ctrl+C / Ctrl+V on the selected element.
- The Outline buttons are positioned by CSS next to Puck's own collapse-all button; re-check if Puck is upgraded.

## Definition of done
Gate for `@bs/block-editor` run (typecheck, lint, test); the full repo gate (`pnpm build`, `docs:check`) was not run. No secrets or generated files in this change.
