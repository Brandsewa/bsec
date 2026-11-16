# Audit decisions log

- **Date:** 2026-11-16
- **Kept by:** claude, for the owner
- **What this is:** every point where the audit stopped because the answer is the owner's (product rule, spending, production access, legal, or a risk I should not take alone). Everything that could be done without a decision was done and is in `docs/audit/`. Each entry says what I recommend, and what happens if it waits.

Priority: **A** decide soon (security or money exposure), **B** decide before launch, **C** when convenient.

## A. Decide soon

| # | Decision | Why it matters | Options | Recommendation | If it waits |
|---|---|---|---|---|---|
| D1 | **Allow three read-only checks on production**: response headers and cookies on `bcom.si` and one store, whether `X-Forwarded-Host` sent by a client is passed through (A1-02), whether `platform.` and `superadmin.` sit behind Cloudflare Access, and the value of `TRUST_CLOUDFLARE` on web and platform (A2-05) | The first two cannot be settled from the repository. A client-chosen store host could serve one store's pages under another's address; a wrong `TRUST_CLOUDFLARE` makes every per-visitor rate limit either useless or a lock-out of real shoppers | Yes, read-only, by me with `curl` and the Coolify settings screen read by you | Yes | Two Unconfirmed findings stay open |
| D2 | **Content-Security-Policy and framing rules for the storefront** (A7-01) | Without it, any future injection bug is as bad as A8-01 was. The basic headers are now set; the policy is the missing half | (a) staged: report-only for two weeks, fix what it reports, then enforce; (b) skip | (a), and name who walks checkout with Stripe, Razorpay, GA4, Meta and the admin page editor open. It cannot be tuned without a browser | No second line of defence against script injection |
| D3 | **Customer-only discounts: who counts as the customer?** (A3-05) | A code limited to chosen or tagged customers works for anyone who types that customer's email or phone at checkout, and uses up that person's limit. An existing test records it as intended | (a) keep (small stores work this way); (b) require a signed-in customer for those code types only; (c) require a verified email or phone code | (b) | A merchant who issues a "VIP only" code is not protected from sharing |
| D4 | **Customer personal-data retention** (A12-01) | Erasure now clears the audit email, sign-in codes and consent IPs, but orders, carts, mail log, newsletter, form submissions, quote requests, analytics and abandoned checkouts keep personal data for periods nobody has set. Needs the GST invoice retention rule and DPDP advice | Give me a period per table (or "as long as the law requires" with a figure) and I implement purge jobs and extend erasure | Ask your accountant for the invoice period and a lawyer for the rest; I can draft the table for them | Erasure is only partial |
| D5 | **Approve a production data fix for old phone-only customers** (A2-06) | Customers created before the fix have an email at `@customer.store`, which is a real domain. Mail to such an address would leave the platform | One-off migration that rewrites those emails to `@phone.invalid`, plus a mailer guard that refuses placeholder addresses | Yes; I will write and test it, you approve running it | Small, because phone sign-in is not live yet |
| D6 | **Row-level security on the platform tables the store runtime can read** (A1-01) | `subscriptions`, `platform_invoices`, `tenant_size_tiers`, `quota_events`, `tenant_quota_overrides` and others have no policy, so only the `where tenant_id` in store code separates stores. Adding a policy makes any query run outside a tenant transaction return nothing | Approve a staged project: list each call site, move them into tenant transactions or onto the platform role, add policies one table at a time, each with the isolation suite | Yes, as its own change after launch-critical work; not a blind migration | Defence in depth is missing; no leak found |

## B. Decide before launch

| # | Decision | Why it matters | Options | Recommendation |
|---|---|---|---|---|
| D7 | **Bot protection on checkout** (A3-04) | Per-visitor and per-phone limits are in, but a script rotating addresses and phones can still place cash-on-delivery orders that hold stock | Add Cloudflare Turnstile on checkout (needs your Turnstile keys and a UI change) | Yes before ads or launch traffic |
| D8 | **Late payment on a cancelled order: refund automatically?** (A4-01) | Now the order stays cancelled, shows as paid, and the owners are alerted to refund or restore it. An automatic refund would be faster but moves money without a person | (a) manual (now); (b) auto refund through the provider after N hours | (a) until payments are live and observed |
| D9 | **Pending custom domains** (A1-03) | A store that adds a hostname it does not own blocks the real owner from adding it | Rule needed: expire an unverified domain after N days; allow another store to claim an unverified hostname; remove the provider-side hostname too | Expire after 7 days, never auto-claim a verified one |
| D10 | **Failed-job visibility and CI additions** (A9-01, A11-02) | Failed jobs sit in pg-boss with no alert; CI does not run `pnpm audit` or an image scan | Add a dead-letter queue and an alert through Better Stack; add `pnpm audit` and Trivy to CI, report-only first, then blocking on high severity | Yes, report-only first (hardening plan items 1.3 and 2.5) |
| D11 | **Platform services without an in-service role check** (A2-01) | Ten platform services (plans, quotas, tenant create and export, owner invite resend) rely on the route for the role because jobs and seeds call them without a staff id | Approve a refactor: a staff-checked public function and an internal function for each | Yes, small and mechanical, after D6 |
| D12 | **Order job inside the same transaction** (A3-06) | A crash between saving a paid order and queuing its job loses the confirmation email and the stock commit | Use pg-boss's transaction option so the job commits with the order, or an outbox table | Approve a short design; I would pick the transaction option |

## C. When convenient

| # | Decision | Notes |
|---|---|---|
| D13 | **Two unclear in-flight branches**: `feat/cashfree-gateway` (no PR, no remote branch) and `fix/admin-polish-phase-1` (no PR, no remote branch) are still listed in `progress.md` | Finish, abandon, or confirm merged under another PR; I left both lines. Also `feat/cashfree-gateway` says it was waiting for you |
| D14 | **Dismiss or remove the `deepmerge` alert** (Dependabot 31, from the earlier round) | No patched version exists; it only comes in through the `shadcn` CLI (dev dependency). Dismiss as "vulnerable code is not used", or copy the stylesheet and drop the package |
| D15 | **Enable CodeQL default setup** on the repository (free while public) | A repository setting only you can change; fills the empty code-scanning half of the Security tab |
| D16 | **Who runs the browser walkthroughs** (A14) at 375 px and desktop, and the accessibility pass | ZCode or Antigravity per the roles table, or you. I cannot drive a browser through a signed-in store here |
| D17 | **Keep storing webhooks that fail their signature?** (A4-02) | The route stores and then rejects them (three security tests assert it), and a daily job now deletes them after 24 hours. Rejecting at the route with 401 is the common practice but would rewrite those tests |
| D18 | **Remaining foreign keys without an index** (about 60 on small tables) | Only matters at scale; revisit with real data volumes |

## Already decided in this round (for the record)

- Fixes and tests go in as separate small changes; nothing was merged to `main` by this audit round without your yes.
- Nothing was run against production. Live checks wait on D1.
