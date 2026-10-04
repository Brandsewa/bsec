# Store Admin Settings rebuild — Phase 3 builder prompt (branding, storefront, domains)

Paste this whole file as the first message of a new coding session in the `bsec` repo. You are the **builder for Phase 3 only**. Do not start Phase 4 or later. A different agent (Claude) verifies your work against the acceptance criteria in section 8 before the next phase starts; you never merge your own PR.

Authoritative references (read, in this order, before writing code): `AGENTS.md` (§2 hard rules, §4 gate, §5 git, §6 protocol); `docs/ARCHITECTURE.md`; the newest records in `docs/changes/` (especially `2026-10-04-zcode-settings-rebuild-phase-0-1.md`, `2026-10-04-antigravity-settings-rebuild-phase-2.md`, `2026-10-04-claude-settings-phase-2-verification.md`); `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §4 and §10; `docs/SETTINGS-SCHEMA.md`; `docs/adr/017-custom-domain-provider-adapter.md`; `docs/adr/020-settings-capability-families.md` (including its "Enforcement status" section); `docs/admin-ui-standards.md`; `docs/migrations.md` if you add a migration. If this prompt and the plan disagree, stop and ask the owner. If a decision is the owner's (see §9), ask; do not guess.

## 1. Where the repo is (verified 2026-10-04)

Merged to `main`: Settings Phases 0-1 (grouped nav, `/settings` Overview, `/settings/store-details`) and Phase 2 (ADR-020 capability families, `/settings/users`, `/settings/activity`). Customers Phase 1, Segments and dev-speed tooling are merged too. **PR #30 (theme builder, migrations 0031 and 0032) is open and may or may not be merged when you start.** It touches theme tables, theme pages, the block editor, the Super Admin theme editor and the storefront product, collection and cart components. You must not edit those files. If it is not merged, your first free migration number is **0033**; re-check `packages/db/migrations` and `meta/_journal.json` at build time and pick the next free number.

Branch from the latest `origin/main`. Create your own worktree (`git worktree add ../bsec-settings-p3 -b feat/settings-rebuild-phase-3 origin/main`), run `pnpm install --frozen-lockfile`, and add one line to `progress.md` "In flight" before coding. Never work in another agent's checkout or on another agent's branch.

## 2. What the code does today (audit done for you; re-verify before relying on it)

| Area | Files | Today |
|---|---|---|
| Branding | `packages/domain/src/brand-services.ts` (`getBrandSettings`, `updateBrandSettings`, `publishBrandSettings`), `packages/db/src/schema/branding.ts` (`brand_settings`, composite media FKs), `apps/admin/src/routes/_store/settings/branding.tsx` (540 lines), contract `admin.branding.{get,update,publish}`, handlers in `apps/web/src/server/api.ts` (about line 970) | Colours (primary, secondary, accent, background, surface, text), logos (light and dark), logo width, favicon, social image, fonts (heading, body, scale), colour mode, corner radius, button style, preset, draft and publish with a `version`. Gated `settings.write` in route **and** service. **No audit row.** No app icon. Media ids are accepted as ids only: the composite FK keeps them in the same tenant, but nothing checks the media is an image of an acceptable type and size for its slot. |
| Storefront status | `packages/domain/src/storefront/lifecycle.ts` (`getStoreStatus`, `updateStoreStatus`, `verifyStorePassword`, `hashBypassToken`, `evaluateStorefrontAccess`), `apps/admin/src/routes/_store/settings/storefront.tsx` (150 lines), contract `admin.storefront.{getStatus,updateStatus}` | Modes `live`, `coming_soon`, `password`, `maintenance`; headline, message, countdown, email collection, launch time, password, preview bypass token. Gated `settings.write` in route and service. |
| Domains | `packages/domain/src/domains/service.ts` (`listTenantDomains`, `addCustomDomain`, `verifyCustomDomain`, `setPrimaryDomain`, `removeCustomDomain`), `packages/domain/src/domains/provider.ts` (Cloudflare adapter, honest `unverified_needs_credentials` without keys), polling worker in `packages/domain/src/jobs.ts`, contract `admin.domains.{list,add,verify,setPrimary,remove}`, handlers about line 1745 of `api.ts` | **Backend exists; there is no admin page.** |

### Defects already found in that code (you must fix these; each needs a failing test first)
1. **Storefront status changes never invalidate the cache.** In `updateStoreStatus`, `return withTenant(...)` returns before the `await invalidateCache(rt, ctx, { type: "store_or_seo_updated" })` line, which is unreachable. Fix by awaiting `withTenant`, **then** invalidating (commit before invalidate, AGENTS rule 5; the lint rule `bs/no-service-call-in-tx` guards the pattern). Prove it with a test that the invalidation call happens after a successful update.
2. **The store password and the preview bypass token can be replayed from their stored hash.** `verifyStorePassword` and `verifyBypassToken` both return true when `plain === hash`; anyone who can read the stored value (a backup, a database read, an audit export) can type it as the password. They also use unsalted SHA-256 for a human-chosen password. Replace with a salted, slow, constant-time scheme (reuse the argon2id helper already used for customer passwords in `packages/domain/src/customers/auth.ts`, or `scrypt` from `node:crypto` if argon2 is unsuitable on the storefront path), with a self-describing prefix so verification can tell the formats apart. Keep verifying the old 64-hex SHA-256 format **without the `plain === hash` shortcut**, and re-hash to the new format on the first successful verification (lazy migration, no data migration, no downtime). The bypass token is a high-entropy random value, so SHA-256 is acceptable for it: keep it, remove the plain-equality shortcut, and make it a constant-time compare. Owner action (do not run against production yourself): the owner confirms no production row holds a plaintext value with `select count(*) from store_status where password_hash is not null and password_hash !~ '^[0-9a-f]{64}$';`. If it is not zero, stop and ask.
3. **Domains have no permission check in the service, no audit trail, and `domains.list` has no permission at all** (any store admin session can list). The service functions take only a `tenantId`, so AGENTS rule 4 (check in the domain service) cannot hold. Change the service entry points used by the admin API to take a `TenantContext`, call `assertPermission(ctx, "domains.manage")` (list may use `settings.read`: see §4), write `audit_logs` rows (`domain.add`, `domain.verify`, `domain.set_primary`, `domain.remove`; no provider ids or tokens in the diff), and keep the background poller on an internal, context-free variant. The platform-subdomain row must not be removable or changeable by the merchant: test it.
4. **Branding updates write no audit row** (AGENTS rule 6: store mutations that change settings or content write `audit_logs`). Add rows for update and publish with a before/after diff of the changed fields (ids and values, no secrets).

## 3. Scope

### 3.1 Branding (`/settings/branding`: retain and upgrade; do not add a competing editor)
- Add the missing **app icon** slot (`app_icon_media_id`, expand-only migration, composite tenant FK like its siblings, nullable) if and only if a consumer exists: the storefront must emit it (apple-touch-icon / manifest icon). If you cannot give it a consumer in this phase, leave it out and say so (SETTINGS-SCHEMA §1 rule 5: no setting without an enforced behaviour).
- Server-side media validation per slot in `updateBrandSettings`: the media row must exist for the tenant (the FK already stops cross-tenant), be an image, within slot limits (favicon: png, ico, svg, up to 512 KB, square; app icon: png, square, at least 180 px; logos and social image: png, jpg, webp, svg, social image 1200x630 recommended, up to 5 MB). Reject unsafe SVG (scripts, external references) using the sanitiser the media pipeline already has, or refuse SVG for the slot if none exists. Replacing or clearing a slot never deletes the media row if another slot or product still references it.
- Colour inputs validated as `#rrggbb` in the contract; fonts only from the approved list the page already uses; no free-text CSS, no arbitrary font URLs (ADR-010).
- **Ownership document (required deliverable):** one table in the change record and in `docs/ARCHITECTURE.md` stating, for every visual setting, whether **Branding** (`brand_settings`) or the **theme** owns it, and the precedence today (a store's brand colours win over theme tokens once the store opts in, per `progress.md` known gaps). Branding owns the reusable defaults (logos, favicon, social image, brand colours, fonts); theme pages own layout and theme-specific overrides. Do not change precedence without the owner; if the table reveals two editors for one value, report it as an open question.
- Make the existing draft vs published behaviour explicit in the UI: the page must say whether "Save" makes a change live or only a draft, and show the published version number and time. Keep `Save draft` and `Publish` semantics as they are in the service.
- Permission: update and publish move to `branding.manage`; get to `settings.read`. Route middleware **and** service check; nav item `perm` updated.

### 3.2 Storefront (`/settings/storefront`: retain)
- Fix defects 1 and 2 above.
- UI states plainly: "Saved. Live to shoppers within a minute" (use the real cache behaviour you verify, do not invent a number), the current mode with an explanation of what shoppers see in each mode, and a warning when switching a **live** store away from `live`.
- A stored password or bypass token is never returned to the browser; `hasPassword` stays a boolean; the bypass token is shown once at creation (generate it server-side, return it once, never again) or the field is write-only. State which in the change record.
- `maintenance` mode: expose it only if the server already renders a 503 with `Retry-After` for it (check `evaluateStorefrontAccess`); otherwise show it as unavailable with a reason. Scheduling is Phase 8: do not build it.
- Permission: `getStatus` to `settings.read`, `updateStatus` to `storefront.manage`. Write an `audit_logs` row for every mode, headline, message, launch time and password/token change (password and token logged as "changed", never the value or hash).

### 3.3 Domains (`/settings/domains`: new page over the existing backend)
- Route file `apps/admin/src/routes/_store/settings/domains.tsx` with `pendingComponent`, nav item in the **Store** group of `settings-nav.ts` (permission `domains.manage`), registered in `docs/ARCHITECTURE.md`.
- Content: the platform subdomain (read-only), the custom domain list with `hostname`, status (use the ADR-017 state machine labels: requested, awaiting DNS, verifying, SSL pending, active, failed, removing), SSL status, **DNS instructions built from the row's `verification` data** (CNAME target, or the TXT name and value for the pre-validate path) with copy buttons, and a clear failure reason (for example the 48-hour DNS timeout). Actions: **Add domain** (input normalised and validated by the server's `normalizeCustomHostname`, plus the `prevalidateTxt` option), **Check now** (verify), **Make primary** (enabled only when `active`), **Remove** (`ConfirmDialog` that names the hostname and warns that traffic stops).
- **Honesty rule:** when the provider has no credentials, the API returns `unverified_needs_credentials`. The page must show that as "Domain connection is not enabled on this platform yet" and must **never** display `active`, "verified" or a green state that the server did not return. Never put provider identifiers (`cf_custom_hostname_id`, token, zone id) in a response, a query cache, the audit diff or a log. Add a contract-level test that the list/add/verify output schemas contain none of them.
- Respect quotas (`assertCustomDomainQuota` is already called on add) and the tenant lifecycle guard (`isDomainManagementAllowed`: a suspended or archived store cannot change domains): surface the server's message.
- Permissions as in defect 3. `list` requires `settings.read`; add, verify, set-primary, remove require `domains.manage`.
- Do not call Cloudflare in tests: use the provider interface with a fake adapter as the existing domain tests do.

