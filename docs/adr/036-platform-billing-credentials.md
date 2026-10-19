# ADR-036: Platform billing credentials live in Super Admin (supersedes ADR-014 point 1)

- **Status:** Accepted
- **Date:** 2026-10-18
- **Plan reference:** `docs/PLATFORM-BILLING-PLAN.md` (slice B0 and B1), ADR-014, ADR-035

## Context
ADR-014 kept the platform's own Razorpay credentials (used to charge merchants for their plan) in server environment variables only. That means the owner cannot set up, rotate or test billing without server access, and nothing in the product says whether billing is configured. The owner wants to enter the keys in Super Admin, start in test mode, and switch to live deliberately.

## Decision
1. The platform's billing credentials are stored in one platform table, `platform_billing_settings` (migration 0069): a test key set and a live key set (key id, secret, webhook secret), the active `mode`, an `enabled` switch and the `grace_days` after a failed payment. Secrets are AES-256-GCM encrypted with `TENANT_SECRETS_KEY` (same scheme as store credentials and platform email); key ids are stored as given. No API ever returns a secret; the UI sees only "configured" and the last four characters of the key secret.
2. Only `app_platform` writes the table. The self-service role (`app_saas`, used by the billing webhook and subscribe paths) has SELECT only; the store runtime role (`app_rw`) has no access.
3. Only a platform owner changes or tests the settings. Every change writes a `platform_audit_logs` row naming the fields changed, never values. Enabling billing or switching to live needs that mode's key id and secret saved first; a key id must carry the matching `rzp_test_` or `rzp_live_` prefix.
4. Billing code resolves credentials through `loadPlatformBillingCredentials`: saved keys of the active mode when billing is enabled, else the legacy `RAZORPAY_PLATFORM_*` env vars (so nothing breaks before the owner saves keys), else "not configured", reported honestly as ADR-014 point 4 requires.
5. ADR-014 points 2 to 4 stand: separate tables from store checkout, webhook isolation at `/api/webhooks/platform-billing` with a fail-closed signature check, honest disabled state.

## Consequences
- The owner configures, tests and switches billing in Super Admin, Integrations, Platform billing; the webhook URL to register in Razorpay is shown there.
- Losing or changing `TENANT_SECRETS_KEY` makes saved billing secrets unreadable (shown as not configured); the owner re-enters them.
- The platform now holds an encrypted live payment secret: the live key set stays empty until the full test-mode run has passed (plan slice B9).
