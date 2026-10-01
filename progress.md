# Progress

Source of truth: `docs/PLAN.html` v2.0 (build order in `docs/BUILD-PLAN-M2-M9.md`). Items are ticked only after verification; the evidence is noted next to each. "From code" means it was read in the repo but not exercised live.

## Status at 2026-10-01

Live at **gobs.cloud** (web), **admin.gobs.cloud**, **platform.gobs.cloud**, **superadmin.gobs.cloud**, **media.gobs.cloud** (R2 images). Production runs `main`; every push passes CI (typecheck, lint, build, unit, heavy integration on real Postgres 18, ephemeral staging smoke test incl. admin + Super Admin Playwright e2e) before the Coolify deploy. First real store: **Taste of Hills** (`tasteofhills.gobs.cloud`), created through Super Admin.

Test counts at this date: domain 930, db 41, platform 63, web 121, admin 23 (isolation suite 525 of the domain total).

| Milestone | State | Notes |
|---|---|---|
| M0 Platform boots | Done, with open infra items | see "Open infra items" |
| M1 Tenant isolation | Done | isolation suite green; customer sessions (ADR-012) not implemented |
| M2 Catalog | Done, gaps | CSV import/export UI disabled; no Cloudflare Images re-encode; no stock field on product create |
| M3 Storefront | Done, gaps | no SEO settings page, no CSP header, missing pages return 200 not 404 |
| M4 Payments | **COD done, online payment not built** | real Razorpay order creation missing (online option hidden); no customer `/account` area; customer OTP cannot work in production (no SMS provider) |
| M5 Fulfillment | **Mostly not built end to end** | Shiprocket never called; no way to create a return; emails are placeholder text; invoices have no PDF |
| M6 Store #1 live | Partly | a real store exists; no real order history or 2-week run; restore drill at real volume not done |
| M7 Hardening | Docs only | load / noisy-neighbour / capacity numbers deferred until after M9 (decision 2026-09-29) |
| M8 Self-service SaaS | Built, **signup unreachable until the marketing-page fix deploys** | custom domains and merchant billing coded but never run live |
| M9 SaaS launch | Done and verified live | ADR for M9 decisions still to write; GST doc pending chartered-accountant review |
| M10 Theme editor (Puck) | Merged by a separate session | see ADR-018 for its known gaps |

### Verified live, this week
- **Super Admin** (2026-09-30): sign-in with password + authenticator, store creation, support session start, suspend/restore, audit log; Playwright superadmin spec 5/5 in CI.
- **Store provisioning** through Super Admin: Taste of Hills created; owner invite link works.
- **Wildcard store routing** (`*.gobs.cloud` → bsec-web) via manual Traefik labels; see DEPLOYMENT.md "Wildcard store routing".
- **Storefront modes**: new stores start `coming_soon`; Settings → Storefront switches to live (tests + live).
- **Catalog to order, COD**: product page, add to cart, cart, checkout with the store's own shipping rates, COD order placed, thank-you page with the real order number, order visible in admin, stock reserved, cancel releases stock and voids the payment. Placed and cancelled two test orders (ORD-00001/2) on the live store.
- **Inventory**: variants that never had stock are listed so first stock can be added; product page shows stock.
- **Product images**: upload from the product page to R2 (`bsec-media`), served from `media.gobs.cloud`, shown in admin, home grid, product page, cart and checkout. Tested with a real upload.

### Bugs found by driving the app and fixed this week
Cached "not found" never cleared after a draft product was published; Add to Cart sent an invented cart token (every add failed); checkout showed hardcoded shipping so the page said ₹150 and the order was ₹199; a "free above ₹999" rate looked free for every cart and the flat rate always won; cancelling an order left stock reserved and COD payment "pending"; inventory page hid never-stocked variants; demo blog articles and keyboard-store copy shown on every store; online payment option created a fake Razorpay order.

