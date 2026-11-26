# Go-live hardening plan (online payments)

- **Status:** parked by the owner on 2026-11-03. Nothing here is implemented. The owner will ask for the pending list later; pick it up from section 4.
- **Why now:** online payments are the point where a failure costs real money (lost orders, double charges, stolen merchant accounts, unrecoverable data). Four areas move up in priority: backups and recovery, monitoring and alerting, abuse protection, account security.
- **Owner decisions needed before starting:** section 7.
- **Affects:** `infra/`, `infra/coolify/RUNBOOK.md`, `DEPLOYMENT.md`, Cloudflare and Coolify dashboards, `packages/auth`, `packages/db` (role settings), `apps/web` (headers, checkout routes), `apps/worker` (alerts on jobs).
- **Rules that apply:** `AGENTS.md` section 2 rule 7 (secrets), rule 9 (DB roles), rule 12 (server recomputes totals), rule 13 (side effects after commit), rule 14 (live provider keys are deferred; lifting it is the owner's call, section 7), section 5 (infra changes need the owner's yes in session).
- **Related:** `docs/FAILOVER-PLAN.md` (standby server, parked), `docs/ADMIN-IMPROVEMENTS-PLAN.md` section 6.4 (gateways), `docs/PLATFORM-BILLING-PLAN.md`, `infra/backups/`, `infra/runbooks/INCIDENT.md`.

## 1. Where we are today

Read from the docs and the code on 2026-11-03. **Nothing was run or tested against production**; items marked *confirm* need a live check by the owner or an agent with the owner's yes.

| Area | State | Source |
|---|---|---|
| Postgres backups | Daily Coolify `pg_dump` 02:30 UTC, local plus R2 `bsec-backups`. **RPO up to 24 h** | RUNBOOK section 8 |
| Point-in-time recovery | pgBackRest design written, **not active** | `infra/backups/README.md` |
| Restore drill | **Never done** | RUNBOOK section 8 |
| R2 backup retention | No lifecycle rule, grows unbounded | RUNBOOK section 8 |
| Uptime monitoring | Live (Better Stack, 3-minute checks, status page) | `infra/uptime/README.md` |
| Docs disagree on uptime | RUNBOOK section 9 still says "not set up yet": **stale, fix in the same change** | RUNBOOK section 9 |
| Error tracking | Sentry wired in code, **no DSNs set** | RUNBOOK section 9 |
| Log shipping | pino JSON to stdout only, short-lived in Coolify; Better Stack drain not done | RUNBOOK section 9 |
| Alert rules | `infra/monitoring/alerts.yaml` has capacity rules; *confirm* anything evaluates them and routes to a phone. No payment-specific rules | `infra/monitoring/` |
| Per-tenant rate limits | Done (tier quotas, 429 with `Retry-After`) | `packages/domain/src/system/rate-limit.ts` |
| Auth-endpoint limits | Limiters exist for password reset, invite accept, reserve subdomain, lead capture; platform sign-in has per-route limits; Better Auth's own limiter is **off** for staff. *Confirm* merchant sign-in, customer sign-in codes and `checkout/pay` are limited | `packages/auth/src/staff.ts`, `platform.ts`, `apps/web/src/server/api.ts` |
| Bot protection | Turnstile is in the stack on signup; *confirm* coverage of sign-in, checkout and pay | `apps/web/src/app/signup` |
| DB statement timeouts | **Missing** at role level (only the segment preview sets one) | `docs/FAILOVER-PLAN.md` section 1 |
| MFA | Platform staff: TOTP plus backup codes, done. Merchant staff: `twoFactors` table exists, **plugin not enabled** | `packages/auth/src/platform.ts`, `staff.ts` |
| Webhook signatures | Verified per provider (Razorpay, Cashfree, Stripe, PayPal) using each store's own secret | `apps/web/src/app/api/webhooks/[provider]/route.ts` |
| Webhook replay / idempotency | *Confirm* a duplicate or out-of-order event cannot double-mark an order paid | same file |
| CSP and security headers | "CSP header and CSRF review" listed as still open in `progress.md`; headers found only on media routes | `progress.md` |
| Platform and Super Admin exposure | RUNBOOK and INCIDENT disagree on Cloudflare Access: *confirm which is true* | RUNBOOK section 5, INCIDENT section 2 |
| Dependency scanning | Dependabot weekly; known transitive-package alerts need pnpm overrides | `.github/dependabot.yml`, memory note |
| Secret scan | Gitleaks in CI | `.gitleaks.toml` |

