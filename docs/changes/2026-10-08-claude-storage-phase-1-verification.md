# Verification of Phase 1 (storage connections and upload fix): changes requested

- **Date:** 2026-10-08
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-1` at `21077a8`)
- **Area:** platform, domain, web, admin
- **Type:** test
- **Supersedes:** none

## Summary
Phase 1 is not accepted yet. The gate is green and most of the design matches the plan, but five items must be fixed before Phase 2 starts.

## Verification
- `pnpm typecheck`, `pnpm lint`, `pnpm docs:check` in the phase worktree: pass (turbo cache served 14 of 15 packages, so these confirm the committed state, not a cold run).
- Read: migration 0049, `media/connection.ts`, `platform/storage-connections.ts`, `media-services.ts`, the `/media/[...key]` route, `POST /admin/media/upload`, `upload-media.ts`, the change record.
- NOT run by me: the test suites listed in the builder's record (not re-executed), any browser walkthrough.

## Passed (read from code)
Migration is expand-only with grants limited to `app_rw` SELECT and `app_platform` ALL; one active connection per purpose via partial unique index; env fallback keeps `storage_connection_id = NULL`; delete refused while media references a connection; secrets encrypted and masked; platform mutations audited; permission checked on the upload route; local serve route sets `nosniff` and the sandbox CSP; path traversal tests exist.

## Must fix before acceptance
1. **Content check lets non-images through.** `uploadMediaDirect` only rejects when the sniffed type is non-null and differs. Bytes that are not a recognised image (for example HTML declared as `image/png`) sniff as null and are stored. Reject when no image signature is found; remove the dead `application/octet-stream` branch (that type is already refused by `validateMediaUpload`).
2. **Deleting media uses the wrong storage.** `deleteMediaRecord` deletes the object through the currently active driver and swallows errors, so after an activation switch it leaves the old object behind. Resolve the driver from the row's `storage_connection_id` (NULL = environment config), and log (not swallow) a failed object delete.
3. **Real-database tests are missing.** Plan 3.4 asks for `*.int.test.ts` coverage: one active per purpose; a media row still resolves through its original connection after another is activated; no procedure ever returns secrets; delete refused when referenced; `app_rw` cannot write the table. Only unit tests and grant/audit checks exist.
4. **Upload size is checked after the whole body is read.** `c.req.parseBody()` and the base64 JSON path buffer the full request before `validateMediaUpload`. Reject on `Content-Length` above `MAX_MEDIA_BYTES` plus a small overhead before parsing, and cap the JSON body.
5. **Local serve route only knows the active connection's directory.** Files written under an earlier local connection return 404 after a switch. Look the file up through the media row's connection (or document and test the single-directory limitation).

## Also required in the next record
- The reproduction evidence the plan asked for (what the original "Failed to fetch" really was) or an explicit statement that it was not reproduced.
- A real browser walkthrough with the local driver (upload a product image, see it in admin and storefront) at 375 px and desktop. Reading code is not a walkthrough.
- Run `pnpm --filter @bs/domain test:heavy` and paste the counts.

## Docs updated
- [ ] none needed for this record
