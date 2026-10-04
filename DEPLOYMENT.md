# Deployment Guide & Environment Variables

This document defines the deployment configuration and required environment variables for the Brand Sewa E-Commerce Platform (`bsec`).

## Required Environment Variables by Service

### Web (`bsec-web`)
- `DATABASE_URL_RW`: Connection string for PostgreSQL as `app_rw`.
- `DATABASE_URL_SAAS`: Connection string for PostgreSQL as `app_saas` (same host and database as `DATABASE_URL_RW`, user `app_saas`, password = `APP_SAAS_PASSWORD`). Used only by the self-service paths: public signup, owner-invite acceptance, plan changes and the Razorpay billing webhook. **Optional at boot**: when unset the site serves normally, but those endpoints answer 503 "Self-service is not configured".
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile keys for the public signup form (runtime env, no rebuild needed). In production signup is refused until BOTH are set (fail-closed); locally, with neither set, signup works without a challenge.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`: **Product images.** Until the two keys are set the admin answers "Image storage is not set up yet" instead of accepting uploads. `R2_PUBLIC_URL` is the bucket's public address (no trailing slash, e.g. `https://media.bcom.si`); without it uploads work but no image is shown on the storefront. One-time setup in Cloudflare: (1) create an R2 bucket (default name `bsec-media`); (2) R2 -> Manage API tokens -> create a token with **Object Read & Write** on that bucket and copy the Access Key ID / Secret; (3) give the bucket a public address (connect a custom domain such as `media.bcom.si`, or enable the r2.dev URL for testing) and put it in `R2_PUBLIC_URL`; (4) add a **CORS rule** on the bucket: allowed origins `https://admin.bcom.si`, methods `PUT, GET, HEAD`, allowed headers `*`, so the admin can upload straight from the browser.
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `3000`.
- `HOSTNAME`: `0.0.0.0`.
- `BETTER_AUTH_URL`: **Required for admin sign-in.** The public origin of this app, e.g. `https://bcom.si`.
- `BETTER_AUTH_SECRET`: **Required for admin sign-in.** 32+ random characters (`openssl rand -hex 32`). Keep it stable: changing it signs everyone out.
- `ADMIN_ORIGINS` (optional): comma-separated admin origins allowed to call the API. Default: `https://admin.<host of BETTER_AUTH_URL>`.
- `COOKIE_DOMAIN` (optional): cookie domain shared by the API and admin hosts. Default: `.<host of BETTER_AUTH_URL>` on https.

Without `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` the site keeps serving but admin sign-in answers 503 ("not configured").
- `TENANT_SECRETS_KEY`: **Set before saving any payment/shipping/email credentials.** The app boots and serves without it (a warning is logged), but storing or reading tenant credentials fails until it is set. Master symmetric encryption key (32 bytes or 64 hex characters) used by `@bs/payments` and `@bs/shipping` (`encryptSecret`/`decryptSecret`) to secure payment gateway secrets and third-party credentials stored in `tenant_secrets`. (Fallback alias: `ENCRYPTION_KEY`).

### Platform (`bsec-platform`)
- `DATABASE_URL_PLATFORM`: Connection string for PostgreSQL as `app_platform` (BYPASSRLS). This is the only service that holds BYPASSRLS credentials.
- `BETTER_AUTH_SECRET`: **Required for Super Admin sign-in and export downloads.** 32+ random characters. Use a *different* value from the web app's.
- `PLATFORM_AUTH_URL`: the public origin of this API, e.g. `https://platform.bcom.si`.
- `SUPERADMIN_ORIGINS`: the exact origin(s) of the Super Admin app, comma separated, e.g. `https://superadmin.bcom.si`. Only these origins may call the API with credentials (CORS) and only these pass the origin check on state-changing requests. Wildcards are not supported on purpose: tenants own other `*.bcom.si` subdomains.
- `SUPERADMIN_URL` (optional): where staff invitation links point. Defaults to the first `SUPERADMIN_ORIGINS` entry.
- `PLATFORM_COOKIE_DOMAIN`: **leave unset.** The platform session cookie is host-only (`platform.bcom.si`) so it is never shared with tenant subdomains. Do not set the store's `COOKIE_DOMAIN` on this service.
- `ADMIN_HOST`, `PLATFORM_DOMAIN`: used to build owner-invite links (`https://admin.bcom.si/accept-invite?...`).
- `DELETION_SWEEP_INTERVAL_MS` (optional, default 60000): how often the service looks for tenant deletions whose grace period is over.
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `4000`.
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (optional): when set, the deletion workflow also deletes the store's media objects from Cloudflare R2. Without them the workflow records how many objects still need manual clean-up in the audit log.
- `TENANT_SECRETS_KEY`: **Set before saving any payment/shipping/email credentials.** The app boots and serves without it (a warning is logged), but storing or reading tenant credentials fails until it is set. Used to decrypt and validate tenant credentials on platform administrative endpoints. (Fallback alias: `ENCRYPTION_KEY`).

