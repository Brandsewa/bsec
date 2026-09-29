# ADR-014: Admin sign-in and how the admin SPA reaches the API

- **Status:** Accepted
- **Date:** 2026-09-29
- **Plan reference:** PLAN §3, §4, §8 (Store Admin), ADR-005 (oRPC), ADR-012 (customer sessions)

## Context
The Store Admin is a static SPA (nginx) on `admin.<root>`; the API is the web app on `<root>`. Before this
ADR the admin had no login at all, its API client called the admin origin itself (which serves no API, so
every call returned 405), several pages rendered hardcoded sample data, and the API never resolved a
session, so every admin procedure failed with "Unauthorized". Coolify container hostnames are not stable,
so a reverse proxy from the admin container to the web container is fragile.

## Decision
1. **Staff sign-in is Better Auth (email + password)** served by the web app at `/api/auth/*`
   (`packages/auth` `createStaffAuth`). Public sign-up is disabled. Accounts are created only by the
   `create-owner` operator tool or by accepting a staff invitation.
2. **The admin calls the API cross-origin.** The API base is derived from the admin's own host
   (`admin.<root>` -> `<root>`, `localhost:5173` -> `localhost:3000`), overridable with `VITE_API_URL`.
   No rebuild is needed when the root domain changes (M8).
3. **Cookies:** HttpOnly, Secure (https), SameSite=Lax, scoped to the root domain (`.<root>`) so both hosts
   share the session. The API allows credentialed CORS only for the admin origin(s) from config.
   State-changing requests that carry a staff cookie must come from an allowed origin (CSRF defence).
4. **The tenant comes from the user's membership, never from the client.** `x-store-id` only selects among
   stores the signed-in user belongs to; `buildTenantContext` verifies the membership on every request
   (`admin.me.get` lists the user's stores via the `memberships_self_read` policy).
5. **Sign-in throttling counts failed attempts only** (5 per account, 20 per address, 15 minutes), stored
   in Postgres so it holds across containers. Successful sign-ins are never limited.
6. **Failure modes are explicit:** auth errors map to 401/403 (not 500); if `BETTER_AUTH_URL` /
   `BETTER_AUTH_SECRET` are missing, sign-in answers 503 with a clear message and the rest of the site keeps
   serving. A missing encryption key only blocks saving/reading stored credentials.
7. **The storefront gate does not apply to `/api/auth`, `/api/rpc/admin`, `/api/admin` or `/api/webhooks`,**
   nor to CORS preflights: those do not depend on a storefront host, and must keep working when a store is in
   maintenance/suspended or when the API is called on the platform root.

## Consequences
- Production needs `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` (32+ chars) on the web app. Defaults derive the
  admin origin and cookie domain from `BETTER_AUTH_URL`; `ADMIN_ORIGINS` / `COOKIE_DOMAIN` override them.
- Admin and API must stay on the same registrable domain (same-site cookies). A merchant custom domain is a
  storefront only; merchants always sign in at `admin.<platform root>`.
- Password reset by email needs the (deferred) email provider; until then it is an operator action.
- Customer sessions (storefront) remain out of scope (ADR-012).

## Alternatives considered
- **Reverse proxy `/api` on the admin host:** needs a stable internal hostname to the web container, which
  Coolify does not guarantee; also couples the two deployments.
- **Server-rendered admin inside the Next app:** removes CORS but throws away the existing SPA and its
  route-level code splitting; not justified for this fix.
- **Trusting `x-store-id` alone:** unsafe; it would let a user select any tenant.
