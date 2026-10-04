# Store Admin Settings rebuild — Phase 8 builder prompt (storage view, maintenance, hardening and rollout)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the builder for **Phase 8 only**, the last phase. Claude verifies against section 9 and then runs the final release review; you never merge your own PR.

Read first, in order: `AGENTS.md`; `docs/SETTINGS-PHASES-3-8-HANDOFF.md` (owner decisions §1, standards §3); `docs/ARCHITECTURE.md`; **every** `docs/changes/` record from Phases 0-7; `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §9 and §10; `docs/SETTINGS-SCHEMA.md` §10.2, §13; `docs/adr/011-feature-flagged-rollout-and-fallbacks.md`; `docs/adr/013-quota-and-rate-limit-architecture.md`; `docs/adr/020-settings-capability-families.md`; `docs/admin-ui-standards.md`; `docs/migrations.md`; `docs/runbooks/` and `DEPLOYMENT.md`.

## 0. Gate and state
- **Phase 7 must be merged.** If not, stop and tell the owner.
- Own worktree `../bsec-settings-p8`, branch `feat/settings-rebuild-phase-8`; claim in `progress.md`.

## 1. Objective
Finish the safe operational controls (storage visibility, owner-only scheduled maintenance), then **prove the whole Settings workspace**: one authorization matrix test for every settings procedure, an audit-coverage test, rollout and rollback per section, performance and accessibility checks, and a written contract (cleanup) schedule for everything the earlier phases deliberately left dual-written. Owner decision 10: maintenance is **owner-only with no automatic customer notice**.

## 2. Audit (verified 2026-10-04; re-verify before relying on it)

| Area | Where | Today |
|---|---|---|
| Storage usage | `packages/domain/src/system/quotas.ts` (`storage_mb` quota, usage via a sum over `media`), quota table `QUOTA_DEFAULTS` | Computed for enforcement; **no merchant view**. Public media is served from R2 via `R2_PUBLIC_URL` / `CF_IMAGES_DELIVERY_URL`; private return photos use separate storage. |
| Maintenance mode | `packages/domain/src/storefront/lifecycle.ts` (`mode: "maintenance"`, `retryAfterMinutes`, returns `httpStatus 503`), `apps/web/src/middleware.ts` (~lines 57-110: applies 503 and `Retry-After`) | **Server enforcement exists** and is manual; the middleware **fails open** (treats the store as live) when the access lookup throws. `/settings/storefront` can switch to it. No schedule, no restore-previous-mode, no transition history. |
| Status audit | `store_status` | `changed_at`/`changed_by` only; Phase 3 adds audit rows. No append-only transition log. |
| Flags | `feature_flags`, `tenant_feature_overrides`, `isFeatureEnabled` (ADR-011), Super Admin Features page | Mechanism exists; earlier phases add flags (`settings.gst_v2`, `settings.policies`, others). |
| Authorization tests | `packages/domain/test/isolation.int.test.ts` (dispatcher), `apps/platform/test/{rbac,audit-coverage}.int.test.ts` | Platform procedures have a declared-role map and an audit-coverage suite; **store admin procedures have neither a declared-permission map nor an audit-coverage suite.** |
| Perf budget | `perf-budget-bundle.int.test.ts` (web `.next`) | Exists for the storefront; none for the admin settings routes. |

## 3. Slice 8A: Storage (`/settings/storage`, read-only)
Contract `admin.storageUsage.get`; `settings.read` in route and service; **no mutation procedure exists for this page**.
```ts
type StorageUsageView = {
  usedBytes: number; limitBytes: number | null; mediaCount: number;
  percentUsed: number | null;                 // null when unlimited
  state: "ok" | "warning" | "critical" | "over"; // <80%, 80-95%, 95-100%, >100%
  providerLabel: "Platform managed storage";
  publicMediaConfigured: boolean;             // true when a public media base URL is set; never the URL's credentials
  maxUploadBytes: number;                     // from the media_file_mb quota
  breakdown: Array<{ kind: "product_images" | "brand_assets" | "theme_assets" | "other"; bytes: number; count: number }>;
};
```
- Single indexed aggregate (no per-row loops), tenant-filtered through `withTenant`; cached per tenant for 60 s through the tenant-tag cache and invalidated after media writes/deletes through `cache-invalidation.ts`.
- **Never** return or accept bucket, endpoint, region, access key, secret, CDN token, object keys or provider names beyond the label. A contract-level test asserts the output schema has exactly these keys. Private return photos are **not** counted in or exposed by this view (separate storage by design); say so in the page text.
- UI: usage meter with state colours that never rely on colour alone, plain-language explanation of what counts, per-kind breakdown, "Request a larger plan" link to Plan and billing (owner only, Phase 5), (i) hover hints. Warning/critical/over states explain the hard-enforcement effect ("new uploads will be refused").
- Retention explanation: media of deleted products is removed by the existing cleanup (verify what runs; state exactly, no promises the code does not keep).

## 4. Slice 8B: Maintenance (owner-only, scheduled, audited)
Extends the Phase 3 storefront status page: a **Maintenance** section visible to everyone with `storefront.manage`, **mutations allowed only for the Store Owner** (decision 10): enforce with the owner-role check used elsewhere (`ctx.roles` includes `store_owner`), in route **and** service, with a denial test for Manager.

**Schema (expand-only):**
```
store_status: + maintenance_starts_at timestamptz null, + maintenance_ends_at timestamptz null,
              + mode_before_maintenance text null,   + maintenance_allow_staff_preview boolean not null default true
              check (maintenance_ends_at is null or maintenance_starts_at is null or maintenance_ends_at > maintenance_starts_at)
