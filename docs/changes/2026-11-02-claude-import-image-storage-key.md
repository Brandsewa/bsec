# Product import images: say why storage is unreadable, harden the downloader

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `fix/import-image-download` (not merged yet)
- **Area:** domain (media, catalog bulk-io), docs
- **Type:** fix
- **Supersedes:** none

## Summary
After the product bulk import (#165) went live, every image failed with "Image storage is not set up yet" even though the images downloaded fine. Storage is set up; the worker cannot decrypt the saved storage keys, because decryption uses `TENANT_SECRETS_KEY` and the worker does not have the value the web service saved them with. The code reported this as "not set up", which hid the cause.

## What changed
- `packages/domain/src/media/connection.ts`: a connection whose keys cannot be decrypted is now reported as such ("cannot read its saved credentials. Set TENANT_SECRETS_KEY on this service to the same value as the web app"), not as missing storage. Real-database test in `storage-connections.int.test.ts`.
- `packages/domain/src/catalog/bulk-io/image-fetch.ts`: tries every resolved address (IPv4 first) so a server without IPv6 does not fail on hosts that list IPv6 first; failed downloads now name the network error code.
- `DEPLOYMENT.md`: the worker's `TENANT_SECRETS_KEY` must equal the web service's.

## Decisions and trade-offs
- The fix for production is configuration, not code: set `TENANT_SECRETS_KEY` on `bsec-worker` in Coolify to the same value as on `bsec-web`, then redeploy the worker. Not done by this change (Coolify is the owner's, AGENTS.md section 5). The value is never put in code or this record.
- Reproduced with the real downloader and real (local) storage: download, store and attach all work when the key is readable.

## Verification
- Ran: `image-fetch` unit tests (12), `storage-connections` real-database tests (7), domain typecheck, eslint on touched files.
- NOT verified: production. Whether the worker's key is the missing piece is inferred from the code path and the error text; the new message will confirm it on the next import.

## Docs updated
- [x] `DEPLOYMENT.md` (worker env)
- [ ] `docs/ARCHITECTURE.md`: not needed (no structure change)
- [ ] ADR: not needed
- [ ] `progress.md`: not needed

## Follow-ups and open questions
- Owner: set the worker's `TENANT_SECRETS_KEY` (same as web) and redeploy; then re-run the failed import (re-importing is safe, images are matched by content).

## Definition of done
Gate run before push; no secrets or generated files in the diff.