## 2. Principles

1. **Test mode first, live last.** Rehearse the whole payment path on test keys before any live key exists (rule 14).
2. **Never lose an order or a payment record.** A paid order must always be recoverable from the provider's side and ours.
3. **Alert a human, not a dashboard.** Every critical signal reaches the owner's phone.
4. **Each item has an acceptance check** (section 5). "Done" means the check was run, not that code was written.

## 3. Phases

### Phase 1: blockers before the first live payment

| # | Item | Area | Effort |
|---|---|---|---|
| 1.1 | **Execute a restore drill**: pull the newest R2 dump, restore into a scratch Postgres, run migrate (must be a no-op), compare row counts, log RPO/RTO. Add an R2 lifecycle rule on `bsec-backups` | Recovery | S |
| 1.2 | **Set Sentry DSNs** for web, platform, worker. Scrub tokens, card-like fields and `Authorization` headers before send | Monitoring | S |
| 1.3 | **Route alerts to the owner's phone** (Better Stack on-call or SMS/WhatsApp). Confirm the capacity rules in `alerts.yaml` are actually evaluated, or move the critical ones into Better Stack | Monitoring | S to M |
| 1.4 | **Payment-specific alerts**: webhook signature failures spike, webhook 5xx, orders stuck in pending-payment beyond N minutes, `checkout/pay` 5xx rate, job queue lag on payment jobs, refund failures | Monitoring | M |
| 1.5 | **Ship logs** to Better Stack (drain) with a retention that covers a dispute window; keep `request_id`, `tenant_id`, `order_id`, provider event id; never log secrets or full payloads | Monitoring | S to M |
| 1.6 | **Role-level `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout`** for `app_rw`, `app_saas`, `app_platform` (a migration or role bootstrap change, expand/migrate/contract) | Reliability | S |
| 1.7 | **Rate limit and bot-check** the abuse targets: merchant sign-in, customer sign-in codes, password reset, signup, `checkout/place-order`, `checkout/pay`, coupon and gift-card lookups. Turnstile on the public ones. Per-IP and per-account | Abuse | M |
| 1.8 | **Webhook idempotency and replay test**: store provider event ids, ignore duplicates, tolerate out-of-order events, reject stale timestamps. Real-database test | Payments | M |
| 1.9 | **CSP and security headers** (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame protections) on web and both SPAs; CSRF review of cookie-authenticated mutations | Security | M |
| 1.10 | **Close the exposure question**: confirm whether `platform.` and `superadmin.` sit behind Cloudflare Access; if not, add it or an IP allowlist; fix whichever doc is wrong | Security | S |
| 1.11 | **Test-mode end-to-end rehearsal** on staging or a local stack: order, pay, webhook, refund, failed payment, abandoned payment, duplicate webhook. Written up as a test change record | Payments | M |
| 1.12 | **Fix the stale RUNBOOK section 9** (uptime is live) and add the new alerts and drills to `INCIDENT.md` | Docs | S |

### Phase 2: first month after going live

| # | Item | Area | Effort |
|---|---|---|---|
| 2.1 | **Point-in-time recovery** (pgBackRest or WAL archiving to R2) to cut RPO from 24 h to minutes; repeat the restore drill against it | Recovery | M to L |
| 2.2 | **Merchant MFA**: enable the Better Auth `twoFactor` plugin for store staff; optional for all, **required for owners and anyone with `payments.manage`**; backup codes; recovery path | Account security | M |
| 2.3 | **Session hygiene**: session list and revoke, re-auth before changing payment keys, bank details, or staff roles | Account security | M |
| 2.4 | **Secret rotation drill**: rotate `TENANT_SECRETS_KEY` safely (re-encrypt tenant credentials), `BETTER_AUTH_SECRET`, DB role passwords; document the steps | Security | M |
| 2.5 | **Dependency and image scanning** in CI (fix the transitive Dependabot alerts with pnpm overrides; add image vulnerability scan) | Security | S to M |
| 2.6 | **Reconciliation job**: compare provider payments with our orders daily and report mismatches | Payments | M |
| 2.7 | **Monthly restore drill** on a calendar, results logged | Recovery | S |
| 2.8 | **Load test at launch scale** with the k6 scripts in `infra/loadtest/` against a production-size dataset | Reliability | M |

### Phase 3: later (separate plans)

Persistent staging server, standby server and failover (`docs/FAILOVER-PLAN.md`), managed Postgres with a replica, per-tenant feature flags for gradual rollout.