### Worker (`bsec-worker`)
- `DATABASE_URL_RW`: Connection string for PostgreSQL as `app_rw`.
- `DATABASE_URL_SAAS`: as for web. Optional; without it the hourly trial-expiry sweep is skipped (a warning is logged).
- `APP_ENV`: `production` | `staging` | `development`.
- `PORT`: `4100`.
- `TENANT_SECRETS_KEY`: **Set before saving any payment/shipping/email credentials.** The app boots and serves without it (a warning is logged), but storing or reading tenant credentials fails until it is set. Used by background workers (e.g. transactional email dispatcher, payment webhooks, shipping background jobs) to decrypt tenant and platform credentials (e.g. Razorpay, ZeptoMail SMTP). (Fallback alias: `ENCRYPTION_KEY`).

### Super Admin (`bsec-superadmin`)
- A static SPA (nginx) served at **`superadmin.bcom.si`** (port `8081` in staging/local). The platform **API stays at `platform.bcom.si`** and the SPA finds it by replacing the `superadmin.` prefix with `platform.` (or set `VITE_PLATFORM_API_URL` at build time).
- The store admin link used for support sessions is derived as `admin.<domain>` (or `VITE_STORE_ADMIN_URL`).
- No runtime environment variables. Create it in Coolify as a new application from `ghcr.io/brandsewa/bsec-superadmin`, domain `superadmin.bcom.si`, port `8081`, and add its Coolify application id to `APP_UUIDS` in `.github/workflows/ci.yml` (done: `mvpbrx2k9jp3q1invu8ayk48`). **Missing from that list = built but never redeployed**: on 2026-10-01 the Super Admin kept serving an old build for a day because it was left out.

### Migration Runner (`bsec-migrate`)
- `DATABASE_URL_OWNER`: Connection string for PostgreSQL as `app_owner`.
- `DATABASE_URL_SUPERUSER`: Required only on initial bootstrap run to configure roles (`app_owner`, `app_rw`, `app_platform`, `app_saas`). Must be removed after first run.
- `APP_SAAS_PASSWORD`: password for the `app_saas` role (`openssl rand -hex 16`). Optional: when unset the role is not created and self-service stays disabled. Set it together with `APP_OWNER_PASSWORD`/`APP_RW_PASSWORD`/`APP_PLATFORM_PASSWORD` on the first run that includes `DATABASE_URL_SUPERUSER`, then use the same value in `DATABASE_URL_SAAS` for web and worker. Grants for the role are re-applied on every migrate run.

### Upgrading an existing production database (adds `app_saas`)
Roles were bootstrapped once and `DATABASE_URL_SUPERUSER` was removed afterwards, so adding `app_saas` needs one more bootstrap run:
1. On `bsec-migrate` re-add `DATABASE_URL_SUPERUSER` (copy from the Postgres resource) and set `APP_SAAS_PASSWORD` (`openssl rand -hex 16`). Also re-enter the **existing** `APP_OWNER_PASSWORD`, `APP_RW_PASSWORD` and `APP_PLATFORM_PASSWORD` unchanged: the bootstrap re-applies all four passwords, so a different value would rotate that role's password and break the service using it.
2. Redeploy `bsec-migrate` (creates `app_saas` and applies migrations), then remove `DATABASE_URL_SUPERUSER` again.
3. Add `DATABASE_URL_SAAS` to `bsec-web` and `bsec-worker` and redeploy them.
Until step 3 the site works normally; only the self-service endpoints answer 503 "not configured".

