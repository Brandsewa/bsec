# Ruttl bug-tracking widget on the review surfaces

- **Date:** 2026-11-19
- **Agent:** claude
- **Branch:** `feat/ruttl-bug-widget`  (not merged yet)
- **Area:** web, admin, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
The owner wants Ruttl (third-party visual bug reporting) on a fixed set of surfaces so the team can file bugs while reviewing: the platform site, the Super Admin, the brandsewa store with its customer and merchant dashboards. It must never appear on other tenants.

## What changed
- `apps/web/src/components/RuttlWidget.tsx`: renders `<ruttl-widget>` plus the Ruttl script (`lazyOnload`) only when the request host is `bcom.si`, `www.bcom.si` or `brandsewa.bcom.si`. Used in both branches of `apps/web/src/app/layout.tsx` (marketing and store). The customer dashboard (`/account`) is part of the storefront, so it is covered.
- `apps/superadmin/src/lib/ruttl.ts`, called from `main.tsx`: loads only when the hostname is `superadmin.bcom.si`.
- `apps/admin/src/lib/ruttl.ts`, called from `routes/_store.tsx`: the store admin is one app for every merchant, so it loads only when the active store's storefront URL host is `brandsewa.bcom.si`.
- No env vars; the project id and host lists are constants (the id is public in the page HTML anyway).

## Decisions and trade-offs
- Constants in code instead of env: the admin SPAs have no runtime env, and the web app would otherwise need a Coolify change.
- Support sessions viewing brandsewa in the admin also get the widget (it keys on the store, not the user).
- Temporary: remove the three hosts/constants when the review period ends.

## Verification
- Ran: `pnpm typecheck`, `pnpm lint`, targeted per app (see PR for gate output).
- NOT verified: not driven in a browser here; the first check is on staging/production after the merge.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure, route, table or env change)
- [ ] ADR: not needed (temporary tooling)
- [ ] `DEPLOYMENT.md`: not needed (no env vars)
- [ ] `progress.md`: in-flight line added and removed at merge

## Follow-ups and open questions
- Owner wrote `brandsewa.store.com`; used `brandsewa.bcom.si`. Add the other host to the lists if it exists.

## Definition of done
Gate run before push; no secrets or generated files in the diff.
