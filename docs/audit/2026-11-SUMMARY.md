# Platform audit summary

- **Plan:** `docs/PLATFORM-AUDIT-PLAN.md`
- **Last updated:** 2026-11-15, after phases 1 and 2 (first pass)
- **Code audited:** `main` e152e4b plus PR #274
- **Environment:** local worktree and local test Postgres only. Nothing was run against production.

## Where the audit stands

| Section | State | Findings file |
|---|---|---|
| A1 Tenant isolation and RLS | first pass done, partly covered | `2026-11-A1-tenant-isolation.md` |
| A2 Auth, sessions, permissions | first pass done, partly covered | `2026-11-A2-auth-permissions.md` |
| A3 Checkout, orders, money | first pass done, partly covered | `2026-11-A3-checkout-money.md` |
| A4 Payments and webhooks | first pass done, partly covered | `2026-11-A4-payments-webhooks.md` |
| A5 to A15 | not started | |

"Partly covered" means: every check in the plan has a result of pass, finding or "not checked", and the "not checked" list in each file is real work still to do. This is not a clean bill of health for those four sections.

## Counts

| Severity | A1 | A2 | A3 | A4 | Total |
|---|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 1 | 0 | 1 |
| Medium | 0 | 0 | 3 | 1 | 4 |
| Low | 3 | 5 | 4 | 2 | 14 |
| Info | 0 | 0 | 0 | 1 | 1 |
| Unconfirmed, needs a live check | 1 | 1 | 0 | 0 | 2 |

## Findings by severity

| ID | Severity | Title | Evidence | Status |
|---|---|---|---|---|
| A3-01 | High | Orders are charged the price saved in the cart, not the current price | real-database test | fixed (PR pending) |
| A3-02 | Medium | Unpublished or deleted products can still be ordered from an old cart | real-database test | fixed (PR pending) |
| A3-03 | Medium | Turning off guest checkout blocks every order | code read | fixed (PR pending) |
| A3-04 | Medium | No per-visitor limit or bot check on order placement | code read (hardening item 1.7) | open |
| A4-01 | Medium | A payment arriving for a cancelled order is recorded with no alert | real-database test | fixed (PR pending) |
| A1-02 | Unconfirmed | Store chosen from `X-Forwarded-Host` before `Host` | code read; proxy behaviour unknown | needs a live check |
| A2-05 | Unconfirmed | Rate-limit IP depends on undocumented `TRUST_CLOUDFLARE` | code read; production value unknown | needs a live check |
| A1-01 | Low | Store runtime role can use shared tables that have no row-level security | `scripts/audit-rls.sql` | open |
| A1-03 | Low | A pending custom domain blocks the hostname for other stores | code read, partly | open |
| A1-04 | Low | `TenantContext or string` overloads skip the permission check | code read | open |
| A2-01 | Low | 15 platform mutations check the role level only at the route | `scripts/audit-api-guards.mjs --platform` | open |
| A2-02 | Low | Onboarding dismiss checked no permission (the other 7 route-only cases were a script blind spot and are fine) | `scripts/audit-api-guards.mjs`, corrected | fixed (PR pending) |
| A2-03 | Low | Accepting a staff invitation writes no audit log | real-database test | fixed (PR pending) |
| A2-04 | Low | "Keep at least one owner" can be raced | code read; race not reproduced | fixed by row lock (PR pending), not proven by test |
| A2-06 | Low | Sign-in codes stored as plain SHA-256; phone-only customers get an email at a real domain | code read | open |
| A3-05 | Low | Customer-only discounts go to whoever types the customer's contact | existing test encodes it | owner decision |
| A3-06 | Low | Order-created job sent after commit | code read | open |
| A3-07 | Low | Cart quantity has no upper limit | code read | fixed (PR pending) |
| A3-08 | Low | Place-order route builds its own context with a staff role | code read | fixed (PR pending) |
| A4-02 | Low | Unsigned webhook requests are stored | code read | open |
| A4-03 | Low | Webhook route returns internal error text | code read | fixed (PR pending) |
| A4-04 | Info | Store picked from the request before the signature check | code read, existing test | safe as built |

## Suggested fix order

1. ~~A3-01 and A3-02 together~~ done: cart lines are re-checked at checkout.
2. ~~A3-03~~ done: the place-order route passes the signed-in customer to `placeOrder`.
3. ~~A4-01~~ done: a late payment on a cancelled order is recorded, refundable, and alerts the store.
4. The two live checks (A1-02, A2-05), then fix or close them.
5. A3-04 with the go-live hardening work.
6. Still open, with reason: A1-01 (RLS on shared tables: a migration and grants review), A1-03 (pending domains: product decision), A1-04 and A2-01 (signature changes across many callers), A2-06 (phone sign-in not live), A3-04 (rate limits and bot check: hardening item 1.7), A3-06 (job enqueue inside the transaction: needs design), A4-02 (invalid-signature webhooks kept for diagnosis: decision).

## Owner decisions

- A3-05: accept typed-contact identity for customer-only discounts, or require sign-in for those codes.
- A1-02 and A2-05: permission for the two read-only live checks, and the production value of `TRUST_CLOUDFLARE`.
- Whether the second pass over the "not checked" lists of A1 to A4 comes before or after phases 3 to 7.
