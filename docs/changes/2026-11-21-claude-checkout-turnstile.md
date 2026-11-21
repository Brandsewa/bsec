# Cloudflare Turnstile bot check on store checkout

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `feat/checkout-turnstile` (merged in #301, 7ae64710)
- **Area:** domain, web
- **Type:** feature
- **Supersedes:** none

## Summary
Audit A3-04 / decision D7: per-IP and per-phone limits on `place-order` do not stop a script that rotates addresses and phones from placing cash-on-delivery orders that hold stock. Checkout now asks Cloudflare Turnstile for a token and the server verifies it before anything is created. It reuses the signup keys (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`), which are already on `bsec-web` in Coolify (checked 2026-11-21, names only).

## What changed
- `packages/domain/src/saas/abuse-protection.ts`: `getCheckoutTurnstileSiteKey()` (public key, only when BOTH keys are set) and `verifyCheckoutChallenge()`.
- `apps/web/src/app/api/storefront/checkout/place-order/route.ts`: optional `turnstileToken` in the body; verified after the rate limits and cart checks and before `placeOrder`. A refusal answers 400 `{ code: "challenge_failed" }` and creates nothing.
- `apps/web/src/app/checkout/page.tsx` -> `CheckoutContainer` -> `CheckoutForm`: `turnstileSiteKey` prop; the form shows the widget (invisible unless Cloudflare needs the shopper to act), holds the button as "Checking security..." until a token exists, sends the token, and remounts the widget after a refused attempt because a token works once.
- `apps/web/src/components/marketing/TurnstileWidget.tsx`: optional `appearance` prop (checkout uses `interaction-only`).
- **Bridge (owner choice, 2026-11-21):** Cloudflare allows only 10 hostnames per widget and stores can have any custom domain (e.g. `darjeelinghoney.com`), so the widget runs in a frame served by `apps/web/src/app/challenge-frame/route.ts` (plain HTML, platform host) and posts the token to the checkout page. `apps/web/src/lib/turnstile-bridge.ts` holds the pure helpers (`checkoutChallengeMode`, `parseBridgeMessage`, `toOrigin`); `apps/web/src/components/checkout/TurnstileBridge.tsx` embeds the frame and listens. Middleware lets `/challenge-frame` through on any host. Every store uses the bridge; only local development renders the widget directly.

## Decisions and trade-offs
- **Policy (owner, 2026-11-21):** on for every store. Keys missing or only one set: off, checkout unchanged. Token missing, expired, reused or rejected: refused. Cloudflare's verify service unreachable (network error, timeout, 5xx): the order is let through, because a third-party outage must not stop a store taking orders; the per-IP and per-phone limits remain.
- A shopper whose browser cannot load the widget cannot order (an ad blocker, for instance): the form says so and offers "Try again". Letting the client declare "the widget failed" would let a bot do the same, so there is no client-side bypass.
- The signup bypass tokens (`test-bypass`) are never accepted at checkout.
- Hostnames: only `bcom.si` must be on the widget's list (signup already needs it). The frame is not locked to particular parents because custom domains are unbounded; it posts the token only to the origin named in `?parent=` (never `*`), the checkout page accepts messages only from the frame element at the expected origin, and bot detection runs inside the widget wherever it is framed, so framing cannot skip the challenge.
- Caught by running it, not by typecheck or unit tests: with `cacheComponents` on, a route handler must not export `dynamic`.

## Verification
- `pnpm --filter @bs/domain exec vitest run test/checkout-turnstile.test.ts test/s2-turnstile.test.ts`: 12 pass (9 new).
- `pnpm --filter @bs/web exec vitest run`: all pass (new `test/checkout-turnstile.test.ts`, 7 tests, and `test/turnstile-bridge.test.ts`, 12 tests for the bridge; the first covers: refusal without token, refusal on rejected token, accept on confirmed token, fail-open when Cloudflare is down, off without keys, button held and unchanged). `perf-budget-bundle.int.test.ts` fails if run BEFORE a production build and passes after one; that explains the "3 failures" seen earlier in this session.
- `@bs/web` typecheck, lint (0 errors) and `pnpm --filter @bs/web build` pass; `@bs/domain` typecheck passes.
- Real browser, cross-origin (built-in browser, Cloudflare's public test keys): the frame from `http://localhost:3000` embedded in a page on `http://127.0.0.1:3001` delivered a token to the parent, stayed invisible (height 0) and sent no stray messages; a frame loaded with a different `?parent=` delivered nothing to this page. Cloudflare's siteverify accepted the test token with the always-pass secret and rejected it with the always-fail secret. The parent page was a small harness that applies the same origin and source checks, not the real checkout page (that needs a seeded store and database).
- NOT verified: the real checkout page in a browser, a store on a real custom domain, or the first live order after deploy.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (checkout paragraph), `DEPLOYMENT.md` (`TURNSTILE_*`), `docs/audit` A3-04 and D7 status, `progress.md` in-flight.
- [x] ADR: not needed (adds a check on an existing flow).
- [ ] RUNBOOK: not needed, no new env vars.

## Follow-ups and open questions
- After deploy: place one test COD order on a `*.bcom.si` store and one on `darjeelinghoney.com`, once from a computer and once from a phone. If a store ever shows "The security check could not load", check that `bcom.si` is still on the widget's hostname list and that `/challenge-frame` answers 200 on `https://bcom.si`.

## Definition of done
Gate run before push; no secrets or generated files in the diff.
