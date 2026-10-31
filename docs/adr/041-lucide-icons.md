# ADR-041: Lucide icons: one package, named imports for UI chrome, allowlisted SVG data for content

- **Status:** Accepted
- **Date:** 2026-10-31
- **Plan reference:** ADR-009 (block versions), ADR-010 (no merchant-controlled code), `docs/admin-ui-standards.md`

## Context
Block content stored one of 25 icon names drawn by a hand-copied set in `@bs/blocks`, and the Puck editor offered a plain 18-name dropdown. Merchants want the whole Lucide set (about 1,900 icons) in a searchable picker. Constraints: the storefront product page client JS has no headroom under its 50 KB gzip budget; the admin entry bundle should not grow; an icon name is merchant-controlled input that must never become markup (ADR-010); our own admin/superadmin code already imports `lucide-react` by name.

## Decision
1. **UI chrome (our own code)** keeps importing icons by name from `lucide-react` (`import { Truck } from "lucide-react"`). Lint (`no-restricted-imports`, `packages/config/eslint`) now bans the namespace import, `icons`, `DynamicIcon` and `lucide-react/dynamic*`, so no bundle can accidentally contain the whole set.
2. **Icons chosen by name at runtime (blocks, themes)** go through the new `@bs/icons` package. A generator (`pnpm --filter @bs/icons generate`) reads the pinned `lucide-react` and commits `src/generated/names.ts` (allowlist, 8 KB gzip) and `data.ts` (SVG nodes, 89 KB gzip). The generator rejects any element or attribute outside a small allowlist and any unsafe attribute value.
3. **Rendering:** `@bs/icons/server` `IconSvg` builds the `<svg>` from React elements out of the table (no `dangerouslySetInnerHTML`; unknown names render nothing). Its `browser` export condition maps to a lazy build that fetches the table as its own chunk, so Vite (admin editor preview) and any client bundle never contain it inline; Next server components get the synchronous version and ship zero icon JS.
4. **Validation:** `iconNameSchema` (`@bs/blocks`) accepts any allowlisted Lucide name plus the pre-Lucide names (`returns`, `support`, `cart`, `cup`, `help`) and PascalCase seed names, resolved by `resolveIconName`. Widening the old enum keeps every saved document valid, so block versions do not change. Stored values are never rewritten.
5. **Stroke weight:** Thin, Regular or Bold is stored as a suffix on the icon string (`truck:bold`), so every icon field supports it without a schema change; `resolveIconName` ignores the suffix and the renderers read it.
6. **Editor:** `iconField` (`@bs/block-editor`) is a Puck custom field: search with synonyms, category chips, a recently-used row, a popup dialog with a paged grid (200 at a time), keyboard-focusable buttons, and the catalog loaded on demand.
7. **Client components** that cannot use the lazy table (the mini cart trust row) use `LiteSvgIcon`, the old 25-icon set, and keep the old enum.

## Consequences
- A merchant can pick any Lucide icon in all icon fields; existing pages look the same (the old paths were Lucide's). Legacy `shield` and `clipboard` now draw Lucide's plain shield and clipboard instead of the check variants.
- Upgrading Lucide: bump the pin in `packages/icons` and `packages/ui`, run `generate`, review the name diff (Lucide renames icons, e.g. `circle-help` became `circle-question-mark`; add a legacy alias if a stored name disappears).
- Server bundles carry the table once per route chunk group (about 0.4 MB raw); the storefront perf-budget test and a check that no `.next/static` chunk contains the table guard the client side.
- Lucide is ISC-licensed; `packages/icons/LICENSE-LUCIDE` carries the notice.

## Alternatives considered
- **`DynamicIcon` / `lucide-react` barrel at runtime:** ships all icons or a per-icon network round trip; fails the budget.
- **Static `lucide-static` SVG files served from `/public`:** a request per icon, no inheritance of `currentColor` without inlining, and a path-injection surface for stored names.
- **Raw SVG strings with `dangerouslySetInnerHTML`:** smaller, but puts markup next to merchant input; React elements from an allowlist remove that class of bug.
- **Convert saved names to Lucide names with a migration:** unnecessary churn; resolving at render time is lossless.
