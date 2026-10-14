# Media UI: subtle borders, wider drawer, tidier popups

- **Date:** 2026-10-14
- **Agent:** claude
- **Branch:** `fix/media-ui-borders` (not merged yet)
- **Area:** admin, docs
- **Type:** fix
- **Supersedes:** none

## Summary
The media screens drew sharp lines around cards, tiles, buttons and toggles: white in dark mode, near-black in light mode. Cause: the components used bare `border` / `border-t` / `border-b` / `divide-y` classes, which have no colour of their own and fall back to the text colour in Tailwind v4. They now name design tokens, so borders look like the rest of the admin (soft, theme-aware). The detail drawer is wider and better aligned, and the picker and upload popups got the same spacing.

## What changed
- `components/media/*.tsx`, `routes/_store/online-store/media.tsx`: every bare border now uses `border border-border`; dividers use `border-border/60` and `divide-border/60`; hover on tiles and drop zones uses `hover:border-foreground/25..30` (the old `hover:border-primary/50` was a white line in dark mode).
- Detail drawer: about 40% of the screen (`data-[side=right]:sm:w-[40vw]`, min 480 px, max 760 px; the shared Sheet sets its width through `data-[side=right]:` variants, so plain `sm:` classes lose), padding `p-5 sm:p-8`, section cards `p-5`, header and footer aligned with the cards, one action row (Copy link, Download, Replace file left, Move to Trash right), focal point header and crop previews aligned.
- Picker dialog and upload popup: wider (`sm:max-w-5xl`), padding `p-5 sm:p-6`, upload tray rows `p-4`.
- Replace file now accepts DOCX, XLSX and PPTX too (it only accepted PDF, CSV and TXT for documents).
- `apps/admin/test/media-border-tokens.test.ts`: fails if a bare border or divider class returns to the media UI.
- `docs/admin-ui-standards.md`: new rules 5 (Borders) and 6 (Side drawers), the note to follow from now on.
- e2e: the refusal test waits for the plan limits to load and accepts the specific reason with either prefix (the server answers the same text when the page has not loaded the limits yet).

## Verification
- Screenshots from the real stack in light and dark: `docs/test-evidence/2026-10-14-media-ui-borders/`.
- Drawer measured in the browser: 576 px at a 1440 px viewport (40%).
- Real media e2e suite: 9 passed, twice in a row. `@bs/admin` typecheck, lint and tests pass (guard test: 8 files).
- Not verified: the other admin screens (orders, products, settings) were not touched and may still contain bare borders; the shared `Sheet` and `Dialog` primitives were not changed.

## Docs updated
- [x] `docs/admin-ui-standards.md`

## Follow-ups
- Audit the rest of `apps/admin` for bare `border` classes and fix them under the same rule (a repo-wide guard test would then be possible).
