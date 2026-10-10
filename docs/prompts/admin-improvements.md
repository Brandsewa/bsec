# Prompt for Antigravity: Super Admin and Store Admin improvements

You are building one phase of `docs/ADMIN-IMPROVEMENTS-PLAN.md`. Claude verifies your work against its acceptance criteria before the next phase starts, so "done" from you means "ready to verify".

Phase to build: **PHASE_NUMBER** (set by the owner when handing this over; phases are in section 2 of the plan, in dependency order: 1 Storage + upload fix, 2 Orders archive/delete + Returns page, 3 Quota tiers, 4 Integrations hub, 5 Themes + Pages, 6 Navigation + filters).

Before writing code:
1. Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/admin-ui-standards.md`, the latest files in `docs/changes/`, and the plan sections for your phase plus section 9 (cross-cutting rules).
2. `git fetch`, check `docs/changes/` and `git log origin/main..` for overlap, create your own worktree and branch (`feat/admin-improvements-phase-N`), and add one line to "In flight" in `progress.md`.
3. Next.js and Turborepo here are newer than your training data: read `node_modules/next/dist/docs/` before writing Next code.

While building:
- Contract first (`packages/contracts`), then handler, domain service, UI. New `admin.*` procedures go into the isolation suite mapping.
- Hard rules in `AGENTS.md` section 2 are not negotiable. If one blocks you, record it under "Open questions" in your change record and ask; do not work around it.
- Migrations are expand-only here (new tables, nullable columns). Next free number is 0049 (check `packages/db/migrations`).
- Payments work is in scope only as described in plan section 6.4 (Razorpay and Stripe, test mode, no live keys); do not touch Shiprocket or any shipping code. Test only on local data; never drive the live store.
- Stage files by explicit path. Never `git add -A`. Do not commit `routeTree.gen.ts`, `.env*`, test reports.
- Where the plan gives an owner-decision default (section 11), build the default and record it.

Before you say done:
- Run the gate (`AGENTS.md` section 4), one package at a time, and paste real counts in the change record.
- Walk every changed screen at 375 px and desktop; say plainly what you could not run.
- Write the change record `docs/changes/YYYY-MM-DD-antigravity-<slug>.md` (template: `docs/changes/TEMPLATE.md`) with the plan's acceptance criteria copied in and ticked with evidence, plus the section 7 definition-of-done checklist from `AGENTS.md`.
- Update `ARCHITECTURE.md`, ADRs, `DEPLOYMENT.md`, `.env.example` as the phase's acceptance criteria require. Do not merge your own PR.
