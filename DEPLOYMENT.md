# Deployment Guide & Environment Variables

This document defines the deployment configuration and required environment variables for the Brand Sewa E-Commerce Platform (`bsec`).

## Required Environment Variables by Service

### Web (`bsec-web`)
- `DATABASE_URL_RW`: Connection string for PostgreSQL as `app_rw`.
- `DATABASE_URL_SAAS`: Connection string for PostgreSQL as `app_saas` (same host and database as `DATABASE_URL_RW`, user `app_saas`, password = `APP_SAAS_PASSWORD`). Used only by the self-service paths: public signup, owner-invite acceptance, plan changes and the Razorpay billing webhook. **Optional at boot**: when unset the site serves normally, but those endpoints answer 503 "Self-service is not configured".
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile keys for the public signup form (runtime env, no rebuild needed). In production signup is refused until BOTH are set (fail-closed); locally, with neither set, signup works without a challenge.
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `3000`.
- `HOSTNAME`: `0.0.0.0`.
- `BETTER_AUTH_URL`: **Required for admin sign-in.** The public origin of this app, e.g. `https://gobs.cloud`.
- `BETTER_AUTH_SECRET`: **Required for admin sign-in.** 32+ random characters (`openssl rand -hex 32`). Keep it stable: changing it signs everyone out.
- `ADMIN_ORIGINS` (optional): comma-separated admin origins allowed to call the API. Default: `https://admin.<host of BETTER_AUTH_URL>`.
- `COOKIE_DOMAIN` (optional): cookie domain shared by the API and admin hosts. Default: `.<host of BETTER_AUTH_URL>` on https.

Without `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` the site keeps serving but admin sign-in answers 503 ("not configured").
- `TENANT_SECRETS_KEY`: **Set before saving any payment/shipping/email credentials.** The app boots and serves without it (a warning is logged), but storing or reading tenant credentials fails until it is set. Master symmetric encryption key (32 bytes or 64 hex characters) used by `@bs/payments` and `@bs/shipping` (`encryptSecret`/`decryptSecret`) to secure payment gateway secrets and third-party credentials stored in `tenant_secrets`. (Fallback alias: `ENCRYPTION_KEY`).

### Platform (`bsec-platform`)
- `DATABASE_URL_PLATFORM`: Connection string for PostgreSQL as `app_platform` (BYPASSRLS).
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `4000`.
- `TENANT_SECRETS_KEY`: **Set before saving any payment/shipping/email credentials.** The app boots and serves without it (a warning is logged), but storing or reading tenant credentials fails until it is set. Used to decrypt and validate tenant credentials on platform administrative endpoints. (Fallback alias: `ENCRYPTION_KEY`).

### Worker (`bsec-worker`)
- `DATABASE_URL_RW`: Connection string for PostgreSQL as `app_rw`.
- `DATABASE_URL_SAAS`: as for web. Optional; without it the hourly trial-expiry sweep is skipped (a warning is logged).
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `4100`.
- `TENANT_SECRETS_KEY`: **Set before saving any payment/shipping/email credentials.** The app boots and serves without it (a warning is logged), but storing or reading tenant credentials fails until it is set. Used by background workers (e.g. transactional email dispatcher, payment webhooks, shipping background jobs) to decrypt tenant API keys (e.g. Resend, Razorpay). (Fallback alias: `ENCRYPTION_KEY`).

### Migration Runner (`bsec-migrate`)
- `DATABASE_URL_OWNER`: Connection string for PostgreSQL as `app_owner`.
- `DATABASE_URL_SUPERUSER`: Required only on initial bootstrap run to configure roles (`app_owner`, `app_rw`, `app_platform`, `app_saas`). Must be removed after first run.
- `APP_SAAS_PASSWORD`: password for the `app_saas` role (`openssl rand -hex 16`). Optional: when unset the role is not created and self-service stays disabled. Set it together with `APP_OWNER_PASSWORD`/`APP_RW_PASSWORD`/`APP_PLATFORM_PASSWORD` on the first run that includes `DATABASE_URL_SUPERUSER`, then use the same value in `DATABASE_URL_SAAS` for web and worker. Grants for the role are re-applied on every migrate run.

### Database roles
| Role | Used by | Notes |
|---|---|---|
| `app_owner` | migrate | owns tables, never used at runtime |
| `app_rw` | web, worker | tenant runtime, RLS applies; read-only on platform-owned tables |
| `app_saas` | web, worker (second pool) | member of `app_rw`, plus write on `signup_leads`, `slug_reservations`, `tenant_size_tiers`, `subscriptions`, `platform_invoices`, `quota_events`, `tenant_owner_invites`. NOBYPASSRLS |
| `app_platform` | platform only | BYPASSRLS |

## Encryption Key Specification
The code (`packages/payments/src/crypto.ts` and `packages/shipping/src/crypto.ts`) reads:
1. `TENANT_SECRETS_KEY` (primary)
2. `ENCRYPTION_KEY` (alias)

In `production` (`APP_ENV=production` or `NODE_ENV=production`), the services boot normally and log a warning, and saving or reading a credential fails with:
`Encryption key not set: TENANT_SECRETS_KEY or ENCRYPTION_KEY is required in production (PLAN §4)` Generate one with `openssl rand -hex 32`, add it to web, platform and worker in Coolify, and redeploy. Set it BEFORE entering any credentials, and never change it afterwards without re-entering them (changing it makes stored credentials undecryptable).

## Operator tools (run from a container terminal in Coolify)
Both are bundled in the images and never run automatically. Open the app in Coolify, go to **Terminal**, and run:

**Create or reset a store owner login** (worker container). Uses a hidden password prompt; the password is never printed or logged:
```
OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" STORE_SLUG=<store slug> node dist/create-owner.js
```
Running it again for the same email resets that person's password.

**Demo store** (platform container). Creates a separate store named "Demo Store" with sample products, customers and
orders in every state, so you can try every admin screen. It never touches your real store and never contacts Razorpay,
Shiprocket or email. Switch to it with the store selector at the top right of the admin.
```
OWNER_EMAIL=you@example.com node dist/demo.js seed
node dist/demo.js remove
```
`remove` deletes all demo rows and leaves the (archived, empty) shell; `seed` can be run again.

## First-time admin setup checklist
1. Set `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` on **bsec-web** (Runtime only), redeploy.
2. Run `create-owner` for your store from the worker terminal.
3. Open `https://admin.<your domain>` and sign in.
4. (Later) set `TENANT_SECRETS_KEY` on web, platform and worker before entering Razorpay/Shiprocket/Resend keys.
