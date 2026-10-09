# Re-verification of Phase 1 (storage connections): accepted

- **Date:** 2026-10-08
- **Agent:** claude
- **Branch:** `docs/admin-improvements-plan` (verifies `feat/admin-improvements-phase-1` at `f8f695e`)
- **Area:** platform, domain, web
- **Type:** test
- **Supersedes:** none (follows `2026-10-08-claude-storage-phase-1-verification.md`)

## Summary
Accepted. All five requested fixes are in the code and covered by tests.

## Verification
- Read the fix diff: `media/connection.ts`, `media-services.ts`, `/media/[...key]/route.ts`, `POST /admin/media/upload`, the new `storage-connections.int.test.ts`.
- `node scripts/test-heavy-local.mjs` (whole `@bs/domain` heavy suite, shared local Postgres): 87 of 88 files, 1878 of 1882 tests passed; the one failing file exited with the Windows teardown crash documented in `docs/FAST-LOCAL-TESTS.md`.
- `vitest run test/storage-connections.int.test.ts test/inventory-reservations.int.test.ts` against the same database: 2 files, 9 of 9 tests passed (so the crashing file passes on its own).
- `storage-connection.test.ts` and `storage.test.ts`: pass (26 tests).

## Checked against the five items
1. Non-image content is rejected (no signature means refuse; mismatch refuses). Covered by an integration test.
2. Media delete resolves the driver from the row's `storage_connection_id` (null = environment) and logs failures instead of swallowing them.
3. Six real-database tests exist: encrypted and masked secrets, one active per purpose, media still resolves through its original connection, delete refused while referenced, `app_rw` read-only, upload spoofing rejected.
4. `Content-Length` is checked before the body is read (413), and the base64 path is length-capped.
5. The local media route resolves through the media row's connection, then falls back to the active connection, the environment directory, and other local connections, with traversal checks kept.

## Notes (not blockers)
- For environment-configured R2 the builder set `directBrowserUpload: true`, so the browser tries a direct PUT first and falls back to the server upload on failure. The plan's default was off. It works, but costs one failed request on a CORS-less bucket; consider flipping the default to off in a later change.
- Production code branches on `process.env.VITEST` (cache bypass in `resolveStorageConnection`). It works but should become an injectable cache/TTL in a later cleanup.
- The browser walkthrough covered layout at 375 px and desktop; the record does not show an actual image upload clicked through the product page. Do one manual upload on a local store before Phase 5 relies on the helper.
- Not re-run by me: typecheck, lint, build and the other packages' suites (the builder reported them green; my earlier cached run of typecheck, lint and docs:check passed).

## Docs updated
- [ ] none needed for this record
