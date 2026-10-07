# Pre-public scrub of personal and infrastructure details

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `chore/pre-public-scrub`
- **Area:** docs, infra, apps/platform
- **Type:** chore

## Summary
The owner decided to make the repository public while the project is in development, and to make it private again close to launch. Before flipping visibility, removed details that should not be public from the **current files**: the production VPS IP (runbooks, `progress.md`), the owner's personal email (`DEPLOYMENT.md`, `apps/platform/src/create-staff.ts`), and a local Windows path with a username (`docs/audit/M6-security-review.md`).

`apps/platform/src/create-staff.ts` no longer falls back to a hard-coded email: `STAFF_EMAIL` is now required (the documented command in `DEPLOYMENT.md` already passes it).

## Verification
- `pnpm docs:check` ok; `@bs/platform` typecheck clean. Full gate is the CI run on this PR.
- Repo audit before this change: no `.env` was ever committed (only `.env.example`); CI secret-scan passes on the full history.

## Known limits (not fixed here)
- Git history still contains the old IP, email and path; removing them needs a history rewrite/force-push, which the repo rules forbid. Treat the server IP as public: keep SSH key-only, firewall everything except 80/443, and consider Cloudflare in front.
- `server.brandsewa.com` and the Coolify resource UUIDs remain in `ci.yml` (identifiers, not secrets).
- No `LICENSE` file: by default all rights are reserved, but GitHub forking is still permitted. Add a licence deliberately before or after going public.
- Public repo implies: unset repo variable `CI_RUNNER` (jobs use free GitHub-hosted runners) and stop the self-hosted runner, so outside pull requests can never run code on the owner's PC.
