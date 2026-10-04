# Fresh all-Docker local stack (project `bsecvmm`) for the Docker VMM test

- **Date:** 2026-10-04
- **Agent:** zcode
- **Branch:** `test/vmm-local-stack` (not for merge; worktree `C:\dev\bsec-vmm`)
- **Area:** infra, docs
- **Type:** infra | docs
- **Supersedes:** the old `bsectest` compose stack (removed: containers were already gone after the Docker restart, `bsectest_pgdata` volume deleted, host-side tsx/vite processes killed)

## Summary
The owner switched Docker Desktop to the new VMM backend. The old `bsectest` local stack was removed and a completely fresh, fully containerised stack was built in a new worktree/branch (`C:\dev\bsec-vmm`, `test/vmm-local-stack`). Goal: test VMM build/run behaviour and re-check the super admin white-screen issue in a clean environment. Both goals met: the stack builds and runs on VMM (after one memory finding), and the super admin — including the Themes list and the full theme editor — renders correctly with no white screen.

## What changed
- New worktree `C:\dev\bsec-vmm` on branch `test/vmm-local-stack` (from `origin/main` b804d02). `progress.md` In-flight claim.
- **Compose override (outside the repo, never committed): `C:\dev\bsec-vmm-test\docker-compose.override.yml`** — shifted ports with `!override` tags (web 13010, platform 14020, worker 14120, admin 18090, superadmin 18095, postgres 15442), web/platform auth secrets, `ADMIN_ORIGINS=http://localhost:18090`, `SUPERADMIN_ORIGINS=http://localhost:18095`, admin build arg `VITE_API_URL=http://localhost:13010`, and a **new `superadmin` compose service** (the repo compose has none — CI builds it) built from `infra/docker/superadmin.Dockerfile` with `VITE_PLATFORM_API_URL=http://localhost:14020`.
  - Compose v2 **appends** override `ports:` lists instead of replacing them — without the `!override` YAML tag the base ports (3000/4000/4100/8080/5432) are published too, and postgres fails on the Windows-reserved 5432 ("access forbidden" bind error).
- **Local-only uncommitted Dockerfile tweaks** (same additive pattern as the previous stack; empty args in CI → behaviour unchanged):
  - `infra/docker/admin.Dockerfile`: `ARG VITE_API_URL` + `ENV` in the build stage.
  - `infra/docker/superadmin.Dockerfile`: `ARG VITE_PLATFORM_API_URL` + `ENV` in the build stage.
- Run command:
  `docker compose -p bsecvmm -f C:/dev/bsec-vmm/docker-compose.yml -f C:/dev/bsec-vmm-test/docker-compose.override.yml up -d --build`
- Bootstrap on the fresh DB (worked exactly in this order):
  1. `migrate` service (roles + migrations) runs automatically.
  2. Platform staff: `docker compose -p bsecvmm exec -T platform sh -c 'STAFF_EMAIL=superadmin@demo.local STAFF_NAME="Theme Admin" STAFF_ROLE=platform_owner STAFF_PASSWORD=themes-admin-2026 node dist/create-staff.js'`
  3. Bare demo rows via psql (organisations + tenants, slug `demo-store`) — `create-owner` still needs the tenant row.
  4. `worker` container: `OWNER_EMAIL=owner@demo.local OWNER_NAME="Demo Owner" STORE_SLUG=demo-store OWNER_PASSWORD=demo-owner-2026 node dist/create-owner.js`
  5. `platform` container: `OWNER_EMAIL=owner@demo.local node dist/demo.js seed` (seed now creates the org/tenant itself if missing and grants ownership — only the owner login must exist first).
- Credentials (local only): super admin `superadmin@demo.local` / `themes-admin-2026` (MFA enrolled; secret `ONUUCRTOIE4WM4TQJZJDQRRUMFZXOU3IO44FAZCGJZPWM2COIZZQ`, backup codes shown in the enrolment screen during verification, 10 single-use codes); store owner `owner@demo.local` / `demo-owner-2026`.

## VMM findings (the actual test)
- First `up -d --build` on the VMM VM **OOMed**: `ResourceExhausted: cannot allocate memory` during web's `pnpm install` — the VM then had ~3.9 GB and compose built all images in parallel. After Docker Desktop restarted with ~7.8 GB, the full build passed. **Keep the VMM VM at ≥ 8 GB for this repo's image builds.**
- Warm-build timing (pnpm store cache mount already seeded): full stack built and healthy in **2m51s**; cold-cache downloads were network-bound (~27–44 KiB/s npm warnings), not VMM-bound.
- All 7 services reach `healthy`: postgres, web, platform, worker, admin, superadmin (migrate is a one-shot). Endpoint smoke test: 200 in 0.2–0.7 s each.

## Verification
- Ran: `docker compose -p bsecvmm ps` — all services healthy; HTTP smoke of all six endpoints 200.
- Exercised by hand (browser, in-app pane, all through the UI): super admin sign-in → MFA enrolment screen → generate secret → verify TOTP → re-sign-in with code → Overview renders with live metrics → **Themes page renders all 4 seeded themes** → **theme editor renders completely** (Theme settings panel with colours/fonts/corners/buttons + live preview of the whole Essential Commerce home page). Store admin sign-in page renders at 18090; storefront renders at 13010 (fresh demo store shows its intended "Opening Soon" state until a theme is activated).
- NOT verified: worker queue processing under load; web checkout flows; those are owner-driven checks.

## White-screen verdict
**Gone on this stack.** The same surfaces that blanked yesterday (Themes list, theme editor) render fully in the same browser pane today against the all-Docker stack. Yesterday's blank pane was diagnosed as the desktop webview discarding DOM commits (components ran, zero errors, no DOM landed) plus a stale Vite dev server serving dead-watcher transforms; neither applies to this containerised setup, which serves production SPA builds from nginx.

## Docs updated
- [x] `progress.md` (In-flight claim)
- [ ] `docs/ARCHITECTURE.md` — not needed (no product change)
- [ ] ADR — not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK — not needed (local-only stack; run command in this record)

## Follow-ups and open questions
- Keep this branch/worktree as THE local stack home while the owner evaluates VMM; if VMM is kept, consider committing the additive SPA build args (CI-safe, empty by default) so the override file alone reproduces the stack.
- The themes customisation work continues on `feat/superadmin-themes` (worktree `C:\dev\bsec-themes`); it can reuse this DB by pointing the superadmin SPA's `VITE_PLATFORM_API_URL` at http://localhost:14020.
- Watch VMM memory if more agents build images concurrently (the OOM was parallel builds × pnpm install).

## Definition of done
Docs-only commit plus one in-flight claim; no product code changed. Dockerfile tweaks deliberately uncommitted and documented above. No secrets beyond local-only dev credentials, matching existing practice.
