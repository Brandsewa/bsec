# Cloudflare Turnstile bot check on store checkout

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `feat/checkout-turnstile` (not merged yet)
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

## Decisions and trade-offs
- **Policy (owner, 2026-11-21):** on for every store. Keys missing or only one set: off, checkout unchanged. Token missing, expired, reused or rejected: refused. Cloudflare's verify service unreachable (network error, timeout, 5xx): the order is let through, because a third-party outage must not stop a store taking orders; the per-IP and per-phone limits remain.
- A shopper whose browser cannot load the widget cannot order (an ad blocker, for instance): the form says so and offers "Try again". Letting the client declare "the widget failed" would let a bot do the same, so there is no client-side bypass.
- The signup bypass tokens (`test-bypass`) are never accepted at checkout.
- Hostnames: Turnstile only works on hostnames listed on the widget. `*.bcom.si` stores work if `bcom.si` is listed; **merchant custom domains must be added to the widget's hostname list in Cloudflare or their checkout will show the load-failure message.** Production has `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`, so custom domains exist or are possible.

## Verification
- `pnpm --filter @bs/domain exec vitest run test/checkout-turnstile.test.ts test/s2-turnstile.test.ts`: 12 pass (9 new).
- `pnpm --filter @bs/web exec vitest run`: 40 files, 289 tests pass (new `test/checkout-turnstile.test.ts`, 7 tests: refusal without token, refusal on rejected token, accept on confirmed token, fail-open when Cloudflare is down, off without keys, button held and unchanged). `perf-budget-bundle.int.test.ts` fails if run BEFORE a production build and passes after one; that explains the "3 failures" seen earlier in this session.
- `@bs/web` typecheck, lint (0 errors) and `pnpm --filter @bs/web build` pass; `@bs/domain` typecheck passes.
- NOT verified: the widget in a real browser (needs a running store and Turnstile keys; Cloudflare's public test keys `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA` can be used locally), a real Cloudflare verification, or the first live order after deploy.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (checkout paragraph), `DEPLOYMENT.md` (`TURNSTILE_*`), `docs/audit` A3-04 and D7 status, `progress.md` in-flight.
- [x] ADR: not needed (adds a check on an existing flow).
- [ ] RUNBOOK: not needed, no new env vars.

## Follow-ups and open questions
- Before or with deploy: confirm the widget's hostname list in Cloudflare covers every live store and custom domain, then place one test COD order on a live store and one from a phone.
- If a store reports "security check could not load" on a custom domain, add the domain to the widget and it works at once; no deploy needed.

## Definition of done
Gate run before push; no secrets or generated files in the diff.
