# Audit A5 to A15: findings

- **Date:** 2026-11-16
- **Auditor:** claude
- **Plan:** `docs/PLATFORM-AUDIT-PLAN.md` sections A5 to A15
- **Code audited:** `main` eedc707
- **How:** code read, mechanical scans (grep, SQL catalogue queries on a migrated local test database, `pnpm audit`, GitHub API), and new tests. Nothing was run against production, and nothing was driven in a browser.
- **Decisions that need the owner** are in `docs/audit/2026-11-DECISIONS.md`.

## Result

One High, two Medium and several Low defects found and fixed, each with a test. Several areas could only be checked by reading code: they are marked "not checked" below, not passed. This is a first pass, like A1 to A4.

| ID | Severity | Title | Status |
|---|---|---|---|
| A8-01 | High | Merchant text in structured-data scripts could close the script tag (stored XSS on storefront pages) | fixed, test |
| A7-02 | Medium | Open redirect through the market selector (`next=/%09/evil.example`) | fixed, test |
| A12-01 | Medium | Customer erasure copied the email into the kept audit log and left sign-in codes and IP addresses behind | fixed, test; more remains (decision) |
| A7-01 | Medium | No security headers on the storefront, the platform API, or the two admin SPAs' HSTS and permissions policy | headers added, test; CSP is a decision |
| A10-02 | Medium | No index on `audit_logs`, `accounts.user_id`, `memberships.user_id` and four other hot lookups | fixed (migration 0114), verified |
| A5-01 | Low | Platform API accepted request bodies of any size | fixed, test |
| A6-01 | Low | Log redaction missed capitalised headers, nested error config, provider keys and codes | fixed, test |
| A8-02 | Low | A saved block link could leave the site through a tab or newline in the path | fixed, test |
| A10-01 | Low | Nothing stopped an applied migration from being edited | guard added (`checksums.json`, `docs:check`), tested |
| A11-01 | Low | GitHub Actions pinned to moving tags (`@v7`), not commits | fixed: 23 references pinned |
| A15-01 | Info | 20 "In flight" lines in `progress.md` were for merged and deleted branches | removed |
| A9-01 | Info | Queues retry 5 times with backoff but have no dead-letter queue or failed-job alert | decision |
| A11-02 | Info | No image vulnerability scan; no `pnpm audit` step in CI | decision |

## Findings

### A8-01 Structured data could break out of its script tag (High)

- **Rule:** rule 8 (no merchant-controlled code), ADR-010.
- **Where:** 14 pages and components wrote `JSON.stringify(data)` straight into `<script type="application/ld+json">`: product, category, collection, search, home, contact, policy and custom pages, the FAQ block and the marketing landing page. `JSON.stringify` does not escape `<`, and the data contains merchant text (product names, descriptions, FAQ answers).
- **Steps:** name a product `</script><img src=x onerror=alert(1)>`. The product page then ends the script element at that text and runs the rest as markup. Only `components/blog/JsonLd.tsx` and the consent config escaped `<`.
- **Impact:** a merchant, or any staff member who can edit products, can run script on their own store's pages in every shopper's browser (cookies are `HttpOnly`, but it can read the page, forms and checkout fields).
- **Fix:** all 14 sites use `JsonLd`, which escapes `<`. A test renders hostile text through it, checks the data is unchanged, and a second test fails if any file writes `JSON.stringify` into a script by hand again.
- **Checked and fine:** rich text (blog bodies, text blocks, custom fields) goes through `sanitize-html` allowlists; `ShopEvent` and the consent config escape `<`.

### A7-02 Open redirect (Medium)

- **Where:** `apps/web/src/app/api/storefront/market/select/route.ts` and `apps/web/src/lib/request-origin.ts` (`publicUrl`). The check accepted any path starting with `/` but not `//`. URL parsers delete tabs and newlines, so `/<tab>/evil.example` becomes `//evil.example`.
- **Steps:** `GET /api/storefront/market/select?handle=x&next=/%09/evil.example` answered with a redirect to `https://evil.example/`. The proven value: `new URL("/\t/evil.example", "https://shop.example").href` is `https://evil.example/`.
- **Impact:** a phishing link on the store's own domain that sends shoppers to another site.
- **Fix:** `publicUrl` now never returns a URL outside the shopper-facing origin (anything else becomes `/`), and the route also refuses control characters. Test fails without the fix.

### A12-01 Customer erasure leaves personal data behind (Medium)

- **Where:** `deleteAdminCustomer` (`packages/domain/src/admin/customers.ts`), the DPDP erasure path.
- **Found:** both paths wrote the customer's **email into the audit log diff**, which is kept indefinitely. Sign-in codes (`customer_otps`, keyed by phone) and the raw IP addresses on `customer_consent_events` outlived the customer.
- **Fixed:** the audit row no longer carries the email; the phone's sign-in codes are deleted; the raw IP on the consent history is cleared (the history itself is kept as proof of consent).
- **Still holds personal data after erasure (not changed, decision):** `orders` (email, phone, addresses, kept for accounts and tax), `carts`, `email_log.to_email` (pruned after 180 days), `newsletter_subscribers`, `form_submissions`, `quote_requests`, `order_tracking` and earlier audit rows that may mention the person. Whether and how long to keep each is a retention decision.

