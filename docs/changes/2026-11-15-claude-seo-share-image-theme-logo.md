# Share image and logo fall back to the theme logo

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `fix/seo-share-image-theme-logo` (not merged yet)
- **Area:** web
- **Type:** fix
- **Supersedes:** none (follows `2026-11-15-claude-seo-phase2.md`)

## Summary
After the Phase 2 deploy, `pnpm seo:audit https://ricwell.com` showed no `og:image` on any page: ricwell keeps its logo only in the theme header, and has no Brand logo, social image or SEO default image set, so the share image fallback found nothing. `getCachedBrandAssets` now falls back to the theme header or footer logo for the logo and the share image (the Organization schema already did).

## What changed
- `apps/web/src/lib/theme-brand.ts`: `withThemeLogoFallback`.
- `apps/web/src/server/cached-storefront.ts`: `getCachedBrandAssets` reads the theme header and footer only when Brand settings give no logo or share image.
- `apps/web/test/seo-phase2-helpers.test.ts`: three cases.
- No migration, env var, route or queue.

## Decisions and trade-offs
- Brand and SEO settings always win; the theme logo is the last fallback.
- No favicon is taken from a logo (rarely square). A store without a favicon needs one set in Brand settings: that is merchant setup, shown as a `no favicon link` warning by the audit.

## Verification
- Ran: root `pnpm typecheck` (17 tasks), web suite 258 pass (perf-budget test excluded: needs a build; Phase 2 left the page scripts unchanged and this adds only server code).
- NOT verified: on a running store; after deploy run `pnpm seo:audit https://ricwell.com` and expect the `no og:image` warnings gone.

## Docs updated
- [x] ADR, ARCHITECTURE and DEPLOYMENT not needed (no route, table, job or env var)

## Follow-ups
- Ricwell still needs a favicon in Brand settings; the Goomtee product still has no description (merchant content).
- Ricwell's `robots.txt` still shows the old copy from the Cloudflare cache (about 5.7 hours old when checked); the origin already serves the new one, so it clears within a day.

## Definition of done
Gate run before push. After merge: set the `Branch` line, delete the branch and worktree.
