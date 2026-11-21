# Consent IP hash refuses to run in production without a key

- **Date:** 2026-11-20
- **Agent:** claude
- **Branch:** `fix/security-audit-followups` (merged in #298, 2ce72397)
- **Area:** domain
- **Type:** fix
- **Supersedes:** none

## Summary
`hashConsentIp` fell back to a fixed salt when `TENANT_SECRETS_KEY` was unset, so the stored IP hashes could be brute-forced offline (IPv4 is small). In production it now throws instead (audit finding SEC-006). Outside production the dev fallback stays so local runs and tests work.

## What changed
- `packages/domain/src/customers/consent.ts`: key is `secretKey`, then `TENANT_SECRETS_KEY`, then `ENCRYPTION_KEY`; no key and `NODE_ENV=production` throws `TENANT_SECRETS_KEY is required to record consent in production`.
- `packages/domain/test/settings-phase-7.unit.test.ts`: three tests (throws in production, works with key, still works outside production).

## Decisions and trade-offs
- **Deploy precondition:** `setMarketingConsent` calls this on every consent write with an IP, including checkout marketing consent. If `TENANT_SECRETS_KEY` is not set on `bsec-web` in Coolify, consent writes will fail after this deploys. The RUNBOOK lists it as required for web; confirm in Coolify before merging.
- The hash construction (SHA-256 over `consent-ip:tenant:key:ip`) is unchanged on purpose, so existing stored hashes still match. A move to HMAC with a dedicated key is a possible later step.

## Verification
- `pnpm --filter @bs/domain exec vitest run test/settings-phase-7.unit.test.ts`: 15 pass. Gate ran on push.
- NOT run: real-database consent tests beyond the pre-push gate; production env check.

## Docs updated
- [x] ARCHITECTURE: not needed. DEPLOYMENT: not needed (`TENANT_SECRETS_KEY` already documented as required). progress.md: in-flight line added below.

## Follow-ups and open questions
- Turnstile on checkout (audit A3-04), production value of `TRUST_CLOUDFLARE` (A2-05), git-history scan result (see PR description).

## Definition of done
Gate passed on push; no secrets or generated files in the diff.
