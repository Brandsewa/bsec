# Block with a background image collapses on mobile and overlaps the next section

- **Date:** 2026-10-26
- **Agent:** claude
- **Branch:** `fix/mobile-block-height`
- **Area:** blocks (CSS)
- **Type:** fix
- **Supersedes:** none

## Summary
`BlockView` sets `flex: 1 1 0` inline so sibling Blocks share a row. When the parent Container stacks to a column on mobile, that flex-basis of 0 replaces the Block's `height`, and the flex `min-height: auto` floor is 0 when the only content is the absolutely positioned background image. The Block rendered 0px tall and its image painted over the section below.

## What changed
- `packages/blocks/src/blocks.css`: `.brxe-block.brx-resp` uses the resolved device height (`--b-h`) as a `min-height` floor unless a min-height is set.

## Verification
- Reproduced with the real `blocks.css` at 375px: Block height 0 (height 300 set) before, 300 after. Desktop row layout unchanged by construction (the height was already applied there).
- Not run: the full gate (CSS-only change), a real store page, `test:heavy`, e2e.

## Open questions
- An Image element (not a background) overlapping on mobile was reported too; the cause there was not reproduced. Needs the page's Block/Image size settings per device.
