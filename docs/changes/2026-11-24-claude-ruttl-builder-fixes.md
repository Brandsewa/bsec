# Builder fixes from the Ruttl board: fonts, weight, display per device, rich text, long media URLs

- **Date:** 2026-11-24
- **Agent:** claude
- **Branch:** `fix/builder-ruttl-fixes-2026-11-24`  (not merged yet)
- **Area:** blocks, block-editor
- **Type:** fix
- **Supersedes:** none

## Summary
Six tickets filed on the BCOM Ruttl board (project `0fRYAZqvnd7L29QYWUhA`) against the website builder. The Typography panel saved a font and weight but the heading's own stylesheet overrode them, and the picker offered fonts the storefront never loads. `display` was desktop-only and the inner slot was hard-coded to flex. The Text field's Bold and Italic only ever wrapped more asterisks and showed no result. Card text was a plain textarea. A long media URL pushed the Remove button out of the panel.

## What changed
- **Font and weight (tickets "font weight" and "font override")**: `.bsb-heading` now reads `--b-ff` and `--b-fw` first and falls back to the theme font and heading weight, so an unset field still uses the theme. The font picker lists the curated `THEME_FONTS`, and Heading and Text load the picked font through a `<link rel="stylesheet" precedence>` (`ElementFontLink`, `elementFontHref` in `theme-vars.ts`). Only curated names produce a URL.
- **Display per device (ticket "display options")**: `bricksElementStyle` emits `--brx-t-disp` and `--brx-m-disp` (cascade desktop, tablet, phone) only when a smaller device sets its own display; `blocks.css` applies them inside the media queries with `!important` because the desktop value is inline. `display: none` is now applied on desktop (it was silently ignored). The slot of Section, Container and Block uses `display: inherit` instead of a fixed `flex`, so Block, Grid and Inline now change the layout.
- **Rich text (tickets "bold and italic" and "textarea")**: `MarkdownTextControl` toggles bold and italic (a second click removes the marks), toggles lists per selected line, keeps the selection, and shows a live preview of the sanitised result. Multi Card card text now uses it and renders through `parseMarkdownToHtml` (line breaks, lists, bold, italic, links) with list styles in `blocks.css`.
- **Long media URL (ticket 1)**: the background image row wraps the URL (`overflow-wrap: anywhere`), the Remove button no longer shrinks, and the panel grids use `minmax(0, 1fr)` so nothing widens the settings panel.

## Decisions and trade-offs
- Card text is stored as the same markdown the Text block uses, so existing plain-text cards render unchanged (a plain line becomes one paragraph).
- Hiding an element on desktop in the editor now hides it in the canvas too; select it from the Outline to bring it back.
- Fonts saved before this change that are not in the curated list stay in the picker as "(not loaded)" instead of vanishing.

## Verification
- Ran: `pnpm --filter @bs/blocks exec vitest run` 301 pass (new `packages/blocks/test/ruttl-fixes.test.tsx`: display cascade, font URL allow-list, heading font output, card lists); `pnpm typecheck` and `pnpm lint` pass (3 existing warnings in block-editor).
- NOT verified: nothing was driven in the browser (no admin or storefront session was run), so the editor behaviour of the new toolbar, the per-device display switch and the panel layout is untested by hand. `pnpm test:heavy` and `pnpm build` were not run for this change.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure change)
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [ ] `progress.md`: in-flight line added

## Follow-ups and open questions
- Ruttl ticket status cannot be set through the MCP; the owner marks the six tickets resolved after checking.
- `chooseMedia` calls `set("mediaId")` then `set("imageUrl")` from one stale value, so only the last write may stick; not changed here.

## Definition of done
Gate partly run (see Verification). No secrets or generated files in the diff.
