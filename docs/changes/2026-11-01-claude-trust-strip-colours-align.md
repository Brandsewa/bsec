# Trust strip: colours, icon alignment, slider bar; colour popover opens upward

- **Date:** 2026-11-01
- **Agent:** claude
- **Branch:** `feat/trust-strip-colours-align` (not merged yet)
- **Area:** blocks, block-editor
- **Type:** feature
- **Supersedes:** none

## Summary
Owner feedback on the Trust strip: colour popovers opened below the swatch and were cut off, there was no way to colour the icon, heading or description on a dark background, icons beside a heading did not line up, and the slider had no position bar.

## What changed
- `ColorPickerSwatch.tsx`: the popover always opens upward from the swatch (bottom anchored, scrolls inside when the window is short). Affects every colour field in the editor.
- Trust strip settings (per device, tablet and phone follow the larger screen): `iconColor`, `headingColor`, `textColor`, `valign` (icon beside the text lines up with the top, middle or bottom; default middle). The colour fields now sit in a closed "Colours" accordion at the end of each tab, with the strip and card backgrounds.
- Slider: thin, light position bar that shows only while the pointer is over the strip or it has focus, like the collection slider's (pure CSS, `scrollbar-color` and `::-webkit-scrollbar`); room for it is reserved only on slider screens.
- Tests: three new cases in `trust-strip.test.tsx`.

## Verification
- Ran: block and block-editor typecheck and lint (clean), `trust-strip.test.tsx` (7 pass).
- NOT verified: not driven in a browser (popover placement, bar look on hover).

## Docs updated
- [ ] ARCHITECTURE.md, ADR, DEPLOYMENT.md, progress.md: not needed

## Definition of done
Gate run by the pre-push hook.