store_status_transitions (new tenant table, append-only; grants: app_rw SELECT, INSERT only):
  id uuid pk; tenant_id; from_mode text not null; to_mode text not null
  reason text not null check (reason in ('manual','scheduled_start','scheduled_end','watchdog_restore','platform'))
  actor_type text not null; actor_id text null; at timestamptz not null default now(); unique (tenant_id, id)
  index (tenant_id, at desc)
```
- **Immediate maintenance:** the owner switches mode now; the service records `mode_before_maintenance`, writes a transition row **and** an `audit_logs` row, invalidates the cache after commit.
- **Scheduled window:** owner sets start and end (store timezone in the UI, UTC in storage; end required, **at most 72 hours** after start; start in the future by ≥ 2 minutes). A pg-boss job pair (start, end), keyed `(tenant, window id)` and **idempotent**, flips the mode **after commit**, writing the transition (`scheduled_start` / `scheduled_end`) and an audit row with the system actor. Ending restores `mode_before_maintenance` (default `live`), clears the schedule fields, never overwrites a mode the owner changed manually during the window (if the mode is no longer `maintenance` at end time, only clear the schedule and log "already changed").
- **Cannot strand a store:** (1) immediate maintenance also gets an owner-visible "auto-restore after" safeguard: default 24 h, owner may extend up to 72 h or choose "stay until I turn it off" with an explicit confirm dialog naming the risk; (2) a **watchdog sweep** (every minute) restores any store whose maintenance window ended but is still in `maintenance` (job lost, deploy gap), writing `watchdog_restore`; (3) a Super Admin can always override: platform lifecycle (suspend) rules still win; test it.
- **Semantics:** HTTP **503 with `Retry-After`** derived from the remaining time of the window (cap 24 h; default `retryAfterMinutes` for immediate), `noindex`, no caching of the maintenance response (`Cache-Control: no-store`), the same for storefront APIs (cart/checkout mutations are refused during maintenance, in the **domain service** too, not only the middleware). **Staff preview:** owner/staff with a valid hashed preview bypass (Phase 3 scheme) or an admin session reaches the storefront; the bypass token is never returned after creation. Webhooks, health checks, admin APIs and background jobs are **not** blocked by storefront maintenance (ADR-011 gating principle: only entry actions are gated).
- **Middleware failure mode:** `apps/web/src/middleware.ts` currently fails open when the status lookup throws. Decide and document explicitly: keep fail-open for brief lookup errors (do not take every store down on a database blip) but **log and count it**, and add a test that a lookup failure never serves a `password`-mode store without the password (fail closed for `password`, open only for `live`): verify what the code does today first and fix if it can leak a password-protected store.
- **No customer notification** is sent automatically (decision 10); the page says so and offers a copyable message the owner can use. Maintenance message is a plain validated block list (ADR-010), never HTML.
- UI: schedule form with timezone-aware preview ("Starts Sat 10 Oct, 02:00 IST (Fri 20:30 UTC)"), active-window banner on the Settings Overview and admin header while maintenance is on, history table from `store_status_transitions`, `ConfirmDialog` for start/stop, clear states for scheduled, active, ended.

## 5. Slice 8C: Authorization matrix test (the lesson from Phase 2)
One generated, table-driven real-DB suite `packages/domain/test/settings-authorization.int.test.ts`:
- A single declarative map: **every settings-related `admin.*` procedure → required permission/family (and owner-only flag)**. The test enumerates the contract's procedures under the settings routers and **fails if any procedure is missing from the map**.
- For each procedure × actor (Owner, Manager/`store_admin`, custom role with only `settings.write`, custom role with only `analytics.read`, support session read scope, support session write scope, anonymous, other-tenant owner) assert allowed or denied exactly as the map says, at the **domain service** layer (and, via the router test helper, at the route layer).
- Include the owner-only set: payment credential writes, plan-change request, maintenance mutations, support standing consent. Any drift from `docs/adr/020-settings-capability-families.md` (the enforcement section) fails the suite; update the ADR table from the map in the same PR.

## 6. Slice 8D: Audit-coverage test
`packages/domain/test/settings-audit-coverage.int.test.ts`, modelled on `apps/platform/test/audit-coverage.int.test.ts`: for every settings **mutation** procedure, run it as an allowed actor against real Postgres and assert exactly one new `audit_logs` row with the declared action name, the right actor, the tenant, a before/after diff, and **no secret-shaped values** (scan keys and values for `password|secret|token|key|hash|authorization`-like content and for the known test secret strings). The map must cover every mutation or fail. Fix any procedure found without an audit row (record each in the change record).

## 7. Slice 8E: Rollout, rollback and the contract schedule
- **Flags:** produce `docs/runbooks/settings-rollout.md`: a table of every flag introduced in Phases 3-8 (key, default, what it gates, fallback behaviour when off, how to enable per tenant in Super Admin Features, how to roll back, what data is **not** reverted), the recommended rollout order (internal store → one friendly store → all), the pre-enable checks (CA review for `settings.gst_v2`, owner approval of policy wording for `settings.policies`, mail delivery enabled before staff alerts matter) and smoke checks per section. Add the missing seeds (migration with `default_on = false` rows) for any flag a prior phase referenced but did not seed; test `isFeatureEnabled` for default, override and kill switch.
- **ADR-021 "Settings contract schedule":** list every deprecated thing the phases left in place and when it is removed, **without removing any of it in this PR**: the `settings.write` aggregate fallback; `store_settings.checkout.cod` and `.tax` dual-writes and the `cod`/`tax` keys of `settings.update`; `customer_consent_events.ip`; `return_settings.policyText`; the legacy policy boilerplate fallback; `customers.note`; old payment-method synthesis. Each row: removal precondition (telemetry or data check), the release it may ship in (not the same release that stops using it), the rollback.
- **Legacy routes:** verify every old Settings URL (`/settings/team`, any renamed route) redirects or renders, bookmarks keep working, and no duplicate editor exists for any value (a short matrix in the change record: setting → canonical route).

## 8. Slice 8F: Performance, accessibility and UX proof
- **Performance:** the Settings Overview and every settings page issue a bounded number of queries (assert counts in a test using a query counter for the Overview and the heaviest page); settings routes are lazy loaded and the admin bundle stays within a documented budget (add an admin bundle-size assertion to the existing perf-budget pattern or a build-time check); no N+1 in the delivery-history, activity, privacy-request or policy-version lists (paged, indexed).
- **Accessibility (WCAG 2.2 AA targets):** keyboard-only pass through every settings page (focus order, visible focus, dialogs trap and restore focus, no keyboard traps), every control labelled, errors programmatically tied to fields (`aria-describedby`), status changes announced (`role="status"` / `aria-live`), colour never the only signal (storage meter, status chips), contrast checked in light and dark, touch targets ≥ 40 px at 375 px, reduced-motion respected. Use the repo's existing lint (check `eslint-plugin-jsx-a11y` presence) and component tests; add `@axe-core/playwright` **only** if you can justify the dependency in the change record, otherwise do the keyboard and label checks with router-context tests and manual notes.
- **Walkthrough matrix (you perform it on a local stack and report exactly what you drove):** roles (Owner, Manager, custom `settings.write`, `analytics.read`-only) × widths (375 px, tablet, desktop) × themes (light, dark) × states (loading via throttled network, error via a stopped API, dirty form + navigate away, stale-write conflict, permission-denied direct URL). Record failures as defects, fix them or list them.

## 9. Acceptance criteria
- [ ] Storage page has no mutation path and its output schema contains only the specified keys; usage is tenant-filtered, cached and invalidated after media writes; private return photos neither counted nor exposed.
- [ ] Maintenance: owner-only (Manager denied), scheduled windows ≤ 72 h with idempotent start/end jobs, watchdog restore, transition log append-only (grants test), audit row for every transition including system ones, 503 + `Retry-After` + `no-store`, cart/checkout refused in the domain service during maintenance, staff preview works, no automatic customer message, a store can never be left stranded (tests for lost job, manual change during window, deploy gap, platform suspend precedence).
- [ ] Middleware failure mode documented and tested; a password-protected store is never served without the password on lookup failure.
- [ ] Authorization matrix and audit-coverage suites exist, cover **every** settings procedure (they fail on omissions), and pass; ADR-020 enforcement table regenerated from the map.
- [ ] `docs/runbooks/settings-rollout.md` and ADR-021 written; every flag seeded `default_on = false` with fallback tested; nothing from the contract schedule removed.
- [ ] Performance and accessibility checks done and recorded; walkthrough matrix performed with defects fixed or listed honestly.
- [ ] No cross-tenant setting, audit entry, credential status or readiness signal is observable (the matrix and isolation suites prove it).
- [ ] Migrations append-only, RLS forced, grants test updated, journal increasing. Gate: `typecheck`, `lint`, `build`, `docs:check`, **all** fast suites, `@bs/domain` heavy, `@bs/platform` suites (counts pasted).

## 10. Commit plan
1. `feat(settings): storage usage view` 2. `feat(storefront): owner-only scheduled maintenance, transitions log, watchdog` 3. `fix(web): documented middleware failure mode` 4. `test(settings): authorization matrix and audit-coverage suites (+ fixes they expose)` 5. `docs: rollout runbook, flag seeds, ADR-021 contract schedule, ARCHITECTURE, ADR-020 table` 6. `test/perf/a11y: bounded queries, admin bundle budget, accessibility fixes`.

## 11. After you hand off (Claude)
Claude runs the full gate, the verification protocol in the HANDOFF §6 for this phase, an independent browser walkthrough, a security review of the whole Settings diff, and decides with the owner which flags to enable on which store first. Nothing in Phases 3-8 is called done before that.
