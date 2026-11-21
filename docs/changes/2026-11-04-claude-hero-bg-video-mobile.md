# Hero background video plays on phones, with a poster option

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `fix/hero-bg-video-mobile` (merged in #217, c68befd)
- **Area:** blocks, block-editor
- **Type:** fix
- **Supersedes:** none

## Summary
The page-speed work gated `BgVideo` to screens 768px and up, so the hero background video never played on phones. The gate is removed. The file is still attached only after idle, and Data Saver and reduced-motion visitors still keep the poster.

## What changed
- `views-bg-video-client.tsx`: dropped the min-width check.
- New background prop `videoPosterMediaId` (key ends in `MediaId` so the media collector resolves it; the old `videoPosterId` was never resolved and had no editor field). Poster falls back to the background image (desktop, then mobile, then tablet).
- Block editor: "Poster" picker under the background video.
- Test in `page-speed.test.tsx` for poster and fallback.

## Verification
- Ran: `@bs/blocks` and `@bs/block-editor` typecheck and lint, `page-speed.test.tsx` (9 pass).
- NOT verified: playback on a real phone, product-page JS budget, full gate.

## Docs updated
- [ ] ARCHITECTURE, ADR, DEPLOYMENT not needed
