# Store Admin Settings rebuild — Phase 3 builder prompt (branding, storefront, domains)

You are the assigned builder for **Phase 3 only** of the Store Admin Settings rebuild in the `bsec` monorepo. Do not start Phase 4 or later. Scope and acceptance criteria: `docs/SETTINGS-REBUILD-REMAINING-PHASES.md` §4 and the cross-phase checklist in §10. Product direction and target schema: `docs/SETTINGS-REBUILD-PLAN.md`, `docs/SETTINGS-SCHEMA.md`. Where this prompt and the plan disagree, stop and ask the owner.

## 0. Repo state and lessons you must apply (read first)

Phases 0-1 (PR #25) and 2 (PR #29) are merged. You build on them: grouped nav in `apps/admin/src/components/settings/settings-nav.ts`, `settingsOverview.get`, `/settings/store-details`, `/settings/users`, `/settings/activity`, and the capability families of ADR-020 (`docs/adr/020-settings-capability-families.md`, including its "Enforcement status" section).

Branch from the latest `origin/main`. If `integrate/theme-builder` (PR #30, theme builder, migrations 0031/0032) is not merged yet, the next free migration slot is **0033**; re-check `packages/db/migrations` and the journal when you build. The theme PR touches theme tables, pages, the block editor and storefront product/cart components: do not edit those files, and name any overlap in your change record.

Defects the verifier found in earlier phases. Do not repeat them:
1. **A permission string that nothing enforces is a lie.** Phase 2 defined `payments.manage` and an ADR said it protected credentials; no procedure checked it. For every family you use, check it in the **route middleware and the domain service**, add a real-database denial test, and move the nav item's `perm` to match.
2. **Run `pnpm typecheck` on the merged tree before saying done.** Phase 2 claimed a green typecheck that was red once `main` was merged.
3. **Grep `e2e/` for any UI label you rename.** Settings nav links have accessible names that include their description; Playwright specs must match by prefix (`/^Users/`), never `exact`. The staging e2e runs only on `main`, so a broken spec blocks the deploy.
4. **Parse any workflow or YAML you edit** with the `yaml` package from the pnpm store before pushing (an unquoted colon in a `name:` or `run:` value made a whole workflow invalid).
5. After changing a local ESLint rule, delete `node_modules/.cache/eslint`.
6. `pnpm test:heavy:local` (real Postgres 18 in Docker, about 4 minutes) now reports honest exit codes; on Windows a worker crash `3221226505` is a known flake: rerun that file alone and say so.

## 1. Objective

Make store identity, storefront availability and domain state coherent in Settings, without merging theme editing into general Settings and without exposing provider (Cloudflare) controls.

## 2. Scope

### Build
1. **Branding** (`/settings/branding`, retain and upgrade): light/dark logo, favicon, app icon, social image, primary/secondary/accent colours, approved typography. Media goes through the existing tenant-safe media records and checks (replace and delete safely). Document, in the change record and ARCHITECTURE, which setting is owned by Branding and which by the theme (`brand_settings` vs theme tokens; today a store's brand colours win over theme tokens, see `progress.md` known gaps). One owner per visual setting; no competing editor. No arbitrary fonts, raw CSS or custom code (AGENTS rule 8).
2. **Storefront** (`/settings/storefront`, retain): `live`, `coming_soon`, `password`, and `maintenance` only if the lifecycle and server rendering already honour it. State plainly whether a change is saved or immediately live. Preserve hashed password and bypass-token behaviour; a stored value is never returned to the browser. Scheduling is Phase 8, not yours.
3. **Domains** (`/settings/domains`, new): a safe merchant projection of the existing domain lifecycle (ADR-017): platform subdomain, custom hostname, status, DNS instructions, verification progress or failure, primary-domain selection, removal request. A domain cannot be made primary until `active`. Provider API token, zone id and hostname id never leave the server. The UI must not be able to fabricate an `active` or verified state.
4. Move these procedures to their families (`branding.manage`, `storefront.manage`, `domains.manage`) in route and service; keep `settings.write` satisfying them through the existing aggregate. Each mutation writes an `audit_logs` row (before/after, no secrets) and invalidates tenant-prefixed cache tags **after commit**.

### Do not build
Anything from Phases 4-8; Razorpay, Shiprocket or email-provider work; Cloudflare configuration; maintenance scheduling; theme editing or theme page types (owned by the theme PR).

## 3. Read before writing code
`AGENTS.md` (§2, §4, §6); `docs/ARCHITECTURE.md`; the newest records in `docs/changes/` (especially the Phase 0-1, Phase 2 and Phase 2 verification records); `progress.md` "In flight" (add your claim); `docs/adr/017-*` (domains) and `docs/adr/020-settings-capability-families.md`; `docs/admin-ui-standards.md`; `docs/migrations.md` if you add a migration (expand-only, `tenantTable()` and `forceRlsSql` for tenant tables).

## 4. Collaboration protocol
Own worktree; stage exact files only (never `git add -A` or a directory); focused commits with your agent trailer; local gate green before pushing; open a PR; **never merge your own PR**: Claude verifies against the acceptance criteria first. Update `docs/ARCHITECTURE.md` (procedures, routes, permissions) and leave `docs/changes/YYYY-MM-DD-<agent>-settings-rebuild-phase-3.md`.

## 5. Acceptance criteria (from the plan, plus the lessons above)
- [ ] Brand asset mutation is authorized, audited, tenant-isolated and uses the existing media safety checks.
- [ ] Branding vs theme: one documented owner for every visual setting.
- [ ] Storefront status matches server behaviour; password and bypass values never leak.
- [ ] Domains UI reflects the real state machine and cannot manufacture an active or verified status; provider identifiers never reach the client.
- [ ] Every migrated procedure is denied for a role lacking its family (real-DB test, route and service), allowed for one holding it, refused cross-tenant; support sessions get none of it.
- [ ] Desktop, tablet, 375 px, light and dark browser paths pass (state exactly what you drove).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, impacted fast suites and `@bs/domain` heavy pass; the isolation suite maps every new procedure.

## 6. Hand-off format
Branch and commits; behaviour changed; every command with real counts; browser walkthrough and what was not tested; owner questions; change record path.
