# bsec design system

This document is the reference guide for the unified `@bs/ui` design system used across `apps/admin`, `apps/superadmin`, and `apps/web` (customer account and auth).

---

## 1. Core Principles

1. **One Design System, One Package (`@bs/ui`):**
   All UI primitives, layout utilities, feedback components, and composite skeletons live in `packages/ui`. Applications do not fork or duplicate UI primitives.
2. **Tokens First:**
   All colors, surfaces, typography, radii, and spacing are controlled via semantic CSS tokens (`--brand`, `--background`, `--card`, `--border`, `--muted`, `--foreground`, etc.). No hardcoded hex values or inline color styles in application components.
3. **Strict Rectangular Radii (No Pill Buttons):**
   Buttons and inputs use a consistent 6px border-radius (`--radius-button`, `rounded-md`). Pill shapes (`rounded-full`) are reserved strictly for small circular icon buttons, status dots, and indicator badges.
4. **Zero Layout Shift (CLS 0):**
   Composed skeletons (`PageHeaderSkeleton`, `DataTableSkeleton`, `AuthCardSkeleton`, `AccountPageSkeleton`, etc.) match the exact dimensions and grid of final rendered content.
5. **Universal Accessibility (WCAG 2.1 AA):**
   Minimum 4.5:1 text contrast for body copy and 3:1 for interactive controls. Keyboard navigation, visible focus rings (`--ring`), screen reader labels, and correct form autocomplete attributes are non-negotiable.

---

## 2. Tokens & Variables

All tokens are defined in `packages/ui/src/styles/tokens.css` and mapped into Tailwind CSS via the `@theme` block.

### Semantic Color Tokens