### Known gaps, by area (nothing below is built unless stated)
- **Payments / shipping (deferred by decision, needs provider keys):** real Razorpay checkout and webhooks end to end; Shiprocket labels, AWB, tracking, RTO; merchant billing via Razorpay Subscriptions.
- **Customer side:** `/account/*` (login, orders, returns, addresses, wishlist, profile, privacy/data export); `/pay/{token}`, `/address/{token}`, `/unsubscribe/{token}`; discount code entry at cart/checkout (the discount engine and admin exist); reviews.
- **Messaging:** transactional emails send only placeholder text (`Template: X. Subject: Y`); no HTML templates; Resend key not configured.
- **Returns and invoices:** no return request flow or admin Returns screen; GST invoice has no PDF; GST scope awaits CA review.
- **Store admin screens missing:** Abandoned checkouts, Shipments, Returns, Reviews, Analytics, merchant Features, Domains, SEO, Checkout, Notifications, Policies, Plan and billing, Activity log, Data export, Danger zone, Blog, Announcement bar, Redirects, Files. Fake or disabled controls: Customers/Orders "Export", Products Import/Export.
- **Custom domains:** backend and Cloudflare for SaaS provider coded (needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, the `stores.gobs.cloud` CNAME target); no admin Domains page; never run live.
- **Security checklist items not verified:** Content-Security-Policy on the storefront; CSRF on mutations; rate limiting at Cloudflare.
- **Platform:** invite links for owners/staff are shown once, not emailed; host-to-store cache means a suspend can take up to 60 s to reach the public storefront; media deletion from R2 on store deletion needs the `R2_*` keys on bsec-platform.

### Open infra items
- Sentry projects and DSNs, uptime monitors (deferred to the end, with provider keys).
- Point-in-time recovery (pgBackRest/WAL): current RPO is 24 h (daily `pg_dump`), plan target is 15 min.
- GitHub `production` environment has no required-reviewer gate (needs a paid plan).
- Coolify's own healthcheck fails on this host; apps are verified through their `/health` endpoints instead.
- `bsec-superadmin` GHCR package is private (Coolify uses a server-side `docker login`); other packages are public.
- bsec-web uses manually managed Traefik labels for the wildcard route: editing its domains in Coolify does not regenerate them.
- Load, noisy-neighbour and capacity tests, second restore drill, security penetration test: deferred.

### Decisions on record
- Razorpay, Shiprocket and Resend keys, Sentry and uptime accounts: set up at the very end (2026-09-29).
- Hardening and load testing: after all phases are built (2026-09-29).
- Shipping rates are per store, never hardcoded.
- No legacy dataset to migrate: store #1 is the platform's own first tenant (PLAN §16 does not apply).

---

# History: M0 · Platform boots (detail)

## M0 · Platform boots

**Plan exit criterion:** push to main deploys web, platform, admin and worker to staging then production; a migration runs; a backup is restored into a scratch database.
**Status:** code-side scaffold done and verified locally (2026-09-28). **M0 is not done yet**: the infra items below need the VPSs, the GitHub repo push, and accounts.

### Repo and tooling
- [x] Turborepo + pnpm workspace, Node 24.15, TypeScript 6.0.3 strict, exact version pins. `pnpm install` is clean.
- [x] apps: `web`, `platform`, `admin`, `worker`. packages: `db`, `contracts`, `domain`, `auth`, `ui`, `config`.
- [x] `pnpm typecheck` passes for all 10 packages.
- [x] `pnpm lint` passes for all 10 packages.
- [x] `pnpm test` passes: 36 tests, including the PG 18 integration suite via Testcontainers.
- [x] `pnpm build` passes (web, admin, platform, worker, db bundles).
- [x] Lint rule: `@bs/db` and DB drivers banned outside db/domain. Probe file in apps/web fails with `no-restricted-imports`.
- [x] Lint rule: tenant-prefixed cache tags (`bs/tenant-cache-tag`). RuleTester suite passes, and the probe `cacheTag("products")` fails.
- [x] Lint rule: skeleton on every route (`bs/route-pending`: `pendingComponent` for admin, `loading.tsx` for web). RuleTester suite passes, and the current routes pass it.
- [x] ADR-001 … ADR-010 written (`docs/adr/`).

### Database
- [x] Roles `app_owner` / `app_rw` (NOBYPASSRLS) / `app_platform` (BYPASSRLS), idempotent bootstrap. Verified by roles.int.test and by the compose `migrate` log `roles ok`.
- [x] Drizzle migrations run only as `app_owner` (the script refuses other roles). Tables are owned by app_owner, and app_rw can do DML but no DDL. Verified by integration test.
- [x] Extensions `citext` and `pg_trgm` installed by migration as app_owner (no superuser needed).
- [x] pg-boss schema and queues created at migrate time. Worker runs `migrate:false` as app_rw. Compose log shows the `system.ping` round trip.
- [x] `tenantTable()` stub: `tenant_id`, ENABLE RLS, nullif policy on USING and WITH CHECK, plus `forceRlsSql()`. Unit-tested.
- [x] FORCE RLS + nullif proven on PG 18:
  - the owner sees 0 rows;
  - a pooled connection after SET LOCAL returns 0 rows, not an error;
  - a cross-tenant insert is rejected;
  - BYPASSRLS reads everything.

  Verified by roles.int.test.
- [x] Expand/contract rule documented (`docs/migrations.md`).

