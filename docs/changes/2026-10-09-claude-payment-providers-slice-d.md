# Payment gateways: platform enablement and store activation (Razorpay, Stripe), Phase 4 slice D

- **Date:** 2026-10-09
- **Agent:** claude
- **Branch:** `feat/admin-improvements-phase-4d` (built on `feat/admin-improvements-phase-4`; not merged)
- **Area:** db, domain, payments, platform, web, admin, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
Super Admin can now enable Razorpay and Stripe for the platform (and separately allow live mode). Stores see only enabled gateways in Settings > Payments, save their own keys, test the connection and activate. Built by Claude (not the usual builder) at the owner's request, on top of GA's slices A to C; test mode only, no live keys.

## What changed
- Migration `0053_platform_payment_providers`: `platform_payment_providers` (Razorpay seeded enabled, Stripe disabled, live mode closed; `app_platform` writes, `app_rw` read-only) and `payment_methods_provider_chk` widened to allow `stripe`.
- `packages/payments/src/providers/stripe.ts`: `StripeProvider` on Stripe-hosted Checkout via REST `fetch` (no SDK), pinned `STRIPE_API_VERSION`, idempotency keys, `Stripe-Signature` verification (5 minute tolerance, no shared-secret fallback), partial refunds, read-only `testConnection`.
- `packages/domain/src/platform/payment-providers.ts` (platform list and update, audited as `payment_provider.*`) and `packages/domain/src/admin/payment-providers.ts` (store list, save keys, test, activate, clear; gate `assertPaymentProviderEnabled`). `saveRazorpayCredentials` now applies the same gate and refuses live keys until live mode is allowed.
- Contracts and handlers: `integrations.paymentProviders` / `updatePaymentProvider` (platform, `platform_admin` to change), `admin.paymentProviders.*` (store).
- Super Admin `/integrations/payments` is now real (the previous page held its switches in local React state and saved nothing); hub overview reads real data. Store Admin Settings > Payments has gateway cards and a drawer.
- Webhook route accepts `stripe` (verified with the store's own `whsec_`); events are stored in the inbox but change no orders yet.
- Also: Zoho adapter no longer treats a template name as a Zoho template key when no map exists (slice C note); `b2-grants` expected-writable list now includes `platform_message_log` (slice C had left that gate red); `AGENTS.md` rule 14, `progress.md`, ADR-023, DEPLOYMENT.md, ARCHITECTURE.md updated.

## Decisions and trade-offs
- **Online checkout is not switched on.** The code base has no checkout path that creates Razorpay or Stripe sessions (`ONLINE_PAYMENT_AVAILABLE` is false; the order gets a placeholder id). Activating a gateway marks it ready; shoppers still pay by COD. The UI says so. Wiring checkout (create session, redirect, apply `checkout.session.completed` / `payment_intent.payment_failed` / `charge.refunded`) is a separate change and needs a design decision on the order and thank-you flow.
- Disabling at platform level never strands money: keys stay, deactivate and key removal work, webhooks for existing intents and refunds keep working; only new key saves, activations and new intents are blocked.
- Razorpay ships enabled so stores that already manage keys see no change.
- `STRIPE_API_VERSION` was written from memory and could not be confirmed against Stripe's changelog from here; confirm it before going live.

## Verification
- `pnpm typecheck` 15/15, `pnpm lint` 15/15, `pnpm build` 6/6, `pnpm docs:check` ok.
- `pnpm test:heavy:local` (shared local Postgres): 93 files, 1969 tests passed. Includes new `payment-providers.int.test.ts` (12) and the isolation suite mapping for `admin.paymentProviders.*`.
- `@bs/payments` 31/31 (new `stripe.test.ts`: signed fixtures, tampered/stale/missing signatures, rotation, idempotency headers, redaction); `@bs/web` test:fast 175; `@bs/admin` 74; `@bs/contracts` 20; `@bs/db` test:fast 27 and `b2-grants` 6/6; `apps/platform` rbac + read-endpoints + audit-coverage 88/88.
- Browser walkthrough `e2e/walkthrough-payments.mjs` (Chrome, Playwright, **mocked and stateful RPC**, so it proves the screens and wiring, not the server): 20/20 checks at 1280x800 and 375x812 (screenshots in `apps/superadmin/walkthrough-artifacts/payments/`, not committed).
- NOT verified: a real Stripe or Razorpay call (no keys, none used), a webhook from Stripe itself, the live stack end to end (web + platform + databases together).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration 0053, schema file)
- [x] ADR-023 extended; `DEPLOYMENT.md`; `AGENTS.md` rule 14; `progress.md` decisions
- [ ] `progress.md` in-flight: not added (single session)
