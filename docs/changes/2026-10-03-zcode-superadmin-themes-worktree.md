# Super admin Themes: dedicated worktree and local stack for theme customisation

- **Date:** 2026-10-03
- **Agent:** zcode
- **Branch:** `feat/superadmin-themes` (not merged yet; worktree `C:\dev\bsec-themes`)
- **Area:** superadmin, platform, docs
- **Type:** infra | docs
- **Supersedes:** none

## Summary
Set up an isolated worktree (`C:\dev\bsec-themes`, branch `feat/superadmin-themes` off `origin/main` b804d02) for theme customisation work on the super admin Themes section, kept separate from the other agents' branches. The local super admin runs from this worktree against the shared `bsectest` Postgres (15432), with a worktree-local platform API and a seeded platform staff login. No product code changed yet — this lands the claim and the environment hand-off.

## What changed
- New git worktree `C:\dev\bsec-themes` on branch `feat/superadmin-themes` (tracks `origin/main`).
- `progress.md`: In-flight claim for zcode / `feat/superadmin-themes` (superadmin themes).
- Running services (this session's background processes, ports chosen to avoid the `bsectest` stack):
  - Platform API: `cd /c/dev/bsec-themes` → `DATABASE_URL_PLATFORM='postgres://app_platform:platform_dev@localhost:15432/bsec' PORT=14010 APP_ENV=local BETTER_AUTH_SECRET=<local-only secret> PLATFORM_AUTH_URL='http://localhost:14010' SUPERADMIN_ORIGINS='http://localhost:5176' pnpm --filter @bs/platform dev`
  - Super admin SPA: `VITE_PLATFORM_API_URL='http://localhost:14010' pnpm --filter @bs/superadmin exec vite --port 5176 --strictPort` → http://localhost:5176
- Seeded platform staff: `superadmin@demo.local` / `themes-admin-2026` (role `platform_owner`), created via `apps/platform/src/create-staff.ts` with `STAFF_PASSWORD` (no TTY). **MFA was reset at hand-off on purpose**: first sign-in walks the authenticator enrolment (enter password → scan/enter secret → verify code), so anyone can claim it with the password above. Local-only credentials, never for production.
- The themes surface being customised (scan result, unchanged): `apps/superadmin/src/pages/Templates.tsx` + `TemplateEditor.tsx`, shared panel `packages/block-editor/src/ThemeSettings.tsx`, token shape in `packages/blocks/src/theme-vars.ts` (`colors`/`fonts`/`radius`/`buttons`), domain services in `packages/domain/src/themes/`, platform procedures `templates.*` in `apps/platform/src/app.ts` (contracts `packages/contracts/src/platform.ts`).

## Decisions and trade-offs
- Ran the platform from the worktree (port 14010) instead of reusing the `bsectest` platform container (14000): branch changes to platform/domain code are picked up by `tsx watch` immediately, and the super admin session is separate from the 18080 stack. Same DB, so seeded themes/demo data are shared.
- Shares the `bsectest` Postgres instead of a new database: no new seed needed, migrations are append-only and identical on `origin/main`.
- MFA reset at hand-off trades "I verified with MFA enrolled" for "the owner can sign in and enrol their own authenticator" — deliberate.

## Verification
- Ran: platform `tsx` boots and listens on 14010 from the worktree; `/api/platform/me` answers.
- Exercised by hand (browser, in-app browser pane): login page renders; sign-in POST (`/api/auth/sign-in/email`) returns 200 with the seeded credentials; MFA enrolment end-to-end (enable → TOTP verify → complete → re-sign-in with TOTP) succeeds; `/api/platform/me` returns `authenticated: true, role: platform_owner, mfaComplete: true, sessionValid: true`; the Themes page fully renders with the 4 seeded themes (starter-minimal, fashion-editorial, gourmet-artisan, essential-commerce v2 — all Published); `GET /platform/templates/essential-commerce` returns the full editor payload (draft pages home/collection/product/header/footer, token shape colors/fonts/radius/buttons, 9 home blocks).
- NOT verified: the TemplateEditor screen pixels — the browser pane was hidden at that point and Chromium suspends rAF/React painting in hidden panes (`document.hidden === true`, blank root, no JS errors), so I could not screenshot the editor UI. The editor's module graph transforms cleanly (all routes 200 from Vite) and its data endpoint returns the exact draft payload it consumes; opening http://localhost:5176 in a visible window is expected to work. Gate commands (typecheck/lint/tests) not run: no product code changed in this commit.

## Docs updated
- [x] `progress.md` (In-flight claim)
- [ ] `docs/ARCHITECTURE.md` — not needed (no product/architecture change)
- [ ] ADR — not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed (local-only stack)

## Follow-ups and open questions
- The actual theme settings customisation happens next on this branch; each change set gets its own change record + gate runs.
- If services die with this session, restart with the two commands under "What changed" (from `/c/dev/bsec-themes`).
- Local-only secret: the platform `BETTER_AUTH_SECRET` for this worktree differs from the `bsectest` stack on purpose — sessions don't cross over.

## Definition of done
Gate commands not required for this commit (docs + claim only; no code changed). No secrets committed: the auth secret and passwords in this record are local-only dev credentials, matching existing practice (`owner_dev` etc. already committed as local defaults).
