# Theme page set: production rollout and what is left to refine

- **Date:** 2026-10-15
- **Agent:** claude
- **Branch:** `docs/theme-templates-rollout` (not merged yet)
- **Area:** docs, themes, infra
- **Type:** docs
- **Supersedes:** none

## Summary
Closes out the theme page set work. The code is in production (PR #77 and #78). The new design lives in a separate "Modern Commerce" theme, now created on production as a hidden draft. No store uses it yet; the owner will refine it and then publish and activate it.

## What changed
- Production: `node dist/seed-templates.js` was run by the owner in the platform container terminal (creates or refreshes the draft `modern-commerce`; publishes nothing, touches no store).
- Verified by hand on production, read only: Super Admin theme editor lists Collection archive, Collection page, Product page, Cart page, Header, Footer and Default pages; the Default pages form opens; the Modern Commerce draft opens with its home and product pages.
- `progress.md`: in-flight line cleared, M12 status and the refinement list added.

## Decisions and trade-offs
- Stores keep their own saved copy of a theme, so deploying code does not change a live store; the new look appears only after Modern Commerce is published and activated for that store (activation adds a page version, so it can be rolled back).

## Verification
- Ran: see `2026-10-15-claude-theme-page-set.md` (Update 15) for the gate.
- Exercised by hand: Super Admin editor and `/collections`, `/search` on production, view only.
- NOT verified: Modern Commerce rendered on a real store; mobile layouts; checkout and account on production.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [ ] ADR: not needed (ADR-032 covers it)
- [x] `DEPLOYMENT.md` (seed tool, in PR #78)
- [x] `progress.md`
