# Move the platform domain from gobs.cloud to bcom.si

- **Date:** 2026-10-02
- **Agent:** claude
- **Branch:** `chore/domain-bcom-si` (not merged yet)
- **Area:** db, domain, auth, web, superadmin, platform, infra, docs
- **Type:** refactor
- **Supersedes:** none

## Summary
Hard cutover of the platform domain to `bcom.si`; nothing was live on `gobs.cloud`. Every code default, UI string, test and doc that named the old domain now names the new one. A new migration rewrites stored hostnames and the default sender.

## What changed
- All `gobs.cloud` occurrences replaced with `bcom.si` (code defaults for `PLATFORM_DOMAIN`, auth/CORS fallbacks, Super Admin and marketing UI, email sender defaults, tests, docs, uptime config, runbooks).
- Migration `0019_domain_bcom_si`: rewrites `domains.hostname` for platform subdomains and sets the `platform_email_settings.from_email` default and rows. `0017` is untouched (append-only).
- `DEPLOYMENT.md` / `infra/coolify/RUNBOOK.md` now describe the `bcom.si` hostnames.

## Decisions and trade-offs
- Hard cutover, no redirect from the old domain (owner decision 2026-10-02).
- Custom domains cannot end in the platform domain (`domains/service.ts`), so the suffix match in 0019 only touches platform subdomains.

## Verification
- Ran: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check` pass.
- Ran: `test:fast` for `@bs/domain` (205), `@bs/web` (157), `@bs/auth` (4) pass.
- Ran with `TESTCONTAINERS_REUSE_ENABLE=false` (real Postgres): `@bs/domain test:heavy` 877 pass, `@bs/web test:heavy` 1 pass, `@bs/db test:heavy` 14 pass, `@bs/platform` suite (`--no-file-parallelism`) 76 pass. Migrations through 0019 apply cleanly.
- Exercised by hand: Coolify (bsec-web labels, domains on admin/platform/superadmin, env vars on platform and web) edited in the production panel, not redeployed; Cloudflare DNS resolves for all hosts (HTTPS answers 503 until redeploy).
- NOT verified: the 0019 data rewrite against rows that actually contain old hostnames (test DBs have none); behaviour on the live `bcom.si` hosts, which needs the deploy.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (migration list)
- [x] ADR not needed: no architectural change
- [x] `DEPLOYMENT.md` / RUNBOOK
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Owner must do the infra side: Cloudflare zone + DNS, Coolify domains and env vars, R2 `media.bcom.si`, ZeptoMail domain verification (checklist in the session reply).
- `domain/src/admin/orders.ts` builds the draft-order pay link from `ctx.tenantId`, not the slug; looks like an existing bug, left unchanged.
- Old ADRs/plans were mass-replaced; they describe history with the new name.

## Definition of done
Gate passes (see Verification). Infra-side steps remain with the owner after deploy.