## 4. Pending list (what to report when the owner asks)

Status values: `not started`, `in progress`, `done (verified)`. Update this table in place as work happens; it is the one place that answers "what is still pending".

| # | Item | Status |
|---|---|---|
| 1.1 | Restore drill and R2 lifecycle | not started |
| 1.2 | Sentry DSNs | not started |
| 1.3 | Alerts reach the owner's phone | not started |
| 1.4 | Payment-specific alerts | not started |
| 1.5 | Log shipping | not started |
| 1.6 | Role-level DB timeouts | not started |
| 1.7 | Rate limits and bot checks on abuse targets | not started (partly existing, to be confirmed) |
| 1.8 | Webhook idempotency and replay test | not started (to be confirmed) |
| 1.9 | CSP, security headers, CSRF review | not started |
| 1.10 | Cloudflare Access question for platform and Super Admin | not started |
| 1.11 | Test-mode end-to-end rehearsal | not started |
| 1.12 | RUNBOOK section 9 and INCIDENT updates | not started |
| 2.1 to 2.8 | Phase 2 items | not started |

## 5. Acceptance criteria

A Phase 1 item is done only when its check has been run and recorded in `docs/changes/`:

- **1.1** A restore from an R2 object finished, `pnpm --filter @bs/db migrate` was a no-op, row counts match, RTO and RPO are written down, and a lifecycle rule exists.
- **1.2** A deliberate test error from each service appears in Sentry with secrets scrubbed.
- **1.3 and 1.4** Each alert was triggered once on purpose (for example a bad-signature webhook, a stuck pending order) and reached the owner's phone within the target time.
- **1.5** A request can be traced end to end by `request_id` in the log tool; a search for a known test secret finds nothing.
- **1.6** `SHOW statement_timeout` (and the other two) return the intended values for each runtime role; a deliberately slow query is cancelled.
- **1.7** A scripted burst gets 429 with `Retry-After` on each listed route; normal use is unaffected; Turnstile failure blocks the action.
- **1.8** A real-database test replays the same event twice and out of order; the order is paid once and the ledger has one entry.
- **1.9** A header scan shows the policies on all three hostnames; the storefront, admin and Super Admin still work (checked by running them).
- **1.10** An unauthenticated request to the platform and Super Admin hosts from outside is refused or challenged, as intended; docs match.
- **1.11** The rehearsal's written results list each scenario and its outcome; failures are fixed or recorded as known gaps.

Also required for every item: `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, relevant real-database tests, and a change record (`AGENTS.md` sections 4 and 7).

## 6. Risks

| Risk | Mitigation |
|---|---|
| Statement timeouts cancel a legitimate long job (imports, reports) | Set them per role, exempt the migrate role, test the bulk import and exports first |
| Rate limits block real shoppers behind shared IPs | Per-account and per-device limits as well as per-IP; watch 429 rates after launch |
| CSP breaks the theme editor, embeds, or third-party scripts | Roll out report-only first, then enforce |
| Merchant MFA locks owners out | Backup codes, owner-assisted recovery by Super Admin with audit log |
| Alert fatigue | Few, actionable, phone-worthy alerts; the rest go to a channel |
| Log retention stores personal data | Redact; retention matches the dispute window only |
| Infra changes done on production by mistake | Every dashboard change needs the owner's yes in session (`AGENTS.md` section 5) |

## 7. Owner decisions needed

1. **Lift rule 14** for live provider keys, in writing, and when. Until then everything stays on test or sandbox keys.
2. **Which providers go live first** (Razorpay for India is the likely first; PayPal for global per `MULTIMARKET-PLAN.md`).
3. **Where alerts should reach you** (phone call, SMS, WhatsApp, email) and who is on call.
4. **Accepted RPO and RTO.** Today RPO is up to 24 h. Is that acceptable for the first live week, or must 2.1 move into Phase 1?
5. **Log retention period** and whether a paid log plan is acceptable.
6. **Merchant MFA policy**: required for owners from day one, or optional first.
7. **Staging**: rehearsal 1.11 can run on a local stack or the CI ephemeral stack; a persistent staging server is a separate decision (Phase 3).

## 8. Costs

Mostly existing services. Possible new spend: Better Stack log and on-call tier, Sentry plan beyond the free tier, Cloudflare Access seats (free for small teams), extra R2 storage for backups and logs. Exact amounts depend on volume and chosen plans; the owner decides before purchase.
