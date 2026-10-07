# Design system Part 8: token alias removal, perf & a11y pass, theme robustness

- **Date:** 2026-10-07
- **Agent:** antigravity
- **Branch:** `feat/ds-08-aliases-perf-a11y`
- **Area:** ui, admin, superadmin, web, docs
- **Type:** refactor
- **Supersedes:** none

## Summary
Completed Part 8 of the `@bs/ui` design-system overhaul per `AGENTS.md` and `docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md` (§3, §5, §12, §13). Removed all backward-compatibility token aliases (`--surface-75..400`, `--overlay`, `--control`, `--dash-sidebar`, `--dash-canvas`, `--border-default/-muted/-strong/-stronger/-control`, `--primary-solid`, `--primary-bright`, `--foreground-light/-lighter/-muted`, `--bg-alternative`, and their Tailwind counterparts) across `apps/` and `packages/`. Validated theme robustness with automated unit testing for `ThemeProvider` and boot script scoping, and verified performance, bundle sizes, accessibility, and the full monorepo gate.

## What changed
- **Legacy Token Aliases Removal**:
  - Cleaned up all legacy Tailwind utility classes (`text-foreground-lighter`, `bg-surface-*`, `bg-control`, `bg-overlay`, `bg-dash-canvas`, `border-border-control`, etc.) across `apps/admin`, `apps/superadmin`, and `packages/ui` components.
  - Replaced legacy assignments in `apps/admin/src/index.css` and `apps/superadmin/src/index.css` with semantic tokens (`--sidebar`, `--canvas`, `--muted`, `--muted-foreground`, `--card`, `--border`, `--brand`).
  - Removed backward-compatibility aliases and legacy `@theme inline` mappings from `packages/ui/src/styles/tokens.css`.
  - Zero remaining references verified via `git grep` across the codebase.
- **Theme Robustness & Tests**:
  - Added unit test suite `packages/ui/test/theme.test.ts` testing `makeThemeBootScript` code generation, resolution of stored `light`/`dark` preferences, system theme fallback, and pathPattern URL guard regex scoping.
- **Performance & Animations**:
  - Checked animation stylesheets (`packages/ui/src/styles/motion.css`, `apps/admin/src/index.css`, `apps/superadmin/src/index.css`): all animations strictly manipulate `opacity` and hardware-accelerated `transform`, with no layout property animations. `prefers-reduced-motion` overrides clamp animation durations to 0.01ms.
  - Fonts (Geist Sans / Mono) are preloaded once via HTML `<link rel="preload">` in admin/superadmin and via `next/font/google` with `display: "swap"` in web.
  - Monorepo production builds pass cleanly. Measured bundle sizes:
    - `@bs/admin`: ~3.33 MB total assets (uncompressed minified JS/CSS, gzip ~740 kB).
    - `@bs/superadmin`: ~2.58 MB total assets (uncompressed minified JS/CSS, gzip ~610 kB).
- **Accessibility**:
  - Verified `@bs/ui` primitives (Button, Field, Input, Select, SimpleSelect, Dialog, ResponsiveDialog, Sheet, Skeletons, StatusBadge, Money) provide semantic markup, `aria-hidden` on all skeletons, correct `aria-busy` and focus ring outlines.

## Evidence of Zero Remaining Aliases
Command output:
```bash
git grep -E -- "--(surface-[0-9]+|overlay\b|control\b|dash-sidebar|dash-canvas|border-(default|muted|strong|stronger|control)|primary-(solid|bright)|foreground-(light|lighter|muted)|bg-alternative)" apps/ packages/
# Output: (exit code 1 - 0 matches)

git grep -E "\b(text-foreground-lighter|text-foreground-light|text-foreground-muted|bg-surface-[0-9]+|bg-control|bg-overlay|bg-dash-canvas|border-border-control|border-border-muted|border-border-strong|text-primary-solid|bg-primary-solid|border-primary-bright)\b" apps/ packages/
# Output: (exit code 1 - 0 matches)
```

## Verification
- Ran:
  - `pnpm --filter @bs/ui test`: 5 test files, 45 passed (100% pass).
  - `pnpm typecheck`: 15 packages passed cleanly (0 errors).
  - `pnpm lint`: 15 packages passed cleanly (0 errors).
  - `pnpm build`: all 6 targets compiled and built successfully (`@bs/admin`, `@bs/superadmin`, `@bs/web`, `@bs/platform`, `@bs/worker`, `@bs/domain`).
  - `pnpm docs:check`: ok.
- NOT verified:
  - Part 4 (Appearance Manager): strictly kept ON HOLD per instruction.

## Docs updated
- [x] `docs/design-system.md` (added Section 6 on Token Aliases & Hardening)
- [x] `docs/ARCHITECTURE.md` (bumped "Last verified against" to `feat/ds-08-aliases-perf-a11y`)
- [x] `progress.md` (updated In flight status)

## Follow-ups and open questions
- Ready for Claude Code verification as required by multi-agent protocol.

## Definition of done
- [x] Code follows section 2 and 3; the gate in section 4 passes.
- [x] Tests added or updated (`packages/ui/test/theme.test.ts`).
- [x] `docs/ARCHITECTURE.md` updated ("Last verified" bumped).
- [x] No ADR needed (Part 8 alias removal follows existing plan and guide).
- [x] `DEPLOYMENT.md` not affected.
- [x] A change record in `docs/changes/` and `progress.md` updated.
- [x] No secrets, no generated files, no unrelated edits in the diff.
- [x] Honest status: all verification steps reported with real output.
