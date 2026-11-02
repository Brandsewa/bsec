# Worker needs the R2 storage variables (corrects the earlier diagnosis)

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `fix/worker-r2-env` (not merged yet)
- **Area:** docs, domain (catalog bulk-io)
- **Type:** fix
- **Supersedes:** `2026-11-02-claude-import-image-storage-key.md` (its diagnosis was wrong; its code changes stay)

## Summary
Product import images kept failing in production with "Image storage is not set up yet" after the worker got `TENANT_SECRETS_KEY`. Production storage is configured through the `R2_*` environment variables on the web service, not through a saved connection, and the worker section of `DEPLOYMENT.md` did not list them. The worker therefore had no storage at all. The earlier record blamed an undecryptable saved connection; that was an inference from the error text and was wrong for this deployment.

## What changed
- `DEPLOYMENT.md`: the worker lists `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` (same values as web).
- `packages/domain/src/catalog/bulk-io/import-images.ts`: the "storage not set up" problem line now adds that the worker needs the same R2 settings as web.

## Decisions and trade-offs
- The production fix is configuration: set those five variables on `bsec-worker` in Coolify (copy from `bsec-web`) and redeploy the worker. Not done here (Coolify is the owner's).

## Verification
- Ran: domain typecheck, eslint on the touched file, `pnpm docs:check`.
- NOT verified: production. Confirmed from the code that `R2_*` env is the fallback used when no active saved connection exists (`getEnvironmentStorageConfig`).

## Docs updated
- [x] `DEPLOYMENT.md`
- [ ] ADR / ARCHITECTURE / progress: not needed

## Follow-ups and open questions
- After the worker has the variables, re-run the import; images are matched by content so nothing is duplicated.

## Definition of done
Gate run before push; no secrets in the diff.
