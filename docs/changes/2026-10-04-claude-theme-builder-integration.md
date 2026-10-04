# Theme builder integration: merge `feat/commerce-page-templates` into current `main`

- **Date:** 2026-10-04
- **Agent:** claude
- **Branch:** `integrate/theme-builder` (from `feat/commerce-page-templates` + `origin/main`)
- **Area:** blocks, block-editor, domain, db, web, superadmin, admin, platform
- **Type:** feature (integration)
- **Supersedes:** none (see `2026-10-02-claude-commerce-page-templates.md` and `2026-10-04-zcode-handoff-theme-builder-restored.md` for the work itself)

## Summary
The theme-builder work (cart as a theme page, `CartContents`, Modern Commerce draft theme, theme archive/delete, previews, responsive heading sizes, editor chrome) lived on a branch based on a 2 October `main`. It is now merged with current `main` (Orders, Catalog, Customers, Segments, Settings, dev-speed).

## Conflicts and how they were resolved
- **Migrations**: the branch's `0020_theme_template_archive` and `0021_theme_previews` collided with main's `0020_preorders` / `0021_order_tags`. Renamed to `0031_theme_template_archive` and `0032_theme_previews`, journal rebuilt from main's plus two entries (idx 31, 32). Both are idempotent (`IF NOT EXISTS`, guarded UPDATE), so a developer database that applied them under the old tags re-runs them harmlessly.
- `ProductDetailSection.tsx`: kept the sticky mobile buy bar and main's reviews section.
- `VariantSelector.tsx`: kept main's quotes ("Request a quote"), sale pricing and pre-order notice, and the theme's `showSku` / `trustPoints` options; the add-to-cart wrapper keeps `id="buy-box"` (the mobile bar anchors to it).
- `ARCHITECTURE.md`, `progress.md`: both sides kept; migration table gained 0031/0032.

## Fixes needed after the merge
- `apps/web/src/server/preview-samples.ts`: preview sample data lacked `indexable` (collections) and `priceOnRequest` (products), fields added on main after the branch point (typecheck failure).
- `apps/platform/test/rbac.int.test.ts`: `templates.createPreview` and `templates.delete` had no declared minimum role (both `platform_admin`); the RBAC completeness test failed.

## Verification
- `docs:check`, `typecheck` 15/15, `lint` 15/15, `build` 6/6.
- `@bs/blocks` 113, `@bs/block-editor` 10, `@bs/domain test:fast` 268, `@bs/web test:fast` 163, `@bs/admin` 53, `@bs/platform` 78 (run with `--no-file-parallelism`): pass.
- `@bs/domain` heavy (real Postgres 18, local container): 66 files, 1,421 tests pass (teardown noise only).
- Not run: browser walkthrough of the Super Admin theme editor, store admin Themes and the storefront cart/product/collection pages on the merged code (the owner reviewed the super admin on the old stack; ZCode's hand-off says store admin and storefront were never verified). The staging e2e in CI covers sign-in flows only.

## Follow-ups
- Local databases: `bsec-dev` holds the theme data (Modern Commerce v22). It is safe to run the merged migrations on it (idempotent); take a `pg_dumpall` first anyway.
- `feat/superadmin-themes` carries an optional staff-TOTP toggle (`4619fcd`) that is deliberately **not** included: production keeps MFA required.
- Browser verification round for ZCode: Themes list tabs, editor widgets (HeroSlider, ProductShowcase), cart page, mobile buy bar, quote/pre-order buttons on the product page.

## Definition of done
- [x] Gate (typecheck, lint, build, docs, fast and real-DB tests). [x] ARCHITECTURE migration table updated. [x] Change record. [ ] Browser walkthrough pending.
