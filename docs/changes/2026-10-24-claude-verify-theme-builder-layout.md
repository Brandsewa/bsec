# Verification of feat/theme-builder-layout (Antigravity) and https-only image links

- **Date:** 2026-10-24
- **Agent:** claude
- **Branch:** `feat/theme-builder-layout`
- **Area:** blocks
- **Type:** test + fix
- **Supersedes:** none

## Summary
Verified the four Antigravity change records on this branch against the gate and a security read of the new code, and fixed one finding.

## Verification
- `pnpm typecheck`, `pnpm lint` (0 errors, 2 pre-existing-style `exhaustive-deps` warnings in `EditorHeader.tsx`), `pnpm build`, `pnpm docs:check`: pass.
- `@bs/blocks` 253 tests, `@bs/block-editor` 19 tests, `@bs/domain test:fast` 460 tests: pass.
- Old saved `Section` documents still parse to the same props and defaults.
- Markdown text widget output goes through `sanitizeRichText` (parser based, scheme allow-list). Layout lengths are regex-validated and applied as CSS custom properties, no injected `<style>`.

## Fixed
- `background.imageUrl` (Section/Container/Block) and `Image.imageUrl` used `z.string().url()`, which accepted `javascript:`, `data:` and plain `http:`. Now `httpsImageUrlSchema` (https only), with a test.

## Not tested
- `test:heavy` (real Postgres) and the e2e suite; no domain or DB code changed on this branch. Admin UI was not walked by Claude (owner did quick testing).

## Open questions / follow-ups
- Free-string props (`imageSize`, `imagePosition`, `videoFit`, `videoPosition`, `typography.fontFamily`, `iconGap`, `Video.aspectRatio`) are applied as inline styles. Not exploitable (React sets them through the style object) but should become enums or validated lengths.
- `docs/ARCHITECTURE.md` not updated for the new `Block` type and Bricks layout schema.
