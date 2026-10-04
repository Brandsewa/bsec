# Store Admin Settings rebuild — Phase 2 builder prompt (permissions, users & accounts, activity)

You are the assigned builder for **Phase 2 only** of the Store Admin Settings rebuild in the `bsec` monorepo. Do not begin Phase 3 or later. Your work must leave a safe foundation for the next builder. The delivery map, per-phase scope and cross-phase checklist are in `docs/SETTINGS-REBUILD-REMAINING-PHASES.md`; the product direction and target schema are `docs/SETTINGS-REBUILD-PLAN.md` and `docs/SETTINGS-SCHEMA.md`. This prompt adds repo state, the Phase 0/1 integration points, and the owner decisions that are already made. Where this prompt and the plan disagree, stop and ask the owner.

## 0. Sequencing gate and current repo state (read first)

**Phase 0/1 is built but may not be merged when you start.** It was built by ZCode on branch `feat/settings-rebuild-phase-0-1` and is open as **PR #25** with all CI checks green (typecheck 15/15, lint, build 6/6, docs:check, contracts 17/17, domain fast 247/247, admin 32/32, web 17 files, isolation int 761/761, store-settings int 16/16, full heavy suite 63 files / 1202 tests / 0 failures on real Postgres). Its verifier is Claude.

1. `git fetch` and run `gh pr view 25 --json state,mergeCommit`.
2. **If PR #25 is merged:** branch from the latest `origin/main` as normal.
3. **If PR #25 is not merged:** ask the owner whether to (a) wait for verification, or (b) stack your branch on `feat/settings-rebuild-phase-0-1` (tip `8317347`) and open your PR against that branch. Do not base Phase 2 on `origin/main` without Phase 0/1 in your history — you would be rebuilding its work, which the plan forbids.
4. Before writing code, read the Phase 0/1 change record `docs/changes/2026-10-04-zcode-settings-rebuild-phase-0-1.md`. It contains the pre-rebuild route/data map and six documented divergences between the plans and the code. Do not contradict it silently.

### What Phase 0/1 already delivered — do not rebuild, build on it

