# Builder canvas: Blocks in a row stack and the image leaves the page

- **Date:** 2026-10-27
- **Agent:** claude
- **Branch:** `fix/editor-block-row`
- **Area:** block-editor (canvas CSS), blocks
- **Type:** fix
- **Supersedes:** none

## Summary
In the builder a Container set to a row still showed its Blocks stacked, and the Block holding an image sat outside the page. The storefront was correct. The canvas stylesheet (`compact.ts`) sizes the wrapper element Puck puts around each Block, and it detected a stacked slot with `[style*="column"]`, which also matches `column-gap: 3rem` in the slot's inline style, so any Container with a column gap forced every Block to `flex: 0 0 100%`.

## What changed
- `packages/blocks/src/bricks-layout.ts`: `slotBasisVars(props)` returns `--slot-fb-d/-t/-m` (`0%` for a row, `auto` once stacked) from the per-device direction.
- `packages/blocks/src/views.tsx`: Section, Container and Block slots publish those variables.
- `packages/block-editor/src/compact.ts`: wrappers use `flex: 1 1 var(--slot-fb)` chosen by the canvas width; the text-sniffing and the fixed 100% mobile rule are removed. A Block fills its wrapper, so its percentage width is no longer taken of the wrapper.
- `packages/blocks/test/block-row-widths.test.tsx`: tests for the variables, including the column-gap case.

## Verification
- Mounted the real `BlockEditor` in a throwaway Vite page (not committed) with Section > Container (row, 3rem gap) > Block + Block(Image) and measured the canvas: before, both wrappers 1200px wide and the second at x=1280 (off the page); after, 576px each side by side, no horizontal overflow, the image inside its block. Forcing the slot to a column gave both Blocks 1200px wide.
- Not run: tablet/mobile viewports in the real editor, `test:heavy`, e2e, the owner's page.

## Open questions
- Siblings in a row share the line equally on the canvas; a 30/70 split (different Block widths) shows correctly on the storefront but as 50/50 in the builder, because the wrapper element is the flex item there. Fixing it needs the wrapper to read the Block's width.
