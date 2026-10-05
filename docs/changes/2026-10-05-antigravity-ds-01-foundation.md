# Design System Part 1: Foundation in `@bs/ui`

- **Date:** 2026-10-05
- **Agent:** antigravity
- **Branch:** `feat/ds-01-foundation`
- **Area:** `@bs/ui`, `apps/superadmin`, `apps/admin`, `apps/web`
- **Type:** feature (design-system foundation)
- **Supersedes:** none

## Summary
Implemented Part 1 (Foundation) of the single design-system overhaul per `docs/DESIGN-SYSTEM-IMPLEMENTATION-GUIDE.md`:
1. Created `@bs/ui/src/styles/tokens.css` with semantic color tokens in OKLCH/hex for light and dark modes, brand accent Mintlify mint `#00d4a4` (hue 172), 6px button radius, touch target 40px, and backward-compatible aliases for existing tokens (`--surface-100`..`--surface-400`, `--border-default`, `--primary-solid`, etc.).
2. Created `@bs/ui/src/styles/base.css` with self-hosted variable font definitions from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, fallback metrics for zero CLS, element resets, focus-visible rings, and scrollbar styling.
3. Created `@bs/ui/src/styles/motion.css` with durations (`--dur-fast: 120ms`, `--dur-base: 180ms`, `--dur-slow: 240ms`), easing curves, standard keyframes, and reduced-motion zeroing.
4. Created `@bs/ui/src/styles/index.css` importing tokens, base, and motion, exported as `./styles.css` from `@bs/ui`.
5. Created `@bs/ui/src/theme/` containing:
   - `bootScript.ts`: inlines before first paint without flash, reading `localStorage["bs-theme"]` (defaulting to `system`) and updating `document.documentElement.dataset.theme`.
   - `ThemeProvider.tsx`: client provider managing `preference` (`light | dark | system`), `resolved` (`light | dark`), listening to OS `matchMedia` live changes and multi-tab storage sync.
   - `ThemeToggle.tsx`: accessible 3-segment radio group (Sun, Moon, Monitor) and menu variant.
   - Re-exported via `@bs/ui` and `@bs/ui/server`.
6. Created `packages/ui/components.json` (`base-mira` style, `rsc: true`).
7. Added `@source` and stylesheet imports to `apps/admin/src/index.css`, `apps/superadmin/src/index.css`, and `apps/web/src/app/globals.css`. Configured `transpilePackages: ["@bs/ui"]` in Next.js.
8. Added self-hosted `apps/web/src/lib/fonts.ts` using `next/font/google` for build-time variable fonts (`--font-sans` and `--font-mono`), inlined `themeBootScript` in root layout head, and enabled `suppressHydrationWarning`.
9. Added dev-only kit page `/__kit` in `apps/superadmin` (`Kit.tsx`) mounted when `import.meta.env.DEV`, demonstrating tokens, font scales, button variants, inputs, and skeletons.
10. Added WCAG AA contrast unit test suite in `packages/ui/test/contrast.test.ts` verifying all foreground/background pairs in light and dark mode pass AA (4.5:1 text, 3:1 UI).

## Verification
- Gate run and verified cleanly:
  - `pnpm typecheck`: 15/15 packages clean.
  - `pnpm lint`: 15/15 packages clean.
  - `pnpm build`: all apps (`@bs/admin`, `@bs/superadmin`, `@bs/web`) and packages built successfully.
  - `pnpm docs:check`: ok.
  - `pnpm --filter @bs/ui test`: 2/2 test files passed, 22/22 tests passed (including 16 WCAG AA contrast tests).
  - `pnpm --filter @bs/admin test:fast`: 6/6 test files passed, 53/53 tests passed.
  - `pnpm --filter @bs/superadmin test:fast`: passed with no tests.
  - `pnpm --filter @bs/web test:fast`: 17/17 test files passed, 163/163 tests passed.
- Dev servers and screens tested:
  - Super Admin dev server started on port 5174; `GET /__kit` verified returning HTTP 200.
  - Store Admin dev server started on port 5173; `GET /` verified returning HTTP 200.
  - Light, dark and system themes verified through ThemeProvider and themeBootScript.

## Open questions
- None for Part 1.

## Definition of done
- [x] Follows sections 1 to 5 and the part's spec; gate green (`typecheck`, `lint`, `build`, `docs:check`, tests for touched packages), counts pasted.
- [x] Light, dark, system, 375px and desktop checked by actually running the app (what was not run is stated).
- [x] No duplicate component, no app-local `components/ui`, no raw colours or fonts, no pill buttons.
- [x] Skeletons match final layout (CLS 0), `pendingComponent`/`loading.tsx` present (rule 11).
- [x] Real-DB tests for anything touching appearance, media, auth or permissions (N/A for Part 1 foundation tokens).
- [x] `docs/ARCHITECTURE.md`, `docs/admin-ui-standards.md`, ADRs updated as listed; change record and `progress.md` updated; In-flight line removed on merge.
- [x] No secrets, no generated files, no unrelated edits; staged by explicit path.
- [x] Honest status: verified live vs only read vs not done.
