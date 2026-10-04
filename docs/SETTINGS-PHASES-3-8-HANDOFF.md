# Store Admin Settings — Phases 3 to 8: master hand-off

**For:** Antigravity (builder). **Verifier:** Claude (primary coding agent). **Owner:** decides pricing, legal, providers, data deletion and priorities.
**Date:** 2026-10-04. **Status:** Phases 0-2 are merged. This document is the single entry point for Phases 3-8; each phase has its own detailed builder prompt in `docs/prompts/`.

Read in this order: `AGENTS.md` → this file → the prompt of the phase you were assigned → the documents that prompt lists. If anything here disagrees with the code, the code wins: fix the doc in the same change and say so in your change record.

## 1. Owner decisions on record (2026-10-04: the owner accepted the recommended defaults)

These answer `SETTINGS-REBUILD-REMAINING-PHASES.md` §11. Do not re-ask; do not exceed them.

| # | Question | Decision |
|---|---|---|
| 1 | Delegation of sensitive authority | Per ADR-020: `payments.manage` is owner-only; every other family is held by Owner and Manager (`store_admin`). Support sessions never receive any settings family. |
| 2 | V1 market | **India only:** INR, English, GST. No multi-currency, no markets, no international tax or duties, no localisation UI. |
| 3 | Account creation default | **Guest checkout stays on**, and the shopper is offered an optional account **after a completed order** (`accountCreation = "after_completed_order"`, verified identity per ADR-019). This equals today's behaviour, so the default changes nothing for existing stores. |
| 4 | Manual payment methods beyond COD | **None for V1.** COD only. Bank transfer and money order stay deferred (no reconciliation design). |
| 5 | Online payment provider | **Razorpay first, but only after the owner explicitly authorises provider work in a session.** Until then Razorpay stays a catalogue entry; AGENTS rule 14 applies. |
| 6 | Plan changes | **Request-only.** A merchant owner can see plan, usage and invoices and request a change; Super Admin decides and charges. No self-service billing. |
| 7 | Shipping depth | **Default zones and rates only for V1** (profiles, pincode, weight and packages are specified in Phase 6 as optional later slices, built only on the owner's explicit go). |
| 8 | Policy and cookie wording | The owner (with their own counsel) approves template wording. bsec ships structure, versioning and **clearly marked starter drafts that are never auto-published**; it gives no legal advice. |
| 9 | Notification channels | **Email only.** SMS and WhatsApp stay hidden or visibly unavailable. |
| 10 | Maintenance scheduling | **Owner-only**, no automatic customer notice. |

Consequences for scope: Phase 4 ships no new account mode beyond what exists; Phase 5 ships the payments catalogue and COD plus plan/billing and the request flow, with the Razorpay adapter as a **gated** slice (5B); Phase 6 ships the default-zone shipping and GST work (slices 6A-6D) and leaves profiles, pincode, weight tiers and packages as specified-but-gated slices (6E, 6F); Phase 7 is email-only; Phase 8 maintenance scheduling is owner-only.

## 2. Phase map and order

| Phase | Prompt | Scope | Needs owner action before start |
|---|---|---|---|
| 3 | `prompts/settings-rebuild-phase-3.md` | Branding, storefront status, domains; four defects in existing code | None |
| 4 | `prompts/settings-rebuild-phase-4.md` | Checkout, customer accounts, orders and returns settings | None |
| 5 | `prompts/settings-rebuild-phase-5.md` | Payments catalogue and COD, plan and billing, plan-change requests; 5B Razorpay (gated) | 5B: explicit "authorise Razorpay" plus test keys |
| 6 | `prompts/settings-rebuild-phase-6.md` | Shipping rates and GST (defaults), tax classes, credit notes; later slices gated | 6E/6F: explicit go; GST items: chartered-accountant review |
| 7 | `prompts/settings-rebuild-phase-7.md` | Notifications, policies, customer privacy (DPDP) | Policy template wording approval |
| 8 | `prompts/settings-rebuild-phase-8.md` | Storage view, maintenance mode, hardening and rollout | None |

**Order is strict.** Phases touch the same navigation, permission, contract and isolation-suite files, so they are not parallelisable. A phase starts only after the previous phase is **merged**: the builder opens a PR, Claude verifies it against the phase's acceptance criteria and the full gate, fixes or sends back what fails, and merges. "Done" means verified, not written. Phase 3 and Phase 4 have no dependency on each other beyond file overlap; keep the order anyway.

Migration numbers: the next free number after the theme builder (0031, 0032) is **0033**. Each prompt names the migration slices it needs; always re-check `packages/db/migrations` and `meta/_journal.json` and take the next free number at build time. Journal entries need strictly increasing `when` values.

## 3. Shared engineering standards (apply to every phase; the prompts do not repeat them)

### 3.1 Repo rules that bind (AGENTS.md §2, restated because they were broken before)
1. Every tenant table uses `tenantTable()`, its migration runs `forceRlsSql(name)`, references between tenant tables use `tenantForeignKey`. Platform tables have **no RLS** and the application role can read them: every query on them must filter by tenant in code and has a cross-tenant test.
2. Only `packages/db` and `packages/domain` import the database drivers; all business logic lives in `packages/domain`; routes and UI stay thin.
3. **A permission nobody enforces is a defect.** Each protected procedure is checked in the route middleware **and** in the domain service (`assertPermission`), has a real-database test that a role without the permission is refused, and the matching navigation item's `perm` agrees. (Phase 2 shipped `payments.manage` defined but unenforced.)
4. Cache tags are tenant-prefixed; invalidate **after commit** through `cache-invalidation.ts`; never call a service with `rt` inside a transaction callback (`bs/no-service-call-in-tx`).
5. Every settings mutation writes `audit_logs` (before/after of the changed fields, never a secret); every platform mutation writes `platform_audit_logs`.
6. Secrets: write-only, encrypted with `TENANT_SECRETS_KEY` in `tenant_secrets`, shown to the UI only as set/not-set plus a short hint, never in logs, audit diffs, errors, query cache or test snapshots.
7. Side effects (email, provider calls) run after commit through pg-boss; enqueue inside the business transaction; jobs are **idempotent** (an event key) and re-check the latest preference at execution time.
8. No merchant-controlled code: validated JSON blocks with enumerated props only; no HTML, CSS, JS or template code from a merchant.
9. Migrations are append-only and **expand / migrate / contract** (`docs/migrations.md`): never edit an applied migration, never drop or rename in the release that stops using a column. Journal entries strictly increasing.
10. Money is integer paise, percentages integer basis points, weights grams, dimensions millimetres, timestamps UTC `timestamptz`, ids UUIDv7.

### 3.2 Settings design standards
1. **One canonical editor and one live behaviour per setting.** A setting without an enforcing domain consumer is not rendered (SETTINGS-SCHEMA §1 rule 5). A disabled feature shows why. No decorative toggles.
2. **Safe defaults equal today's behaviour.** Every JSON group has a mandatory `v` field and a parser whose defaults preserve what stores did before the option existed (`parseStoreConfig` is the pattern). A store with no saved row behaves exactly as before; test it.
3. **Lost-update protection.** A settings update carries the `updatedAt`/`version` it was based on; the service rejects a stale write with a clear conflict error (`409`-style) instead of silently overwriting a colleague's change. The UI shows "changed by someone else, reload".
4. **Narrow contracts.** One `get` and one `update` per group plus explicit action procedures; never an untyped `updateSettings`. Zod boundary tests for every limit.
5. **Server recomputes everything that matters** (prices, shipping, tax, fees, availability). Client values are hints.
6. **Honest status.** Show what the server returned; never fabricate "active", "verified", "sent" or "live" states. Say whether a change is saved, queued or live.
7. **Rollout.** Each new section ships behind a per-section feature flag (ADR-011) that fails closed to the old behaviour, and is enabled tenant by tenant. Document fallback and rollback in the change record.
8. **Accessibility and UX** per `docs/admin-ui-standards.md`: shared kit (`SettingsPageFrame`, `SettingsSection`, `SimpleSelect`, `ConfirmDialog`, table kit), no native `<select>`, no `window.confirm`, `pendingComponent` on every route, unsaved-changes guard, 12 px scale, dark mode, 375 px, visible focus, labelled controls, errors tied to fields. Editor hints sit behind an (i) icon hover pop-up, not inline text (owner preference).
9. **Privacy by design (DPDP Act 2023).** Collect the minimum; store IP and user-agent only hashed when a record needs them as evidence; explicit purpose and retention for every new personal-data table; consent is unticked by default, specific, withdrawable, and immutable as an event history.

### 3.3 Testing standards
1. Pyramid: unit tests for pure logic (parsers, validators, calculators, label maps), real-Postgres integration tests (`*.int.test.ts`, `startTestDb`) for anything touching tenancy, money, auth, permissions or consent, router-context component tests for the admin UI, Playwright only for stable end-to-end paths. **Mock-only tests prove nothing about the database.**
2. Per mutation: Zod boundary, allowed role, denied role, cross-tenant refusal, audit row without secrets, stale-write conflict, and a behaviour test proving the setting changes the real checkout/storefront/job path.
3. A test for every defect fixed, written to fail first.
4. Map every new `admin.*` procedure in `packages/domain/test/isolation.int.test.ts` (the suite fails otherwise).
5. Run tests one package at a time. `pnpm test:heavy:local` runs the domain heavy suite against Docker Postgres 18 in about 4 minutes with honest exit codes; a Windows worker crash with code `3221226505` is a known flake: rerun that file alone and say so in the record.

### 3.4 Lessons from the integration pass (each was a real defect)
1. Run `pnpm typecheck` on the tree **after merging the latest `origin/main`**.
2. Grep `e2e/` for any label or route you rename. Playwright runs only on `main`: a broken spec blocks the deploy. Settings nav links have accessible names that include their description: match by prefix (`/^Domains/`), never `exact`.
3. Parse any YAML you edit with the `yaml` package from the pnpm store (an unquoted colon in a `name:`/`run:` value invalidated a whole workflow).
4. After changing a local ESLint rule, delete `node_modules/.cache/eslint`.
5. An ADR that claims a protection must match the enforcement; keep the "Enforcement status" section of ADR-020 current.

### 3.5 Git and collaboration (AGENTS.md §5, §6)
Own worktree per phase (`git worktree add ../bsec-settings-pN -b feat/settings-rebuild-phase-N origin/main`); claim it in `progress.md` "In flight" first; stage exact paths (never `git add -A`, `.` or a directory); read `git status` for files you did not write before every commit; focused conventional commits with your own trailer; local gate green before pushing; one PR per phase; **never merge your own PR**. Leave `docs/changes/YYYY-MM-DD-antigravity-settings-rebuild-phase-N.md` from `docs/changes/TEMPLATE.md` with the Definition of Done from `AGENTS.md` §7, exact test counts, what you drove in a browser and what you did not. Update `docs/ARCHITECTURE.md` (procedures, routes, tables, jobs, permissions, "Last verified") in the same PR. `main` is production: a merge that passes CI deploys to the live store, so nothing unverified goes in.

### 3.6 Testing against live
Never drive the live store, create records there, rotate secrets or touch Coolify or Cloudflare. Local or ephemeral data only.

## 4. Phase 3 plan (summary; the full builder prompt is `prompts/settings-rebuild-phase-3.md`)

**Goal:** coherent store identity, storefront availability and domain state, without merging theme editing into Settings and without exposing provider (Cloudflare) controls.

**Four defects found in current code, fixed first with tests that fail first:**
1. `updateStoreStatus` returns before its cache invalidation: the invalidation is unreachable, so a mode change never refreshes the cache.
2. The store password and preview bypass token verify as true when the typed value equals the stored hash (replayable), and the password is unsalted SHA-256: move to a salted slow hash with lazy re-hash, keep verifying the legacy format without the equality shortcut.
3. The domains service has no permission check, no audit rows and an unguarded `list`: take a `TenantContext`, enforce `domains.manage`/`settings.read`, audit, keep the platform subdomain non-removable, never expose provider identifiers.
4. Branding updates write no audit row and accept any media id without type/size validation.

**Slices:** 3A defects 1-2 (storefront); 3B defect 3 (domains service); 3C defect 4 and branding (validated slots, `branding.manage`, ownership table for Branding vs theme); 3D storefront page copy and `storefront.manage`; 3E the new `/settings/domains` page; 3F docs and ADR-020 enforcement status.

**Schema:** expand-only, optional `brand_settings.app_icon_media_id` (only if the storefront emits it). No other schema change.

**Done when:** the acceptance criteria in the Phase 3 prompt §8 pass, including real-DB denial tests for every migrated procedure and a browser check at 375 px, tablet and desktop in light and dark.

## 5. Cross-phase contract list (so builders do not collide)

| Shared file or area | Rule |
|---|---|
| `apps/admin/src/components/settings/settings-nav.ts` | Add your items in your phase; keep groups; update `perm`; update specs by prefix. |
| `packages/auth/src/index.ts` (permissions) | The families already exist (ADR-020). Do not add strings casually; if you must, extend the ADR, the support-set exclusions and their unit tests. |
| `packages/contracts/src/admin.ts` | Add contracts first; keep procedure names stable; parse tests in `@bs/contracts`. |
| `packages/domain/test/isolation.int.test.ts` | Map every new procedure. |
| `store_settings` JSON groups | `checkout` (Phases 4, 5, 7), `notifications` (Phase 7), `return_settings` (existing), new `order_settings` (Phase 4). Each group has one parser module and one owner phase. |
| `docs/ARCHITECTURE.md` | One row per new table, procedure, job, route; bump "Last verified". |

## 6. Verification protocol (Claude, per phase)

1. Fetch, merge latest `origin/main` into the PR branch, run `pnpm docs:check`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, impacted fast suites, and the domain heavy suite; check every acceptance criterion against the code, not the change record.
2. Hunt the known failure classes: unenforced permissions, secrets in diffs or responses, missing audit rows, stale-cache paths, client-trusted values, defaults that change today's behaviour, missing `e2e/` updates, un-mapped isolation procedures.
3. Browser check of the new surfaces on a local stack; then merge when CI is green. Record the result in a `docs/changes/` verification record.