### A7-01 Security headers (Medium)

- **Found:** the storefront (Next) sent none of `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`; the platform API sent none; the two admin nginx configs had the first three but no HSTS or permissions policy.
- **Fixed:** `next.config.ts` `headers()` (nosniff, strict-origin-when-cross-origin, a Permissions-Policy denying camera, microphone, geolocation, USB, HSTS one year without includeSubDomains), Hono `secureHeaders` on the platform API, HSTS and Permissions-Policy on both nginx configs. Platform test added.
- **Not done (decision):** a `Content-Security-Policy` and `frame-ancestors` on the storefront. The admin page editor frames the storefront, and checkout loads Stripe, Razorpay, GA4, Meta and Turnstile, so a policy needs a staged report-only rollout checked in a browser.

### A10-02 Missing indexes (Medium)

- **How:** a catalogue query on the migrated database lists foreign keys with no leading index (about 70 of 274), and the real indexes of the busiest tables were read.
- **Fixed (migration 0114, indexes only):** `audit_logs (tenant_id, created_at desc)` (the table only grows and is read per store), `accounts (user_id)`, `memberships (user_id)`, `customer_sessions (tenant_id, user_id)`, `domains (tenant_id)`, `order_items (tenant_id, variant_id)`, `discount_redemptions (tenant_id, customer_id)`. Also declared in the Drizzle schema. All seven exist after migration.
- **Left:** about 60 other foreign keys on small or rarely-read tables (media references, `updated_by` columns). They matter only when a parent row is deleted at scale; worth a second look with real data volumes.

### A5-01 Request size (Low), A6-01 Log redaction (Low), A8-02 Link characters (Low), A10-01 Migration lock (Low), A11-01 Action pinning (Low)

- **A5-01:** the platform API read bodies without a cap (the upload route only looked at `Content-Length`, which a chunked request omits). Now 6 MB for JSON, 11 MB for the media upload route, enforced while streaming; 413 test.
- **A6-01:** `pino` paths are case-sensitive; HTTP clients write `Authorization`. The redaction list now covers both spellings, nested `err.config.headers`, support and signature headers, provider keys, tokens and codes. Test found the capitalised-header gap before the fix.
- **A8-02:** `isSafeHref` (block and menu links) allowed `/<tab>/evil.example`. Control characters and backslashes are now refused.
- **A10-01:** `packages/db/migrations/checksums.json` holds a SHA-256 of each of the 109 migrations; `pnpm docs:check` (CI and pre-push) fails if a recorded file changes or disappears. New files are allowed and recorded with `node scripts/check-migrations-immutable.mjs --write`. Eight existing migrations show more than one commit, all within days of creation; whether any was edited after reaching production cannot be told from the repository.
- **A11-01:** all 23 `uses:` lines in `.github` now name a full commit with the tag in a comment; Dependabot's `github-actions` ecosystem keeps them current.

## Checks that passed

| Check | How | Result |
|---|---|---|
| Server-side fetches | read all `fetch(` calls | every call goes to a fixed provider host (Cloudflare, Razorpay, Google, Turnstile); no merchant or shopper supplied URL is fetched |
| Raw SQL | grep `sql.raw` | 6 uses; the interpolated one (`reports.ts`) takes a validated enum |
| Rich HTML | read `sanitize.ts`, `markdown.ts`, blog sanitiser | `sanitize-html` with tag, attribute and scheme allowlists |
| Public environment variables | grep `VITE_` and `NEXT_PUBLIC_` | only API and site URLs and the Sentry DSN |
| Live keys in the repository | `git grep` (earlier, A4) | none |
| Dependencies | `pnpm audit --prod` | no known vulnerabilities |
| CI permissions | read `ci.yml` | top-level `permissions:` set; secrets used only for the registry, Coolify and the Sentry DSN; no `pull_request_target` |
| Containers | read the six Dockerfiles | node images run as `USER node`; the SPAs use `nginx-unprivileged`; health checks present |
| Queue retries | read `queues.ts` | every queue retries 5 times with backoff |
| Admin UI standards (static) | grep native `<select>`, `confirm`, `alert` in the SPAs | none |

## Not checked

- **A5:** tenant lifecycle transitions through the API, theme template publishing, marketing CMS validation, Cloudflare Access in front of `platform.` and `superadmin.` (a live check).
- **A6:** a full-history secret scan (Gitleaks runs in CI, not installed here), a grep of the built client bundles, the environment validation at boot.
- **A7:** upload content sniffing and SVG handling, CSV import formula injection and size limits, per-route rate limits beyond those named in A2 and A3.
- **A8:** embeds and video widget host allowlists, menu link validation outside `isSafeHref`.
- **A9:** idempotency of every consumer, schedule overlap, notification isolation between stores.
- **A10:** grants per role beyond A1, long transactions, retention rules for analytics, audit and notification tables.
- **A12:** the consent banner against the network (nothing may fire before consent), tenant deletion, privacy request export.
- **A13:** N+1 queries on list pages, image and bundle budgets beyond the existing tests, a load test.
- **A14:** every screen walked at 375 px and desktop, accessibility checks. Needs a browser; not possible in this session.
- **A15:** the e2e selectors, a second read of the architecture sections 7 to 14.