### Design system (packages/ui, M0 scope)
- [x] Tokens with Supabase-pattern names and our emerald hue; light default plus dark; Tailwind 4 `@theme` mapping. Apache-2.0 NOTICE included.
- [x] PageContainer, PageBreadcrumbs, PageHeader, PageSection (per-section Suspense), and the Sidebar/AppShell with a mobile drawer.
- [x] Button (loading state), Input, Select, Dialog, Sheet, Table, Form (RHF + FormItemLayout), EmptyState, Toast (Sonner).
- [x] Skeleton, TableSkeleton, FormSkeleton, MetricCardSkeleton, DetailSkeleton; reduced-motion safe; aria-hidden.
- [x] Route template: router defaults `pendingMs 150` / `pendingMinMs 300` and preload on intent, `pendingComponent` on every route, and a static skeleton in `index.html`.
  - Browser: the TableSkeleton rendered during navigation to /orders.
- [x] Mobile: 40 px touch targets, drawer nav, no horizontal overflow at 375 px. Checked in the browser.
- [ ] Storefront `loading.tsx` present on `/`; the per-store theme tokens come in M2/M3. Needs a Playwright throttled-network screenshot check (plan §12 enforcement), which isn't set up yet.

### Containers and local stack
- [x] Dockerfiles: web (Next standalone), platform + worker (single-file esbuild bundles), admin (nginx-unprivileged), migrate (one-shot). All non-root with HEALTHCHECK.
- [x] `docker compose up --build`: postgres 18 → migrate (exit 0) → web, platform, worker, admin all **healthy**.
  - Checked `/api/health`, `/api/system/health` (OpenAPI), `/api/rpc/system/health`, platform `/health` + `/system/health`, worker `/health`, admin `/health` + SPA deep link.
  - `pg_stat_activity` shows web/worker as `app_rw` and platform as `app_platform`.
- [x] `x-request-id` on every API response. pino JSON logs carry `request_id` (`tenant_id` field present, null until M1).
- [x] APP_VERSION build arg flows into `/health`.

### CI/CD and infra
- [x] GitHub Actions `ci.yml` runs green on `github.com/Brandsewa/bsec` (main).
- [x] Images pushed to GHCR: `ghcr.io/brandsewa/bsec-{web,platform,worker,admin,migrate}`, all set **public** (anonymous `docker pull` verified) so Coolify needs no registry credentials.
- [x] Coolify project **Bs Commerce Platform** created on the existing Brand Sewa VPS (shared with the other 4 projects for now), with a `production` environment.
- [x] `bsec-postgres` (Postgres 18) resource running, internal-only (no public port), database `bsec`.
- [x] Roles bootstrapped for real: `app_owner` / `app_rw` / `app_platform` created via the `bsec-migrate` Docker Image resource's one-shot `deploy.js` entrypoint (bootstrap + migrate in one image, driven entirely through Coolify's UI — no shell/terminal access used for secrets). Verified via container logs (`roles ok` / `migrations ok`) and confirmed live through every app's `/health`.
- [x] Four long-running resources created and deployed as Docker Image resources on `:main`: `bsec-web` (3000), `bsec-platform` (4000), `bsec-worker` (4100), `bsec-admin` (8080, nginx). Each has its own DB credentials only (`app_rw` for web/worker, `app_platform` for platform only).
- [x] **End-to-end verified live** (not just locally) via the auto-generated sslip.io URLs:
  - web `/api/health` → `db.ok:true`, role `app_rw`; storefront `/` → 200.
  - platform `/health` → `db.ok:true`, role `app_platform`.
  - worker logs show it connected, started, and processed the `system.ping` job.
  - admin `/health` → 200; SPA and a deep link (`/orders`) both → 200.
