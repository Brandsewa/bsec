# Button widget, responsive typography, and markdown text formatting

- **Date:** 2026-10-24
- **Agent:** antigravity
- **Branch:** `feat/theme-builder-layout`
- **Area:** blocks, block-editor
- **Type:** feature
- **Supersedes:** none

## Summary
Implements comprehensive Button widget functionality with Bricks Builder styling options (normal solid, line outline, and text ghost buttons, icons with positioning/gap, custom & theme colors), responsive custom typography options across Heading, Text, and Button (font family, responsive font size, font weight, line height, letter spacing, text transform), removes predefined size dropdowns, replaces RichText in the block picker with a clean formatted Markdown Text widget (supporting bold, italics, links, numbered and bullet lists with XSS sanitization), and defaults style tab accordions to closed on widget selection.

## What changed
- `packages/blocks/src/registry.ts`:
  - Extended `ButtonSchema` with `bricksLayoutSchema`, `styleType` ("theme" | "normal" | "line" | "text"), `label`, `text`, `href`, `link`, `newTab`, `size`, `fullWidth`, `align`, `buttonColor`, `textColor`, `hoverButtonColor`, `hoverTextColor`, `icon`, `iconPosition`, `iconGap`.
  - Updated `HeadingSchema` making legacy predefined `size` optional with default "auto".
- `packages/blocks/src/bricks-layout.ts`:
  - Added `typographySchema` with `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textTransform`.
  - Integrated `typography` into `baseStyleSchema` and responsive CSS variable generation (`--brx-*-fs`, `--brx-*-fw`, `--brx-*-ff`, `--brx-*-lh`, `--brx-*-ls`, `--brx-*-tt`).
- `packages/blocks/src/blocks.css`:
  - Responsive typography variables across breakpoints.
  - Button styling for `.brxe-button` (`.brx-btn-normal`, `.brx-btn-line`, `.brx-btn-text`, `.brx-btn-full`, and custom hover color variables).
  - List and link typography formatting for `.brxe-text-basic`.
- `packages/blocks/src/markdown.ts`:
  - Added `parseMarkdownToHtml` converting markdown syntax (`**bold**`, `*italic*`, `[text](url)`, numbered `1. ` and bullet `- ` lists) safely to HTML with `sanitizeRichText`.
- `packages/blocks/src/svg-icon.tsx` & `common.ts`:
  - Added button icons (`arrow-right`, `arrow-left`, `chevron-right`, `chevron-left`, `cart`, `external-link`, `plus`) with SVG path definitions and aliases.
- `packages/blocks/src/views.tsx`:
  - Updated `HeadingView` to render custom typography variables.
  - Updated `TextView` to render formatted markdown HTML.
  - Updated `ButtonView` with style types, responsive sizing, custom colors, and icons.
- `packages/block-editor/src/config.tsx`:
  - Retired `RichText` from picker (placed in `RETIRED_FROM_PICKER`), activated `Button` in picker.
  - Replaced `Heading` predefined size dropdown with custom typography control.
  - Configured `Text` with `markdownTextField`.
- `packages/block-editor/src/BricksLayoutFields.tsx`:
  - Added `typographyField` and `markdownTextField` controls.
  - Extracted PascalCase component controls (`BackgroundControl`, `BorderControl`, `BoxShadowControl`, `TypographyControl`, `MarkdownTextControl`, `WrappedFieldControl`) cleanly complying with ESLint React hooks rules and strictly typed without `any`.
- `packages/block-editor/src/BricksTabs.tsx`:
  - Style tab accordion groups now start collapsed/closed initially (`defaultOpen = false`).

## Decisions and trade-offs
- In `@bs/block-editor`, Puck's `BLOCK_SPECS` requires all `BlockType` keys to be present for TypeScript type checking. To retire `RichText` cleanly without breaking block typing or backward compatibility with existing stored pages, it remains defined in `BLOCK_SPECS` but is excluded from the editor's inserter via `RETIRED_FROM_PICKER`.
- Markdown parser uses standard lightweight regex transformation with existing `sanitizeRichText` HTML sanitization to comply with the Ponytail minimalist guardrail without adding external markdown parser dependencies.

## Verification
- `pnpm typecheck`: Passed (15/15 packages).
- `pnpm --filter @bs/blocks test:fast`: 22 test files, 252 tests passed.
- `pnpm --filter @bs/block-editor test:fast`: 2 test files, 19 tests passed.
- `pnpm --filter @bs/blocks lint`: Passed (0 errors, 0 warnings).
- `pnpm --filter @bs/block-editor lint`: Passed (0 errors, 2 pre-existing warnings in EditorHeader).
- `pnpm --filter @bs/admin build`: Built successfully with Vite.
- `pnpm docs:check`: Passed (`docs:check ok`).

## Docs updated
- [x] Change record created in `docs/changes/2026-10-24-antigravity-button-typography-text.md`.
- [ ] `docs/ARCHITECTURE.md` (no architectural boundaries changed).

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status reported.
