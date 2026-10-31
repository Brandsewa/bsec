# Lucide icon pack: `@bs/icons`, searchable icon picker in the theme editor

- **Date:** 2026-10-31
- **Agent:** claude
- **Branch:** `feat/lucide-icon-pack` (not merged yet)
- **Area:** blocks, block-editor, config, docs
- **Type:** feature
- **Supersedes:** none

## Summary
Every icon field in the theme/page editor now opens a searchable picker over all ~1,900 Lucide icons instead of an 18-name dropdown, and the storefront draws them as inline SVG on the server. Own UI code keeps importing Lucide icons by name, now enforced by lint. Design and alternatives: ADR-041.

## What changed
- New `packages/icons` (`@bs/icons`): generator `scripts/generate.mjs` (pinned `lucide-react`, allowlisted elements/attributes/values), committed `src/generated/{names,data}.ts`, `resolveIconName`/`isIconName`, server `IconSvg`, lazy browser `IconSvg` (package `browser` condition), `@bs/icons/catalog` with `searchIcons` and synonyms.
- `@bs/blocks`: `iconNameSchema` replaces `z.enum(ICON_NAMES)` in the Icon, ProductDetail USP, trust strip and multi-card schemas (widening only, saved documents stay valid, no block version bump). `SvgIcon` now draws any Lucide icon. `LiteSvgIcon` (`@bs/blocks/svg-icon-lite`) is the old 25-icon set for client components; the mini cart uses it and its `trustItems` enum is unchanged.
- `@bs/block-editor`: `IconField.tsx` (`iconField`), used by all six icon fields in `config.tsx`; the old `ICONS` dropdown map is removed.
- `packages/config/eslint`: `no-restricted-imports` bans `import * from "lucide-react"`, `icons`, `DynamicIcon`, `lucide-react/dynamic*`.
- `docs/adr/041-lucide-icons.md`, ADR index, ARCHITECTURE package table.

## Decisions and trade-offs
- Icon data is a lazy chunk in the admin (89 KB gz) so the admin entry stays at the same size; server routes carry it synchronously with zero client JS.
- Legacy `shield` and `clipboard` now draw Lucide's plain shield/clipboard (a real Lucide name wins over a legacy alias). Other legacy names map to the same Lucide icons.
- `circle-help` was renamed `circle-question-mark` in Lucide 1.x; the `help` alias points at the new name.
- Button's free-text `icon` field was already a string; it now resolves any Lucide name but still has no picker (follow-up).

## Verification
- Ran: `pnpm typecheck` pass (16 tasks); `@bs/icons` 5 tests, `@bs/blocks` 268, `@bs/block-editor` 26 pass; lint clean for icons, blocks, block-editor, ui, admin, superadmin, web (only the existing 2 `EditorHeader` warnings); probe file confirmed the new lint rule fires.
- `pnpm --filter @bs/web build` + `test/perf-budget-bundle.int.test.ts` 3 pass; no chunk in `.next/static` contains the icon table. Admin and superadmin build; admin entry gz 425 KB (was about 427 KB) plus a separate lazy 89 KB gz data chunk.
- Picker driven in a browser via a throwaway Vite harness (admin dev server, since removed): legacy `returns` shows as `rotate-ccw`, lazy icon renders, search "delivery" finds `truck`, picking stores `truck`. NOT verified: inside the full Puck editor sidebar (width, scrolling) and 375 px; `pnpm gate:quick`/heavy tests, e2e.
- Then driven in the real theme editor (local demo store, Multi card): the picker is a centred popup (portal, 760 px wide, 12 icons per row, Escape and backdrop close). Searching "shield" and picking one updated the card preview live. NOT verified: 375 px, keyboard-only use.
- Category chips (All, Store, Trust, Contact, Arrows, Nature, Food, People, Devices; matched on name words because Lucide's own categories are not in the npm package) and a "Recently used" row (last 12, `localStorage` `bsec:recent-icons`, guarded, per browser) added and driven in the editor: Store gives 106 icons; picking `box` was remembered and shown on reopen.
- Stroke weight (Thin 1.25, Regular 1.75, Bold 2.25) in the popup footer: stored as a suffix on the icon string (`truck:bold`; no suffix = regular) so no block schema changes; the last choice is remembered per browser (`bsec:icon-weight`) and used for new picks, and changing it re-applies to the current icon. Driven in the editor: radios set storage and stroke-width 1.25/2/2.5, and the remembered weight is preselected after a reload.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (package table; "Last verified" commit not bumped)
- [x] ADR-041
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` in-flight line

## Addendum: theme settings order
- Theme settings sections are now ordered Layout, Fonts, Colours, Corners, Buttons, Icons and all start closed (previously Colours opened by default). Verified in the editor.

## Addendum: theme-level icon defaults (same branch)
- Theme settings gained an **Icons** accordion: default size (12 to 96 px), stroke (Thin/Regular/Bold) and the icon **colour** on dark sections and on light sections (`tokens.icons = { size, weight, darkColor, lightColor }`, emitted as `--bs-icon-size`, `--bs-icon-weight`, `--bs-icon-color-dark`, `--bs-icon-color-light`). Every variable is emitted only when set, so untouched themes look exactly as before. (An earlier draft of this addendum read "background" as a tile behind the icon; that was removed, no `iconBg` widget option exists.)
- Colours: `.bsb-icon` and `.bsb-mc-icon` read `--bs-ic`, the colour for the nearest background. It is set by the dark and brand tones (dark colour), the soft tone (light colour) and, **automatically**, by any Section, Container or Block that paints its own background colour: `bricksElementStyle` checks the colour's brightness per device (`isDarkColor`, same WCAG test as `readableOn`) and emits `--brx-{d,t,m}-ic`; `.brx-ic` applies it (`bricksIconToneClass`). Custom properties inherit, so the nearest background wins, and a mobile-only background change switches icons on mobile. Cards with a picture or background image keep inheriting their text colour. Backgrounds that are images or videos, and rgb/hsl colours, are not detected (the tone or default applies).
- Size and weight precedence, lowest to highest: widget fallback size, theme default, widget's own value. `IconSvg` sets them as inline styles (`var(--bs-icon-size, <fallback>)`), so a widget size (`px`) or a stored weight suffix (`truck:bold`) beats the theme. The picker's weight control has a **Theme** option (no suffix, follows the theme), which is the remembered default.
- Widgets: Icon block `size` is optional with a "Theme default" choice (new blocks carry no size; saved sizes still win); Multi card `iconSize` is optional (empty = theme). Trust strip, product USPs and product accordion icons follow the theme size. Button icons, FAQ icons and the mini cart are unchanged. There is no per-widget icon colour yet.
- Verified: blocks tests 271 (theme vars, clamping and junk, size and weight precedence), icons 7, block-editor 26, typecheck, lint, web build and product-page JS budget (3 pass, no icon table in client chunks). In the editor the accordion renders and setting the light colour emits `--bs-icon-color-light: #0a7a3c` on the canvas, with the dark variable left unset. NOT verified on screen: icons visibly changing colour or size (the demo page's saved Multi card is the picture style with missing media).