### 3.4 Cross-cutting
- Every procedure you touch: route middleware **and** service check the family; `settings.write` still satisfies the families through the ADR-020 aggregate, so existing custom roles keep working; support sessions get none of them (do not add any family to the support sets in `context.ts`; extend its existing unit test if you add a new permission string).
- Update the **Enforcement status** section of ADR-020 to list exactly what is now enforced.
- Cache: invalidate after commit through `cache-invalidation.ts`; tags are tenant-prefixed (`tenantTag`). No second hand-rolled cache.
- Update `docs/ARCHITECTURE.md` (routes, procedures, permissions, migration table, "Last verified" commit) and the **Overview** read model if its "connect a domain" action should now link to `/settings/domains`.

## 4. Do not build
Phases 4-8 (checkout, accounts, payments, billing, shipping, taxes, notifications, policies, privacy, storage, maintenance scheduling); Cloudflare configuration or any real provider call; theme editing, theme pages or the block editor; owner transfer; new dependencies unless unavoidable (state why). Do not touch Razorpay or Shiprocket (AGENTS rule 14).

## 5. Lessons from earlier phases (violations of these were found by the verifier)
1. A permission string nothing enforces is a lie. For each family: route middleware, domain service, real-database denial test, nav `perm`. Phase 2 shipped `payments.manage` unenforced.
2. Run `pnpm typecheck` on the tree **after merging the latest `origin/main`**. Phase 2's "green" typecheck was red once merged.
3. Grep `e2e/` for any label you change. Settings nav link names include their description; Playwright specs must match by prefix, for example `/^Domains/`, never `exact`. The staging e2e runs only on `main`, so a miss blocks the deploy.
4. Parse any YAML you edit (the `yaml` package is in the pnpm store; an unquoted colon invalidated a whole workflow).
5. After changing a local ESLint rule, delete `node_modules/.cache/eslint`.
6. A service called with `rt` inside a transaction callback is a lint error; services that take `tx` are fine.
7. `pnpm test:heavy:local` runs the real-database suite against Docker Postgres 18 in about 4 minutes with honest exit codes. On Windows a worker crash with exit code `3221226505` is a known flake: rerun that file alone and say so; do not report it as a pass or a fail without that.
8. Stage files by explicit path. Never `git add -A`, `git add .` or a directory. Read `git status` for files you did not write before every commit.