### Other deployment settings that change behaviour
- `PLATFORM_DOMAIN` (default `bcom.si`): root domain for store subdomains; it and its subdomains can never be claimed as custom domains.
- `PREVIEW_BASE_URL` (platform, optional): where theme preview links point, with no trailing slash. Default `https://<MARKETING_HOST or PLATFORM_DOMAIN>`; set it for local development (for example `http://localhost:3000`). The preview page itself is served by the web app on the marketing host at `/preview/<code>`.
- `ADMIN_HOST` (default `admin.<PLATFORM_DOMAIN>`) and `MARKETING_HOST` (default `PLATFORM_DOMAIN`): also reserved; `MARKETING_HOST` is the only host that serves `/signup` and `/api/saas/*`.
- `CUSTOM_DOMAIN_CNAME_TARGET` (default `stores.<PLATFORM_DOMAIN>`): the hostname customers point their domain at; it must exist in the Cloudflare zone.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID`: custom domains stay in `requested` ("not configured") until both are set.
- `RAZORPAY_PLATFORM_KEY_ID`, `RAZORPAY_PLATFORM_KEY_SECRET`, `RAZORPAY_PLATFORM_WEBHOOK_SECRET`: plan changes answer "billing not configured" until set.

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
Bundled in the images and never run automatically. Open the app in Coolify, go to **Terminal**, and run:

**Bootstrap the first Platform Staff owner** (platform container). Uses an interactive hidden password prompt (min 10 characters), never printed or logged:
```
STAFF_EMAIL=brandsewaofficial@gmail.com STAFF_NAME="Platform Owner" node dist/create-staff.js
```
- The account can do nothing until it has set up an authenticator app: the first sign-in at `superadmin.bcom.si` shows a setup screen (secret + one-time backup codes), you confirm one code, and you are signed out. Every later sign-in is password + a code from the app (or a backup code, each usable once).
- If the email already belongs to an account (for example a store owner), that account's password is **not** changed; it simply becomes platform staff.
- **Lost phone / authenticator?** Run the same command again with `STAFF_RESET_MFA=1`: it removes the enrolment and all sessions so the person sets up a new authenticator. (This is why access to the platform container terminal must stay restricted.)

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

## First-time setup checklist
1. Set `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` on **bsec-web** (Runtime only), redeploy.
2. On **bsec-platform** set `BETTER_AUTH_SECRET` (a different random value), `PLATFORM_AUTH_URL=https://platform.bcom.si`, `SUPERADMIN_ORIGINS=https://superadmin.bcom.si`, `ADMIN_HOST=admin.bcom.si`, `PLATFORM_DOMAIN=bcom.si`; redeploy.
3. Create the **bsec-superadmin** application in Coolify (see above) with the domain `superadmin.bcom.si` and a DNS record for it.
4. Bootstrap the platform owner: run `create-staff` from the **platform** container terminal.
5. Open `https://superadmin.bcom.si`, sign in, and set up your authenticator app when asked; then sign in again with a code.
6. In Super Admin click **Create Store**: it provisions the first merchant store and shows a single-use owner invite link (nothing is e-mailed automatically). Give that link to the merchant so they set their own password. The store owner then finds **Settings → Support access** to approve or deny platform support requests.
7. **Configure Platform Transactional Email (Zoho ZeptoMail)**:
   - In Zoho ZeptoMail, add and verify your sending domain (e.g. `bcom.si`) by adding SPF, DKIM, and CNAME DNS verification records in Cloudflare DNS.
   - Create a Mail Agent in Zoho ZeptoMail and generate an SMTP Send Mail Token.
   - Open Super Admin -> **Email** (`https://superadmin.bcom.si/email`).
   - Configure SMTP Host (`smtp.zeptomail.in` for India DC), Port `587`, Secure: `STARTTLS`, From Address: `no-reply@bcom.si`, Username: `emailapikey`, and paste the Send Mail Token into SMTP Password.
   - Click "Save email settings". The password will be symmetrically encrypted with `TENANT_SECRETS_KEY` at rest.
   - Click "Send test email" to verify delivery before going live.
