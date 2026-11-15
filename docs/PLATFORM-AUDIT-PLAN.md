# Platform audit plan

- **Date:** 2026-11-15
- **Author:** claude
- **Status:** plan only, nothing audited yet. Awaiting the owner's go-ahead and choice of order.
- **Change record:** `docs/changes/2026-11-15-claude-security-alerts-and-audit-plan.md`

## 1. Goal and scope

Check every essential section of bsec against its own rules (`AGENTS.md` section 2, the ADRs) and against common failure modes for a multi-tenant commerce SaaS, and produce a ranked list of defects with evidence. The audit finds and reports; fixes follow as separate, small change sets.

In scope: all five apps, all packages, the database, CI/CD, the deploy configuration files in the repo, and the docs.

Out of scope:
- Shiprocket and any shipping integration (rule 14).
- Live payment credentials and anything that needs live provider keys (rule 14). Payments are audited in test or sandbox mode only.
- Driving the production store or production database. A live check needs the owner's explicit yes each time and is listed separately in section 7.
- Recovery, monitoring and alerting work items. Those belong to the go-live hardening plan (`docs/GO-LIVE-HARDENING-PLAN.md`, drafted 2026-11-03, parked, not merged yet). This audit only checks whether what that plan lists as "done" really is, and feeds new gaps into it.

## 2. Method

Each section in section 4 is audited the same way:

