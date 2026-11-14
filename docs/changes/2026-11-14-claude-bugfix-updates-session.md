# Bug fix and updates session log

- **Date:** 2026-11-14
- **Agent:** claude
- **Branch:** `docs/go-live-hardening-plan` (not merged yet; the real fix branch is set when work starts)
- **Area:** docs
- **Type:** fix
- **Supersedes:** none

## Summary
Running log for a bug fix and updates session. Opened 2026-11-14 and waiting for the owner's "start". No work has been done yet. Issues and updates below are filled in as the owner reports them and as they are fixed.

## What changed
Nothing yet.

### Issues
| # | Issue | Area | Status | Notes |
|---|---|---|---|---|
| 1 | After paying on Stripe Checkout the shopper lands on `https://0.0.0.0:3000/orders/.../thank-you` (page does not load) though the order is in the dashboard | web | Fixed, not committed | `apps/web/src/app/api/storefront/checkout/return/route.ts` built redirects from `req.url`, which behind the proxy is the bind address. Added `apps/web/src/lib/request-origin.ts` (`publicUrl` from forwarded host/proto) and used it in `checkout/return`, `checkout/abandon` (Stripe/PayPal cancel) and `market/select`. Provider success/cancel URLs were already built from forwarded host. |
| 2 | Product Carousel widget: the "New arrivals" / "Featured" tab option does not work (switching tabs does nothing) | blocks / web | Noted, not started | Seen on the storefront home "Fresh from the Collection" block. Not investigated yet. |
| 3 | Manual multi-currency "Choose your country" popup opens with a visible delay after the button is clicked | web | Noted, not started | Popup lists all countries. Make it open fast, following recommended practice and best practices (e.g. render the list lazily or virtualised, prefetch data, avoid blocking the click). Not investigated yet. |

### Updates
| # | Update | Area | Status | Notes |
|---|---|---|---|---|
| 1 | Footer widget: remove the "Background" preset selector (Plain / Soft background / Brand colour / Dark background). Replace it with a custom background colour setting plus a text colour setting. Also make sure the newsletter form fields (email input, Subscribe button) stay visible on any chosen colour | blocks / block-editor | Noted, not started | Block schema change, so bump the block version (ADR-009) and keep old preset values rendering. Not investigated yet. |

## Decisions and trade-offs
None yet.

## Verification
- Ran: `pnpm --filter @bs/web typecheck` pass; `vitest test/cart-checkout.test.ts` 23 pass.
- Exercised by hand: nothing (no real Stripe return driven).
- NOT verified: the redirect behind the live proxy; lint, build and the full gate; no new test for `publicOrigin`.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` (sections: ...)
- [ ] ADR (number ...) / not needed because ...
- [ ] `DEPLOYMENT.md` / RUNBOOK / not needed
- [ ] `progress.md` (status, known gaps, in-flight)

## Follow-ups and open questions
- Waiting for the owner to say "start" and list the issues and updates.

## Definition of done
Confirm each item in `AGENTS.md` section 7 before handoff: gate passes, tests added, docs updated, no secrets or generated files in the diff.