| Area | State on PR #25 |
|---|---|
| Navigation | `SETTINGS_NAV_GROUPS` in `apps/admin/src/components/settings/settings-nav.ts`: six groups (Overview / Store / Selling / Operations / People & account / Compliance & advanced) with `visibleSettingsGroups(permissions)` omitting empty groups. The Team item is **already labelled "Users"** but its route is still `/settings/team`. |
| Overview | `/settings` renders from `admin.settingsOverview.get` (contract in `packages/contracts/src/admin.ts`, service `packages/domain/src/admin/settings-overview.ts`, handler in `apps/web/src/server/api.ts`), gated `settings.write`. |
| Store details | `/settings/store-details` is the canonical editor (old General page moved). Timezone is an editable `SimpleSelect` over curated `STORE_TIMEZONES` with `StoreTimezone` validating `settings.update.timezone`. GSTIN is read-only with a "Managed in Taxes" link. Address saves gain `countryCode: "IN"` by default (jsonb, preserves an existing value). |
| Audit | `updateStoreSettings` now writes an `audit_logs` row (`store_settings.update`, before/after diff, no secret-shaped values) — use it as the audit pattern reference. |
| Support sets | `packages/domain/src/context.ts` derives support-session permissions from `STORE_PERMISSIONS` (read = `*.read`, write = deny-list). Any permission string you add must be kept out of both support sets — support sessions never gain settings/users/payment/export/refund/configuration capability, and today they have no settings access at all (`settings.read`/`audit.read` are explicitly excluded from the read set to preserve that behaviour). |
| Deferred fields | `businessType`, `ownerProfile`, `locale`, `dateFormat`, `timeFormat`, `unitSystem`, `weightUnit` are deliberately **not** in any UI (no domain consumer; SETTINGS-SCHEMA §1 rule 5). |
| Migrations | Phase 0/1 used **no migration**. The next free migration slot is **0032** (0029/0030 are PR #23, 0031 is `feat/superadmin-themes`). Re-check at build time. |
| Docs | `docs/ARCHITECTURE.md` routes/procedure list and "Last verified" were updated on the branch. |

### Merge-order warning

PR #23 (`feat/customers-segments`) also touches `packages/contracts/src/admin.ts` and `packages/domain/test/isolation.int.test.ts` (different regions than Phase 0/1, but textual conflicts are likely). Check which of #23/#25 is merged when you rebase, and note any collision handling in your change record.

## 1. Objective

Replace the broad settings authorization model with narrowly granted capability families without breaking existing staff access, rebuild Team as **Users & Accounts** at its new route, and expose a safe tenant-scoped **Settings Activity** view.

## 2. Scope boundary

### You must build

1. **ADR and permission migration** (expand/migrate/contract per `docs/migrations.md`; no stored-role rewrites):
   - Write `docs/adr/020-settings-capability-families.md` (020 is the next free number) and register it in `docs/adr/README.md`. Cover: the capability families from `SETTINGS-SCHEMA.md` §3.2; the mapping from the current 14-permission model; grandfathering and rollout; owner-only operations; how direct-route/API denial behaves; and the contract step that later deletes the mapping.
   - Add the new permission strings in `packages/auth/src/index.ts` (`STORE_PERMISSIONS`), keeping `staff.manage` as-is.
   - Encode the owner-approved delegation matrix in `SYSTEM_STORE_ROLES` (see §5): `payments.manage` is owner-only — `store_admin` must not hold it; every other family is held by both system roles.
   - Add a check-time aggregate mapping so roles holding the legacy `settings.write` still satisfy every migrated family except `payments.manage` (and `staff.manage`, which was never part of the aggregate). One place, in `@bs/auth`, next to the matrix. Existing custom roles keep working without a data migration; that is the "migrate" step.
   - Keep `packages/domain/src/context.ts` support-session sets free of every new family (read and write), preserving today's behaviour exactly.
2. **Users & Accounts** at `/settings/users`:
   - Move the Team route (`apps/admin/src/routes/_store/settings/team.tsx`) to `users.tsx`; legacy `/settings/team` becomes a tested redirect. Update the nav item's `href` (label "Users" is already correct).
   - Staff list with role, invitation status and access warnings only where the data truly exists; invite, revoke invitation, change role, remove member (these exist in `packages/domain/src/admin/team.ts` — reuse; do not duplicate).
   - A read-only Store Owner identity summary. **No owner transfer implementation** — link/explain instead.
   - Last-owner protection and no-self-removal already exist and have tests; do not weaken them.
3. **Settings Activity** at `/settings/activity`:
   - One narrow contract (`settingsActivity.list`-style, no untyped endpoints), a domain read service gated by the `audit.read` family, tenant-scoped projection of `audit_logs` for settings mutations with filters (setting area, actor, date range) and paging with an `id` tie-break.
   - No secrets, ciphertext, raw authentication metadata or other tenants' rows. Redact or omit unsafe diff values defensively at the domain layer — the audit diff is data, not trusted content.
   - List UI on the shared table kit inside the Settings frame, with loading/empty/error states and `pendingComponent`.
   - Add the nav item to "Compliance & advanced" in `settings-nav.ts` (permission `audit.read`).

### You must not build

- Anything from Phases 3–8 (branding/storefront/domains, checkout/accounts, payments/billing, shipping/taxes, notifications/policies/privacy, storage/maintenance).
- Payment, domain-provider, email/SMS/WhatsApp or storage work; no new dependencies without a documented reason.
- Owner transfer, plan changes or support-consent changes (owner-gated outside this permission model; note them in the ADR as explicitly out of scope).
- Deleting the legacy `settings.write` aggregate or rewriting stored role rows (that is the later contract phase).

If a product decision materially changes this phase, stop and ask the owner. Do not silently choose a policy.

## 3. Read before writing code

In order, all binding:

1. `AGENTS.md` (especially §2 hard rules, §4 gate, §6 protocol — including your commit trailer from the per-agent table).
2. `docs/ARCHITECTURE.md` (§6 tenancy, §8 API, §9 UI routes, §12 auth, §15 testing).
3. `docs/changes/`: the newest records, especially `2026-10-04-zcode-settings-rebuild-phase-0-1.md` and anything touching auth/permissions/team.
4. `progress.md` "In flight" — check for collisions, then add your one-line claim before coding.
5. `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §3 and §10; `docs/SETTINGS-SCHEMA.md` §3; `docs/SETTINGS-REBUILD-PLAN.md` §2 and §3.3.
6. `docs/adr/002-tenant-isolation-rls.md` and `014-admin-auth-and-api-access.md`.
7. Implementation files: `packages/auth/src/index.ts` (permissions, system roles, `hasPermission`), `packages/domain/src/context.ts` (TenantContext, `assertPermission`, support sets), `packages/domain/src/admin/team.ts`, the team route `apps/admin/src/routes/_store/settings/team.tsx`, `apps/admin/src/components/settings/settings-nav.ts` and `-layout.tsx`, `packages/domain/src/admin/store-config.ts` (the audit-write pattern), `packages/domain/test/isolation.int.test.ts` (dispatcher — every new procedure must be mapped there or the suite fails), `apps/admin/test/settings-shell.test.tsx` (router-test helpers), and `docs/migrations.md` if you need a migration.

If any required file or plan is missing, stop and report it.

## 4. Git and collaboration protocol

1. Work in your **own worktree** on `feat/settings-rebuild-phase-2` (or another `feat/...` name you register in `progress.md`). Never work in another agent's checkout; the shared `C:\dev\bsec` checkout belongs to Codex's planning branch.
2. Stage exact files only; never `git add -A`/`git add .`/`git add <directory>`. Run `git status` before every commit and look for files you did not write.
3. Focused commits with imperative subjects and your own configured agent trailer. Suggested split: (1) ADR + permission strings/matrix/aggregate + tests; (2) Users route move/redirect + tests; (3) Activity contract/domain/UI + isolation mapping + tests; (4) gate fixes, docs, change record.
4. Keep all work local until the gate is green; then push and open a PR. **Never merge your own PR** — Claude verifies against the acceptance criteria before this counts as done.
5. Update `docs/ARCHITECTURE.md` (§8 procedures, §9 routes, §12 permissions, ADR index) in the same change; `pnpm docs:check` enforces part of it.
6. Leave a change record `docs/changes/YYYY-MM-DD-<agent>-settings-rebuild-phase-2.md` and remove your `progress.md` claim only at hand-off of a complete branch.

## 5. Owner decisions

**Already decided (2026-10-04, owner answered directly — reuse, do not re-ask):** the delegation model is the SETTINGS-SCHEMA §3.2 default matrix **including `staff.manage` for Manager (store_admin)**. Concretely: `payments.manage` owner-only; `staff.manage`, `domains.manage`, `audit.read`, and all other families held by Owner and Manager per the schema table; support sessions gain nothing. Record this as an owner decision with its date inside ADR-020.

**Still open elsewhere (do not decide them in Phase 2):** plan §11 items 2–10 (India-only V1, account-creation default, manual payment methods, Razorpay authorization, plan-change path, shipping depth, policy-template approval, channels, maintenance authority) gate later phases.

## 6. Required behaviour

- Every newly restricted mutation checks its family via `assertPermission` in the domain service; navigation filtering is never the control. Procedures you do not migrate keep `settings.write` and keep working through today's roles — the aggregate makes this safe.
- A support session never receives users, payment, export, refund or configuration capability, in read or write scope.
- Never remove the last owner; a role update must not grant a capability the actor cannot administer; every role/invitation mutation stays audited with before/after and no secrets.
- Direct URL to a denied route returns the standard domain `Forbidden: missing required permission` error, not a redirect to a placeholder.
- UI standards: `SettingsPageFrame`/`SettingsSection`, shared table kit, `SimpleSelect`, `ConfirmDialog`, no native selects or `window.confirm`, every route has `pendingComponent`, 12px body scale, dark mode and 375px are acceptance checks.

## 7. Required test matrix

### Permissions/ADR
- `@bs/auth` unit tests: matrix (store_admin lacks exactly `payments.manage`; holds `staff.manage`/`audit.read`); aggregate satisfies every migrated family, never `payments.manage`/`staff.manage`; a family held directly grants only itself; no duplicates in `STORE_PERMISSIONS`.
- Support sets: neither support scope contains any new family (unit test in `packages/domain`).
- Real-Postgres: allowed role, denied role (a staff with only `analytics.read` must be refused by the domain service for `settingsActivity.list`), and cross-tenant refusal for every new/changed procedure.

### Users & Accounts
- Route move: `/settings/users` serves the editor; `/settings/team` redirects; both covered by a router-context UI test; nav `href` updated.
- Invite/revoke/role-change/remove still pass the existing team suites; last-owner and self-removal protections re-proven.

### Activity
- Contract parse/boundary tests; domain filter/paging tests; real-DB test that the projection returns only the caller's tenant's rows and redacts secret-shaped diff values; each filter shown and empty/omitted state tested.
- New procedure mapped in the isolation suite dispatcher (allowed/denied/cross-tenant auto-tests then run against real Postgres).

### Gate
`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`; fast suites for `@bs/contracts`, `@bs/auth`, `@bs/domain`, `@bs/admin`, `@bs/web`; `pnpm --filter @bs/domain test:heavy` alone against Docker/Testcontainers or `TEST_DATABASE_URL_SUPERUSER` (one package at a time; known Windows worker-crash flake — rerun a failing file alone before investigating). Browser walkthrough at desktop, tablet and 375px in light and dark: Owner, a Manager, and a denied staff role; dirty-form guard on any form you touch. Only local/ephemeral data; never the live store.

## 8. Hand-off format

When you finish, report: branch and commit hashes; files/behaviour changed; every test/build command with real counts; the browser walkthrough and anything not tested; exact owner questions; and the path to your change record. Do not call it complete until the verifier checks the plan's §3 acceptance criteria and the repository gate.