1. **Read**: the ADR, the architecture section, then the code paths named in the table.
2. **Automated checks**: the gate (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`), the existing test suites for the area, plus the tools in section 3.
3. **Probe**: write a failing real-database test (`*.int.test.ts`, `startTestDb`) for every suspected security or money defect. A suspicion without a reproducing test or exact steps is recorded as "unconfirmed", never as a finding.
4. **Run it locally**: for UI and flow checks, the local stack (`.env.dev`, seeded logins), 375 px and desktop.
5. **Record**: one findings file per section in `docs/audit/2026-11-<section>.md`, and one change record per audit round (Type: test).

### Finding format

| Field | Content |
|---|---|
| ID | `<section>-<nn>`, for example `A1-03` |
| Severity | Critical, High, Medium, Low, Info (scale below) |
| Rule or ADR broken | for example rule 4, ADR-002 |
| Where | `path:line` |
| Steps | exact steps or the test name that reproduces it |
| Expected / actual | one line each |
| Evidence | test output, request and response, screenshot |
| Suggested fix | one or two lines, with a size (S, M, L) |
| Status | open, fixed in `<PR>`, accepted by owner, not a defect |

### Severity scale

| Level | Meaning | Action |
|---|---|---|
| Critical | One store can read or change another store's data; payment or order money can be forged; secrets exposed; remote code run | Stop the audit, tell the owner at once, fix before anything else |
| High | Permission bypass inside a store, missing audit log on a money or access change, stored XSS, unauthenticated abuse that costs money | Fix in the next change set |
| Medium | Missing rate limit, weak validation, wrong totals in an edge case, unbounded query, missing index that hurts at scale | Schedule |
| Low | Hardening, defence in depth, doc and code disagree | Batch |
| Info | Observation, no action needed | Record only |

## 3. Tools

Already in the repo: ESLint with the `bs/*` rules, the isolation suite (`packages/domain/test/isolation.int.test.ts`), the audit coverage suite (`apps/platform/test/audit-coverage.int.test.ts`), Gitleaks in CI, Dependabot, Playwright e2e, k6 scripts in `infra/loadtest/`, the page JS budget check.

Proposed additions, each an owner decision (section 7):

| Tool | Why | Cost |
|---|---|---|
| GitHub CodeQL (default setup, JavaScript/TypeScript) | The "Security and quality" tab has no code scanning today (`code-scanning/alerts` returns "no analysis found"); only Dependabot runs. Free while the repo is public | A repository setting, no workflow file needed |
| `pnpm audit --prod` as a non-blocking CI report | Catches advisories between weekly Dependabot runs | One CI step |
| Container image scan (Trivy) on the built images | Base image and OS package CVEs are not covered by Dependabot's npm scan | One CI job; already item 2.5 of the hardening plan |
| OWASP ZAP baseline scan against the **local** stack | Headers, cookies, obvious injection points | Run by hand, local only |

## 4. Sections to audit

Order is by risk. Sections A1 to A6 are the security core and should run first, in order. The rest can run in any order.

### A1. Tenant isolation and row-level security (rules 1, 2, 9; ADR-002)

| Check | How |
|---|---|
| Every tenant table is built with `tenantTable()` and has `forceRlsSql` in its migration | Script: list tables from `packages/db/src` and from the migrations, diff against `pg_class.relforcerowsecurity` on a fresh migrated test database |
| References between tenant tables use `tenantForeignKey` | Grep `references(` in tenant tables; each hit justified or reported |
| Every `admin.*` and storefront procedure is mapped in the isolation suite | Diff the contract router keys against the suite's map |
| `app_platform` (BYPASSRLS) queries always filter by `tenantId` | Read every query in `packages/domain/src/platform` and `saas`; real-database test with two tenants for each list or mutate path |
| `app_saas` grants are no wider than the self-service paths need | Read the grant migrations; compare with the call sites |
| Tenant context cannot be chosen by the client | Trace how `ctx.tenantId` is set in `apps/web/src/server` and `host-resolver.ts`; test with a forged host header, a foreign id in the body, and a session from another store |
| Cache keys and tags carry the tenant | `bs/tenant-cache-tag` lint is clean; grep for `"use cache"`, `unstable_cache`, any `Map` used as a cache |
| Background jobs set the tenant before any query | Read each consumer in `apps/worker` |
| Media and file paths are tenant-scoped | R2 keys, signed URLs, import and export files |

### A2. Authentication, sessions and permissions (rule 4; ADR-014, `docs/AUTH-OVERHAUL-PLAN.md`)

| Check | How |
|---|---|
| Every mutating domain service calls `assertPermission` (store) or `assertRoleAtLeast` (platform) | Script: list exported service functions, flag those without an assert; read each flagged one |
| Permission checks are in the domain service, not only the route | Same list, compare with handlers |
| Role and permission changes cannot be self-granted; an owner cannot be removed by staff | Real-database tests |
| Session cookies: `HttpOnly`, `Secure`, `SameSite`, domain scope across `.bcom.si`, lifetime, rotation on sign-in, revoke on password change | Read `packages/auth`; inspect cookies on the local stack |
| Customer sign-in codes, password reset, invite accept: single use, expiry, rate limit, no user enumeration | Read and test |
| Google sign-in: state and nonce checked, redirect allowlist, account linking cannot take over an existing account | Read `packages/auth`, `docs/GOOGLE-SIGNIN-PLAN.md` |
| Platform staff MFA cannot be skipped; backup codes single use | Test |
| Impersonation or "open store as staff" paths are logged and time-limited | Read, test |
| CSRF: cookie-authenticated mutations check origin; CORS allowlist is exact | Read middleware in `apps/web` and `apps/platform`; test with a foreign `Origin` |

### A3. Checkout, orders and money (rules 12, 13; `orders/checkout.ts`, ADR-045)

| Check | How |
|---|---|
| Prices, discounts, shipping, tax and totals are recomputed on the server; nothing from the client is trusted | Read `packages/domain/src/orders`; tests that send altered prices, quantities, negative and huge values, a discount for another store |
| Rounding and currency: integer minor units everywhere, one rounding rule, multi-market conversion (ADR-040) | Read; property-style tests on totals |
| Discounts: stacking rules, usage limits under concurrency, auto-add, expiry, per-customer limits | Real-database tests with parallel checkouts |
| Stock: no oversell under concurrency; reservation and release on failure or abandon | Parallel real-database test |
| Order state machine: no illegal transition (paid twice, refund above paid, ship a cancelled order, partial shipments) | Read; table-driven test |
| Idempotency of place-order and pay | Replay the same request |
| State pricing, pre-orders, quotes, returns | Each plan's acceptance criteria re-checked against code |
| Money mutations write `audit_logs` | Compare the mutation list with audit writes |

### A4. Payments and webhooks, test mode only (rule 14; ADR-040, ADR-046, ADR-048)

| Check | How |
|---|---|
| Signature verified for every provider before any state change; raw body used; per-store secret | Read `apps/web/src/app/api/webhooks/[provider]/route.ts` and `packages/payments` |
| Replay, duplicate and out-of-order events cannot double-mark an order | Real-database test (also hardening item 1.8) |
| Amount and currency from the provider are compared with the order | Read, test with a mismatched amount |
| A webhook for store A cannot touch store B's order | Test |
| Tenant credentials: encrypted at rest, never returned, shown as set or not set, never logged | Read `packages/payments/src/crypto.ts`; grep logs and API output types |
| Stripe Payment Element: publishable key only in the browser, intent created server-side with the server total | Read |
| Platform billing (invoices, currency, GST) totals and access | Read `packages/domain/src/saas`, `finance` |
| No live keys anywhere | Gitleaks plus grep for key prefixes |

### A5. Platform API and Super Admin (rules 6, 9)

| Check | How |
|---|---|
| Every platform mutation writes `platform_audit_logs` | `audit-coverage.int.test.ts` covers every procedure; diff against the contract |
| Role ladder enforced on every procedure | Script as in A2 |
| Hono app: middleware order, auth before routes, error handler leaks nothing, body size limits | Read `apps/platform/src/app.ts` |
| Tenant lifecycle: suspend, delete, tier change, domain attach cannot be triggered across tenants or by a merchant | Tests |
| Custom domains: ownership proven before routing; no takeover of another store's host | Read `packages/domain/src/domains`; test |
| Marketing site CMS and website builder content is validated the same way as store blocks | Read |
| Exposure of `platform.` and `superadmin.` | Docs disagree (hardening item 1.10); owner confirms the live state |

### A6. Secrets and configuration (rule 7)

| Check | How |
|---|---|
| No secret in code, history, logs, snapshots, client bundles | Gitleaks full-history run; grep built SPA and `.next` output for key patterns and server-only env names |
| Only `NEXT_PUBLIC_*` and `VITE_*` values reach the browser, and none of them is sensitive | List them, review each |
| Env validation at boot; app refuses to start with missing or weak secrets | Read the env schema in `packages/config` |
| Logger redaction covers tokens, cookies, `Authorization`, card-like fields | Read `logger.ts`; test |
| Error responses carry no stack, SQL or internal ids | Force errors on the local stack |
| `TENANT_SECRETS_KEY` rotation path exists | Read; feeds hardening item 2.4 |

### A7. Web and API attack surface

| Check | How |
|---|---|
| Every route parses input with its Zod contract; no handler reads raw body fields | Script over `apps/web/src/server/api.ts`, REST routes under `/api`, `apps/platform/src/app.ts` |
| SQL: no string-built queries; every `sql` template with interpolation reviewed | Grep `sql\`` and `sql.raw` |
| SSRF: any server-side fetch of a merchant or shopper supplied URL (image import, bulk import, IndexNow, webhooks, oEmbed, domain checks) | Grep `fetch(`; each needs an allowlist or a private-address block |
| Uploads and media: type and size checks, content sniffing, SVG handling, image processing limits | Read `packages/domain/src/media`, upload routes |
| Bulk import and export: CSV formula injection, file size, row limits, tenant scoping of the stored file | Read, test |
| Open redirects in sign-in, checkout return and tracking links | Grep `redirect(`, `returnTo`, `next=` |
| Security headers and CSP on web and both SPAs | Inspect local responses and the nginx configs in `infra/docker` (also hardening item 1.9) |
| Rate limits on sign-in, codes, reset, signup, place-order, pay, coupon and gift-card lookups, search, lead capture | Read `system/rate-limit.ts` and call sites (also hardening item 1.7) |
| Pagination and list endpoints are bounded | Grep list services for a max limit |

### A8. Blocks, themes and merchant content (rule 8; ADR-009, ADR-010)

| Check | How |
|---|---|
| Every block prop is enumerated and validated; no raw HTML, CSS, JS or template path | Read `packages/blocks` schemas; grep `dangerouslySetInnerHTML`, `style=` built from props, `<script` |
| Rich text and product descriptions are sanitised on write and on render | Read `rich-description.ts`; XSS payload tests |
| URLs in blocks, menus and links: scheme allowlist (`javascript:` blocked) | Test |
| Embeds, video and map widgets: host allowlist | Read |
| JSON-LD and meta tags escape merchant text | Read the SEO helpers; test with `</script>` in a product name |
| Customer supplied content shown in admin (reviews, names, notes, addresses) is escaped | Local run with payloads |
| Block version bumps exist for every schema shape change | Compare schema history |

### A9. Jobs, queues and side effects (rule 13; ADR-006)

| Check | How |
|---|---|
| No email or provider call inline in a request | Grep senders and provider clients outside `apps/worker` |
| Jobs are enqueued inside the business transaction | Read enqueue call sites |
| Consumers are idempotent and safe to retry; poison jobs go to a dead-letter path | Read each consumer |
| Schedules: no overlap, bounded batch size, tenant by tenant | Read |
| Notification dispatcher respects store settings and does not leak one store's events to another | Test |

### A10. Database and migrations (rule 10; `docs/migrations.md`)

| Check | How |
|---|---|
| Migrations are append-only; none edited after being applied | `git log` on the migrations folder |
| Expand, migrate, contract respected; no drop or rename in the release that stops using a column | Read recent migrations |
| Indexes for every hot query (lists by tenant and date, lookups by slug, order and customer search) | `EXPLAIN` on a seeded production-size dataset, local |
| Missing foreign-key indexes, unbounded `jsonb` growth, tables without a retention rule (analytics events, audit logs, notifications, abandoned checkouts) | Catalogue query |
| Long transactions and missing timeouts | Read; already hardening item 1.6 |
| Grants per role match ADR-002 | Query `information_schema` on a fresh database |

### A11. Dependencies, CI/CD and supply chain

| Check | How |
|---|---|
| Open Dependabot alerts: zero, or each one accepted in writing | GitHub API |
| `pnpm-workspace.yaml` overrides still needed; remove those the parents have fixed | `pnpm why` for each |
| Exact pins everywhere; lockfile in sync | Script |
| GitHub Actions pinned to a commit, least `permissions:` per job, no secret reachable from a fork PR | Read `.github/workflows/ci.yml` |
| `:main` image tag set only by `promote-images` | Read |
| Dockerfiles: non-root user, minimal base, no secrets in layers, no dev dependencies in runtime images | Read `infra/docker`; image scan |
| Branch protection, secret scanning, push protection settings | Owner confirms in GitHub settings |
| Ignored install scripts (`cpu-features`, `protobufjs`, `ssh2`) stay ignored | `pnpm install` output |

### A12. Privacy and data handling

| Check | How |
|---|---|
| Personal data inventory: which tables hold shopper and merchant personal data | From the schema |
| Customer export and delete paths work and cover every table | Read `packages/domain/src/privacy`; real-database test |
| Analytics and cookie banner: nothing fires before consent where consent is required; first-party events hold no raw personal data | Read ADR-047 code; inspect network on the local stack |
| Logs and error reports hold no personal data beyond ids | Read |
| Tenant deletion removes or anonymises data, media and backups policy stated | Read; owner decision on retention |
| Legal pages and policy defaults per store | Read `policies` |

Legal conclusions (DPDP Act, GST invoicing rules) are the owner's and a lawyer's; the audit only lists facts.

### A13. Performance and caching (ADR-004)

| Check | How |
|---|---|
| Storefront pages: cache components used correctly, no per-request data in a shared cache entry, invalidation through `cache-invalidation.ts` only | Read; test a change in store A does not invalidate or appear in store B |
| Product page JS budget (50 KB gzip, almost no headroom) and other route budgets | Existing budget test; build output |
| N+1 queries on list pages (admin orders, products, customers; storefront collection) | Query log on the local stack |
| Images: sizes, formats, lazy loading; background video | Lighthouse mobile, local |
| Admin SPA bundle size and route splitting | Build report |
| Load test at launch scale | k6, local or staging only (hardening item 2.8) |

### A14. Admin, Super Admin and storefront quality

| Check | How |
|---|---|
| Rule 11: every admin route has `pendingComponent`, every storefront `page.tsx` has `loading.tsx` | `bs/route-pending` lint |
| `docs/admin-ui-standards.md`: no native `<select>`, no `window.confirm`, no hand-rolled tables, border tokens | Grep |
| Every screen walked at 375 px and desktop: empty, loading, error and permission-denied states | Local walkthrough, checklist per sidebar item |
| Accessibility basics: labels, focus order, keyboard use of dialogs and drawers, contrast | axe on each route, local |
| Shopper journey end to end: browse, cart, COD checkout, account, tracking, returns | Local walkthrough |
| Merchant journey end to end | `docs/MERCHANT-JOURNEY-CHECKLIST.md` re-run |
| Admin screens merged without a browser check (for example the discounts admin UI) | Listed from change records, walked first |

### A15. Tests and docs

| Check | How |
|---|---|
| Security and money behaviour has a real-database test, not a mock | Map A1 to A5 checks to test files; list gaps |
| Tests do not depend on file order or shared rows | Run shards in a different order |
| e2e selectors match current labels | Run `e2e/` locally |
| `docs/ARCHITECTURE.md` matches the code (routes, tables, jobs, env vars) | `pnpm docs:check` plus a read of sections 7 to 14 |
| `progress.md` "In flight" has stale lines (merged branches still listed) | Compare with `gh pr list --state merged` |
| RUNBOOK, INCIDENT and DEPLOYMENT agree with each other | Read |

## 5. Phases and assignment

| Phase | Sections | Builder | Size |
|---|---|---|---|
| 0 | Tooling: owner decisions in section 7, scripts for the mechanical checks (RLS diff, permission-assert list, contract and isolation map diff) | Claude | S |
| 1 | A1, A2 | Claude | L |
| 2 | A3, A4 | Claude | L |
| 3 | A5, A6, A7 | Claude | L |
| 4 | A8, A9, A10 | Claude | M |
| 5 | A11, A12, A13 | Claude | M |
| 6 | A14 walkthroughs | ZCode or Antigravity (test round), Claude verifies | M |
| 7 | A15, final report, fix backlog ranked | Claude | S |

One PR per phase holding only the findings files, the new probe tests (marked as expected failures where a defect is open) and the change record. Fixes go in their own PRs, Critical and High first.

## 6. Acceptance criteria

The audit is done when:

- [ ] Every check in section 4 has a recorded result: pass, finding (with ID), or "not checked" with the reason.
- [ ] Every Critical and High finding has a reproducing real-database test or exact steps with evidence.
- [ ] The mechanical scripts from phase 0 are committed and can be re-run (`scripts/audit-*.mjs`).
- [ ] `docs/audit/2026-11-SUMMARY.md` lists all findings by severity with status, and the counts per section.
- [ ] New gaps that belong to recovery or monitoring are added to the hardening plan's pending list, not duplicated here.
- [ ] The owner has seen the summary and marked each Critical and High as "fix" or "accepted".
- [ ] Nothing in production was touched without a recorded yes.

## 7. Owner decisions needed

1. **Go-ahead and order.** Start with phases 1 and 2 (isolation, auth, money), or a different order?
2. **Enable CodeQL default setup** on the repository (Settings, Code security). This is the missing half of the "Security and quality" tab.
3. **deepmerge alert #31.** No patched release exists. It reaches the repo only through the `shadcn` CLI in `apps/admin`, now a dev dependency, never in a server or in the browser bundle. Options: dismiss the alert as "vulnerable code is not used", or copy the 16 KB `shadcn/tailwind.css` into the repo and drop the package.
4. **Live checks.** Which of these may be run against production, read-only: response headers and cookies on `bcom.si`, whether `platform.` and `superadmin.` are behind Cloudflare Access, GitHub branch protection settings.
5. **Who runs the A14 walkthroughs** (ZCode or Antigravity).
6. **Retention periods** for analytics events, audit logs, abandoned checkouts and deleted tenants (needed to judge A10 and A12).
7. **Extra CI steps** from section 3 (`pnpm audit` report, image scan).

## 8. Risks

| Risk | Mitigation |
|---|---|
| The audit turns into a rewrite | Findings only; fixes are separate PRs sized S or M |
| Probe tests slow the heavy shards past 4 minutes | Put them in existing shards, measure, split only if needed |
| False confidence from reading code | A check counts as "pass" only with a test or a local run named next to it |
| Overlap with agents working in flight | Claim each phase in `progress.md`; audit PRs touch only `docs/audit`, `scripts/audit-*` and test files |