8. (Later) set `TENANT_SECRETS_KEY` on web, platform and worker before entering Razorpay/Shiprocket keys.

## Operating the platform (Super Admin)
- **Roles:** `platform_owner` (everything, including roles and emergency support), `platform_admin` (store lifecycle, plans, deletion, exports, staff invitations, support write-confirmation), `platform_support` (read everything, notes, support sessions they started). The last active owner can never be demoted or deactivated.
- **Support sessions:** always start read-only, 60 minutes (extendable once). Default consent is "owner approves in their store admin". The staff member gets a one-time link (`admin.<domain>/support#token=...`); only a hash of the token is stored. Write access needs a second confirmation by an admin. The store admin shows a fixed banner while a session is active and every request is counted and recorded.
- **Tenant deletion:** never immediate. The store goes offline at once, a grace period (default 7 days) runs, and it can be cancelled until the workflow starts. After that the platform service runs: export, stop billing, release domains, media clean-up, purge data, verify, mark deleted. A failed step is retried every minute and its error is shown on the store page. Invoices, the audit trail and the export are kept.
- **Suspend/archive changes reach the public storefront within about 60 seconds** (each web instance caches the host-to-store lookup for 60 s).
- **Exports** are gzipped JSON archives of all of a store's data with credentials removed. The download link is valid 15 minutes and needs an admin login.

## Wildcard store routing (Coolify / Traefik)

Every store lives at `<slug>.bcom.si`. Cloudflare DNS has one proxied wildcard record (`*.bcom.si` -> the server), but Coolify only writes Traefik routers for the domains typed into an application, so without help any store subdomain answers Traefik's `503 no available server`.

`bsec-web` therefore uses **manually managed container labels** (Application -> Container labels -> "Managed manually"). On top of the labels Coolify generates, these are appended (replace the id with the application's own, here `7wuzc3xhtzhxud3315pjutnd`):

```
traefik.http.routers.http-wild-<id>.entryPoints=http
traefik.http.routers.http-wild-<id>.middlewares=redirect-to-https
traefik.http.routers.http-wild-<id>.priority=1
traefik.http.routers.http-wild-<id>.rule=HostRegexp(`^[a-z0-9-]+\.bcom.si$`)
traefik.http.routers.http-wild-<id>.service=http-1-<id>
traefik.http.routers.https-wild-<id>.entryPoints=https
traefik.http.routers.https-wild-<id>.middlewares=gzip
traefik.http.routers.https-wild-<id>.priority=1
traefik.http.routers.https-wild-<id>.rule=HostRegexp(`^[a-z0-9-]+\.bcom.si$`)
traefik.http.routers.https-wild-<id>.service=https-1-<id>
traefik.http.routers.https-wild-<id>.tls=true
```

Notes:
- `priority=1` keeps the wildcard below the explicit routers, so `admin.`, `platform.`, `superadmin.` and `media.` keep going to their own applications.
- HTTPS for the wildcard is terminated by Cloudflare (proxied record); the origin serves the default certificate, so Cloudflare SSL mode must stay "Full".
- Because the labels are manual, **changing bsec-web's domains in Coolify does not update them**: edit the labels by hand.
- While the admin, platform or superadmin container restarts, the wildcard also catches its host and the web app answers with its "Opening Soon" page instead of a 503. That is expected for the duration of a deploy.
- `media.bcom.si` is the public address of the R2 images bucket, so `media` can never be a store slug.
- The platform's own site (`bcom.si`, `www.bcom.si`, or `MARKETING_HOST`) is served by the same application but is recognised by the layout and middleware (`apps/web/src/server/hosts.ts`) and never gets the store gate, header or footer.