- [x] Domain: `gobs.cloud` + `www.gobs.cloud` → `bsec-web`, `admin.gobs.cloud` → `bsec-admin`, `platform.gobs.cloud` → `bsec-platform`. All three live behind Cloudflare (proxied, SSL/TLS mode "Full"), DNS managed in the user's Cloudflare account. **Caught and fixed a bug in my own setup**: when I first added the admin/platform domains through Coolify's "Add Domain" dialog, the field already had a value pre-filled (autocomplete or a stale value from a prior attempt) and my typed text got appended instead of replacing it, silently saving the domain as the literal string `admin.gobs.cloudadmin.gobs.cloud` — this is what caused a 503 ("no available server", Traefik had no router for the real hostname) that the user caught from a screenshot. Fixed by removing the bad entries and re-adding clean ones (`admin.gobs.cloud`, `platform.gobs.cloud`), redeploying each app, confirmed working (200, correct `service`/`db.role` in the health payload) end to end through Cloudflare on all three. Also removed the auto-added `www.admin.gobs.cloud` / `www.platform.gobs.cloud` entries — not needed for admin/API subdomains, only the storefront needs a www variant. **Lesson:** always verify a freshly-typed value in this Coolify UI by reloading and re-reading it, not just by what was typed — autocomplete/stale-value collisions are real here. During this cleanup I also accidentally removed `bsec-platform`'s auto-generated `sslip.io` fallback domain (clicked a stale element reference after a re-render) — low-impact, it was only a diagnostic convenience, not something anything depends on, but noting it here since it was never explicitly called out at the time.
- [ ] `platform.gobs.cloud` is publicly reachable with no auth in front of it yet (M1 will add platform_staff auth at the app layer; Cloudflare Access could restrict it sooner — not set up).
- [x] Cloudflare R2 for offsite backups — set up and verified end-to-end; see the Backups item below.
- [x] Staging, as a CI-based ephemeral stack instead of a persistent VPS (decided 2026-09-29, cost/simplicity). `ci.yml`'s `staging-smoke-test` runs `docker-compose.staging.yml` with the just-pushed `sha-<sha>` GHCR images and per-run random secrets, asserts migrate exit 0 and `/health` (`status`, `db.ok`, `db.role`) on web/platform/worker/admin, then `down -v` under `if: always()`; `deploy-production` needs it. **Verified**: green run 36536841168 (commit 128d86a), staging job 39s, all health checks passed with correct roles, teardown removed all containers/volume/network, production deployed after. Still TODO: COD order smoke test for M5's exit criterion. See RUNBOOK section 0.
- [x] Admin/platform domains: `admin.gobs.cloud` and `platform.gobs.cloud` (+ auto-added `www.` variants) configured on `bsec-admin` / `bsec-platform` in Coolify and both resources redeployed. **Blocked on DNS**: neither subdomain has an A record yet (`nslookup` confirms NXDOMAIN) — I don't have registrar/Cloudflare access to add one. **Action needed:** add `A admin.gobs.cloud → 88.222.241.159` and `A platform.gobs.cloud → 88.222.241.159` (same IP as the working `gobs.cloud` record) at whatever DNS provider manages gobs.cloud; SSL will then issue automatically on Coolify's next check. Also worth deciding before real use: per PLAN §14, `platform.*` should sit behind Cloudflare Access (or at least not be publicly reachable) since it's the BYPASSRLS admin API — right now it's just a public HTTPS domain like any other once DNS resolves.
- [x] Production deploy wired for real: `ci.yml`'s `deploy-production` job calls Coolify's `POST /api/v1/deploy` with a Coolify API token (Keys & Tokens → API Tokens, permission scope **Deploy** only, 1-year expiry — rotate before it expires) stored as the `COOLIFY_TOKEN` secret on the GitHub `production` environment. Deploys `bsec-migrate` first, sleeps 45s (no read-scope to poll status — deploy-only token), then redeploys the four app resources in one call (Coolify accepts comma-separated UUIDs). **Verified against the real API**: manually triggered a deploy of all 5 resources via `curl` before wiring CI, confirmed each redeployed and stayed healthy. The `deploy-staging` job was removed (see above) rather than left as a no-op.
- [ ] GitHub `production` environment has **no required-reviewers gate** — attempted to set one via API, got `422`: "Please ensure the billing plan supports the required reviewers protection rule." Private repos need a paid GitHub plan (Team/Enterprise, or a public repo) for this feature. Until upgraded (or the repo is made public), the "manual approval" in `ci.yml`'s comment is aspirational only — every push to `main` that passes CI deploys straight to production automatically.
- [x] Database backups: **Coolify's native scheduled backup** set up on `bsec-postgres` instead of pgBackRest (simpler, no VPS shell access needed, and Coolify already had the feature built in) — daily `pg_dump` of the `bsec` database at 02:30 UTC (cron `30 2 * * *`), local retention 14 backups / 14 days / 5 GB cap. **Verified for real**: ran "Back Up Now", produced a 45 KB dump, listed under Executions as `Success`, stored at `/data/coolify/backups/...` on the VPS.
- [x] Offsite backups to Cloudflare R2. Created bucket `bsec-backups` (Standard class, Asia-Pacific) and a scoped Account API Token ("R2 Account Token Backups", Object Read & Write, limited to that one bucket — same pattern as the existing per-project tokens). Added it in Coolify as an S3 Storage destination (`bsec-backups-r2`, endpoint `https://7a0533854a8ded58696db809f403f26c.r2.cloudflarestorage.com`, region `auto`) — shows **Connected** after Validate Connection. Attached it to `bsec-postgres`'s existing backup schedule (S3 storage + "Keep local backup", so local disk still has a copy too). **Verified for real**: ran "Back Up Now", the execution shows `Success` with both `Local Available` and `S3 Available`, and the Cloudflare R2 dashboard shows real objects under `bsec-backups/data/` with non-zero Class A/B operations.
- [x] Backup restored into a scratch database, with RPO/RTO logged (2026-09-28). Ran through Coolify's browser Terminal into the `bsec-postgres` container (no raw VPS SSH used): took a fresh `pg_dump -Fc` of `bsec` (54.6 KB, sub-second), created a scratch database `bsec_restore_drill`, ran `pg_restore` into it, verified it came back structurally correct (13 tables restored across `public` + `pgboss` schemas, matching the source), then dropped the scratch database and removed the temp dump file. **RPO:** effectively 0 for this drill since the dump was taken fresh immediately before restoring (the real, scheduled RPO is ≤24h per the daily cron — see the pgBackRest note below for why that's not ≤15min yet). **RTO:** dump + restore + verify + cleanup completed in under 2 minutes end to end (well inside the plan's ≤2h target), though this was a small (55 KB) M0-era database with no real order/customer data yet — re-run this drill once real data volume exists to get a meaningful RTO number at scale. Did **not** compare row counts against the live `bsec` database directly (the coding agent's safety layer correctly blocked a direct read against the production database mid-drill) — verification was structural (table/schema count) rather than row-for-row, which is sufficient to prove the restore mechanism works but not a full data-integrity diff; worth tightening in a future drill once there's real data to diff.
- [ ] pgBackRest / WAL continuous archiving (`infra/backups/`, draft) — superseded by the Coolify-native `pg_dump` approach above for now. pgBackRest gives point-in-time recovery (RPO ≤ 15 min); daily `pg_dump` only gives RPO ≤ 24 h. Revisit if/when real order data makes that gap matter.
- [ ] Sentry projects + DSNs set. The code is wired and no-ops without a DSN; not yet verified against a live Sentry.
- [ ] Better Stack log drain + uptime monitors.
- [ ] Coolify healthcheck (the HTTP-request check configured per-resource) fails on this server with "wget: can't connect to remote host: Connection refused" even though the app is listening — its `docker exec`-style check appears to run outside the app container's network namespace. Worked around by leaving Coolify healthchecks **disabled** on all four app resources and verifying liveness via the apps' own `/health` endpoints externally instead. Worth root-causing later (possibly a Coolify/Docker network mode quirk on this host) before relying on Coolify's own rolling-update healthcheck gating.
- [ ] Coolify's "Exposed ports" field was flaky when set through the General page's Internal-access widget (silently reverted to `80` after save+reload for two resources) but reliable when set through the dedicated Networking sidebar page. Every app also now sets `PORT` (and `HOSTNAME` for web) explicitly as an env var as a defensive fix — don't rely on "Exposed ports" alone to determine what port the app binds.
- [x] Cleaned up two stray Coolify resource states (2026-09-28), found by spot-checking the project's resource list: `bsec-migrate` was stuck in a `Restarting` loop (expected — it's a one-shot job that exits 0, and Coolify's default restart policy loop-restarts anything that exits; the last two doc-only pushes retriggered a deploy and nobody had manually stopped it since — see the gotcha already noted above). Stopped it; now `Exited` as intended. Separately found a genuinely stray resource, `bsec:main-o99ubyhaj8qpgqyiwhoyzrgs` — an application built via Git+Railpack directly from the `bs-commerce-platform` GitHub source (not our GHCR Docker-image pipeline), with "Deploy on push" enabled, listening on port 3000 (colliding with `bsec-web`), stuck crash-looping. Not referenced anywhere in this repo's docs; almost certainly an artifact from connecting GitHub as a Coolify source earlier in the session. Confirmed with the user, then deleted it entirely (including its volumes/networks/config). Resource list is now exactly the 6 real resources: `bsec-admin`, `bsec-migrate`, `bsec-platform`, `bsec-postgres`, `bsec-web`, `bsec-worker`.

### Notes / decisions this session
- TypeScript pinned to 6.0.3, not 7.0.2: typescript-eslint 8.70 supports `<6.1`.
- Only the 6 M0 packages were created. payments, shipping, storage, email and blocks will be created in their milestones.
- The `migrate` image is a fifth image beyond the four apps. It carries the owner credentials so that no runtime image does.
- Local compose: if host port 5432 is taken, run with `POSTGRES_HOST_PORT=55432`. This machine needed it.