| Token | Light Mode Value | Dark Mode Value | Usage |
|---|---|---|---|
| `--brand` | `#00d4a4` (mint) / Store Accent | `#00d4a4` / Store Accent | Primary brand accent for buttons, active states, highlights |
| `--brand-deep` | OKLCH derived darker | OKLCH derived darker | Hover states for primary actions |
| `--brand-ink` | Contrast-checked text color | Contrast-checked text color | High-contrast text on light surfaces or badges (min 4.5:1) |
| `--brand-soft` | 10% tint of brand | 15% tint of brand | Subtle tinted backgrounds, active row fills, tag backgrounds |
| `--background` | `hsl(210 20% 98%)` (#f8f9fa) | `hsl(220 18% 7%)` (#0e1117) | App / canvas root background |
| `--card` | `hsl(0 0% 100%)` (#ffffff) | `hsl(220 16% 12%)` (#181c24) | Card containers, panels, modals, dialogs |
| `--muted` | `hsl(210 16% 93%)` | `hsl(220 14% 16%)` | Subtle background fills, skeleton backgrounds |
| `--muted-foreground` | `hsl(215 16% 47%)` | `hsl(215 16% 65%)` | Secondary labels, captions, metadata |
| `--border` | `hsl(214 32% 91%)` | `hsl(220 13% 20%)` | Standard container and input borders |
| `--ring` | `var(--brand)` | `var(--brand)` | Focus ring outline for interactive controls |

### Radii Tokens

- `--radius`: `0.5rem` (8px default card/modal radius)
- `--radius-button`: `0.375rem` (6px button and control radius)
- `--radius-sm`: `calc(var(--radius) - 4px)` (4px)
- `--radius-md`: `calc(var(--radius) - 2px)` (6px)
- `--radius-lg`: `var(--radius)` (8px)
- `--radius-xl`: `calc(var(--radius) + 4px)` (12px)

---

## 3. Primitives & Components in `@bs/ui`

### Base UI & shadcn Primitives
- **Layout & Structure:** `Card`, `CardHeader`, `CardContent`, `CardFooter`, `Separator`, `AppShell`, `PageHeader`, `SectionCard`.
- **Forms & Inputs:** `Field`, `Input`, `Textarea`, `Checkbox`, `RadioGroup`, `Switch`, `Select`, `SimpleSelect`, `Combobox`, `MultiSelect`, `DatePicker`, `DateRangePicker`, `DateTimePicker`, `InputOTP`, `ImageUploader`.
- **Buttons & Navigation:** `Button`, `UiLink`, `ScrollTabs`, `Tabs`, `Breadcrumb`, `Pagination`.
- **Feedback & Overlays:** `Alert`, `Dialog`, `ResponsiveDialog`, `Drawer`, `Sheet`, `Popover`, `Tooltip`, `ConfirmDialog`, `SonnerToaster`, `toast`, `Spinner`, `Empty`.
- **Display & Status:** `Badge`, `StatusBadge`, `Money`, `RelativeTime`, `Avatar`, `CommandPalette`.

### Composed Skeletons (`patterns/skeletons.tsx`)
- `PageHeaderSkeleton`
- `MetricCardsSkeleton`
- `DataTableSkeleton({ columns, rows, columnWidths })`
- `FormSectionSkeleton`
- `DetailPageSkeleton`
- `AuthCardSkeleton`
- `AccountPageSkeleton`

---

## 4. Store Accent Derivation (`@bs/ui/server`)

For customer-facing account and auth pages in `apps/web`, the layout dynamically inherits the merchant store's brand color while ensuring accessibility.

```ts
import { deriveAccent } from "@bs/ui/server";

// Given any store primary hex (e.g. #ff0055 or light #fff500):
const accent = deriveAccent(storePrimaryColor);
// Returns:
// {
//   fill: string,   // Base brand color
//   deep: string,   // Darkened OKLCH variant for hover
//   ink: string,    // Contrast-corrected accessible text color (>= 4.5:1 against light surface)
//   soft: string,   // Translucent tint background
//   ring: string,   // Focus ring color
//   onFill: string, // "#000000" or "#ffffff" based on contrast against fill
// }
```

If the store color is invalid or absent, `deriveAccent` safely falls back to the platform mint (`#00d4a4`).

---

## 5. How to Add a New Component to `@bs/ui`

1. **Place the primitive in `packages/ui/src/components/`:**
   - Single primitives or Base UI wrappers go into `packages/ui/src/components/ui/` or `packages/ui/src/components/`.
   - Complex compound components (like data tables) go into subdirectories such as `packages/ui/src/components/data-table/`.
2. **Apply Semantic Tokens:**
   - Use Tailwind utility classes backed by tokens (`bg-card`, `border-border`, `text-foreground`, `focus-visible:ring-ring`).
   - Never use raw hex strings (`#123456`) or inline style colors.
3. **Export from `packages/ui/src/index.ts`:**
   - Re-export the component and its TypeScript prop interfaces.
4. **Document & Display in Dev Kit (`apps/superadmin/src/pages/Kit.tsx`):**
   - Add a demo section in the dev Kit page so team members can inspect its rendered appearance and states.
5. **Add Tests in `packages/ui/test/`:**
   - Unit test states, keyboard navigation, and accessibility semantics with Vitest.
6. **Verify with the Monorepo Gate:**
   - Run `pnpm typecheck`, `pnpm lint`, and `pnpm --filter @bs/ui test`.

---

## 6. Token Aliases & Hardening (Part 8 Completed)

All legacy backward-compatibility token aliases (`--surface-75..400`, `--overlay`, `--control`, `--dash-sidebar`, `--dash-canvas`, `--border-default`, `--border-muted`, `--border-strong`, `--border-stronger`, `--border-control`, `--primary-solid`, `--primary-bright`, `--foreground-light`, `--foreground-lighter`, `--foreground-muted`, `--bg-alternative`, and their Tailwind counterparts) have been completely removed from `@bs/ui` and all consumer applications (`apps/admin`, `apps/superadmin`, `apps/web`).

Only the standard semantic tokens defined in Section 2 are supported. New code must strictly reference semantic tokens (`muted`, `muted-foreground`, `faint-foreground`, `foreground-2`, `card`, `popover`, `canvas`, `sidebar`, `border`, `border-soft`, `input`, `primary`, `brand`).

---

## Status (2026-10-07)

Built and live: tokens, Geist, theme (light/dark/system), the component kit, Super Admin, Store Admin, and customer account/auth. **Planned but not built:** the Super Admin Appearance manager (platform-managed colours, fonts, density); the semantic token names above are its contract, so do not rename them. Open gaps and lessons: `progress.md`, section "Design-system overhaul, CI and public repo".