## 6. Commit plan (one concern each; your own trailer from AGENTS.md §6)
1. `fix(storefront): invalidate cache after status update; replace replayable password and token checks` (defects 1 and 2, with failing tests first).
2. `feat(domains): permission, audit and tenant context in the domain service` (defect 3; contract tests; isolation-suite mapping; internal poller variant).
3. `feat(branding): validated media slots, audit rows, branding.manage` (defect 4 and §3.1; app icon only if it has a consumer).
4. `feat(storefront): settings status copy, storefront.manage, audit` (§3.2 UI and permissions).
5. `feat(settings): domains page` (§3.3 UI, nav, ARCHITECTURE).
6. `docs: ADR-020 enforcement status, branding vs theme ownership table, change record` (include the progress.md update).

## 7. Required tests
- **Unit:** password/token scheme (new format verify, legacy hex verify, `plain === hash` rejected, lazy re-hash, constant-time path); colour and media validators; domain status labels and DNS-instruction builder; honesty rule (provider-disabled maps to the "not enabled" state, never active).
- **Real Postgres (`*.int.test.ts`, `startTestDb`):** for every changed procedure an allowed role, a denied role (staff holding only `analytics.read`), and a cross-tenant refusal; status update invalidates the cache after commit and audits without secrets; branding update audits and rejects a foreign-tenant media id, a non-image, an oversize file and an unsafe SVG; domain service refuses without `domains.manage`, refuses removing the platform subdomain, refuses primary until `active`, writes audit rows with no provider ids; legacy-hash row verifies once and is re-hashed.
- **Isolation suite:** every new or changed `admin.*` procedure mapped in `packages/domain/test/isolation.int.test.ts` (the suite fails otherwise). Phase 2 had to adjust an expectation for an owner-only procedure; do likewise only where the ADR requires it and prove the denial.
- **Admin UI (router-context tests in `apps/admin/test/`):** domains page states (empty, awaiting DNS with instructions, active, failed, provider-disabled), primary disabled until active, remove confirm names the host; storefront page copy and the never-returned-secret behaviour; branding page draft/publish wording; nav grouping and permissions.
- **Contracts:** domains output schemas contain no provider identifiers; storefront output has `hasPassword` only.
- **e2e:** if a spec touches these routes, update it; do not add a new Playwright spec that needs provider credentials.

