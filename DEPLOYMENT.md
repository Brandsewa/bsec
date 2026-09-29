# Deployment Guide & Environment Variables

This document defines the deployment configuration and required environment variables for the Brand Sewa E-Commerce Platform (`bsec`).

## Required Environment Variables by Service

### Web (`bsec-web`)
- `DATABASE_URL_RW`: Connection string for PostgreSQL as `app_rw`.
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `3000`.
- `HOSTNAME`: `0.0.0.0`.
- `TENANT_SECRETS_KEY`: **Required in production.** Master symmetric encryption key (32 bytes or 64 hex characters) used by `@bs/payments` and `@bs/shipping` (`encryptSecret`/`decryptSecret`) to secure payment gateway secrets and third-party credentials stored in `tenant_secrets`. (Fallback alias: `ENCRYPTION_KEY`).

### Platform (`bsec-platform`)
- `DATABASE_URL_PLATFORM`: Connection string for PostgreSQL as `app_platform` (BYPASSRLS).
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `4000`.
- `TENANT_SECRETS_KEY`: **Required in production.** Used to decrypt and validate tenant credentials on platform administrative endpoints. (Fallback alias: `ENCRYPTION_KEY`).

### Worker (`bsec-worker`)
- `DATABASE_URL_RW`: Connection string for PostgreSQL as `app_rw`.
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `4100`.
- `TENANT_SECRETS_KEY`: **Required in production.** Used by background workers (e.g. transactional email dispatcher, payment webhooks, shipping background jobs) to decrypt tenant API keys (e.g. Resend, Razorpay). (Fallback alias: `ENCRYPTION_KEY`).

### Migration Runner (`bsec-migrate`)
- `DATABASE_URL_OWNER`: Connection string for PostgreSQL as `app_owner`.
- `DATABASE_URL_SUPERUSER`: Required only on initial bootstrap run to configure roles (`app_owner`, `app_rw`, `app_platform`). Must be removed after first run.

## Encryption Key Specification
The code (`packages/payments/src/crypto.ts` and `packages/shipping/src/crypto.ts`) reads:
1. `TENANT_SECRETS_KEY` (primary)
2. `ENCRYPTION_KEY` (alias)

In `production` (`APP_ENV=production` or `NODE_ENV=production`), boot/execution will fail loudly with:
`Encryption key not set: TENANT_SECRETS_KEY or ENCRYPTION_KEY is required in production (PLAN §4)` if neither is provided.
