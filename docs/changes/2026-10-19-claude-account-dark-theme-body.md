# Customer account: body follows the light/dark theme

- **Date:** 2026-10-19
- **Agent:** claude
- **Branch:** `fix/account-dark-theme-body` (not merged yet)
- **Area:** web
- **Type:** fix
- **Supersedes:** none

## Summary
On `/account` pages the visitor's OS dark mode set `data-theme="dark"`, so cards, muted fills and text used the dark design tokens, but `body` stayed on the store's fixed white `--store-bg` and dark `--store-fg`. The dashboard showed dark cards on a white page with near-invisible text (order count, totals, name, Sign out).

## What changed
- `apps/web/src/app/globals.css`: `:root[data-theme] body` uses `--background` and `--foreground`. `data-theme` is only set on the themed account/auth paths (`THEMED_PATH_SOURCE`), so merchant storefront pages keep the store's own look.

## Decisions and trade-offs
Fixed at the body instead of recolouring each account component: the components already use the shared tokens, only the page canvas was wrong.

## Verification
- Ran: local `@bs/web` dev server, `/account/login`; computed body colours with `data-theme` dark = rgb(9,9,11) / rgb(250,250,250), light = white / rgb(10,10,10), unset = unchanged store colours (white / rgb(22,32,27)).
- NOT verified: the signed-in dashboard itself (needs a seeded customer); other account sub-pages.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed
- [ ] ADR not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK not needed
- [ ] `progress.md` not needed

## Follow-ups and open questions
- Walk the account pages in light and dark mode at 375 px and desktop.

## Definition of done
CSS-only change; checks listed above; no secrets or generated files in the diff.