## 8. Acceptance criteria (the verifier checks each against the code and runs the gate)
- [ ] Defects 1-4 fixed, each with a test that failed before the fix.
- [ ] Brand asset mutation is authorized (`branding.manage`), audited, tenant-isolated, media-validated per slot.
- [ ] Branding vs theme: one documented owner per visual setting; the table exists in the change record and ARCHITECTURE; no second editor.
- [ ] Storefront status text matches server behaviour; password and bypass values and hashes never reach the browser; the cache is invalidated after commit.
- [ ] Domains page reflects the real state machine, cannot show a state the server did not return, never exposes provider identifiers, and cannot remove the platform subdomain.
- [ ] Every migrated procedure: denied without its family (route and service), allowed with it, refused cross-tenant, absent from support sessions; ADR-020 enforcement section updated.
- [ ] Browser check by you of the three pages at 375 px, tablet and desktop, light and dark, including the permission-denied view for a role without the families (say exactly what you drove and what you could not; do not claim a walkthrough you did not do).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check` pass on the merged tree; impacted fast suites pass; `@bs/domain` heavy suite passes (counts pasted); no secrets, generated files or unrelated edits in the diff.

## 9. Owner decisions
Already decided: delegation matrix per ADR-020 (`payments.manage` owner-only; other families held by Owner and Manager). **Ask the owner, do not decide:** whether branding may be edited by Manager-level roles (current matrix says yes); whether `maintenance` should be exposed before Phase 8; whether a merchant may remove a custom domain that is `active` and primary (default proposal: refuse until another domain is made primary); what the app icon should do if no storefront consumer exists in this phase.

## 10. Hand-off
Final message: branch and commit hashes; behaviour changed per area; every command run with real counts; the browser walkthrough and what was not tested; open owner questions; path to your change record `docs/changes/YYYY-MM-DD-<agent>-settings-rebuild-phase-3.md` (use `docs/changes/TEMPLATE.md`, copy the Definition of Done from `AGENTS.md` §7). Remove your `progress.md` claim only when the branch is complete and handed over.
