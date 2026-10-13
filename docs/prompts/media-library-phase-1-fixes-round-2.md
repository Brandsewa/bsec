# Media Library Phase 1: fix round 2 (send-back from Claude re-verification)

Paste this whole file as the first message of a new session. You are fixing **your own branch** `feat/media-library-phase-1` in `../bsec-media-p1`. Claude re-verified head `4066341` on 2026-10-14. Round 1 fixed most things (B1-B6, lint, the heavy-test regressions, most of S1-S8). Two items still block the merge. Do only what is listed here; do not start Phase 2.

## What Claude confirmed as fixed (do not rework)
- Lint and typecheck pass.
- B1: private folders (`returns`, `expense-receipts`) are excluded from library queries, mutations, sweep and quota sums.
- B2: client storage keys must carry the caller's tenant prefix, a safe shape, no private folder, and no duplicate. The duplicate check runs before any storage call. Migration `0057` adds the unique index.
- B3: the size/quota check uses `head()` before reading the body, and magic bytes are checked from a 4 KB range.
- B4: the sweep runs per tenant under `withTenant` as `app_rw`, re-checks in the DELETE, and purges through jobs.
- B5: `findUntrackedReferences` covers every media column in the schema (branding ×5, store status background, SEO OG image) plus page versions and theme tokens.
- B6: no other write paths exist; usage sync rejects foreign and private ids.
- `product-images` and `storage-connections` tests now use real PNG bytes and a local driver, which is the right fix. Document formats match the plan. `sharp` is loaded lazily.

## 1. Blocking

### R1. Quota bypass through `folder` on the presigned `create` path
`createMediaRecord` validates the folder in the storage key, then saves `folder: input.folder || folder`. A client can send `folder: "returns"` (or `"expense-receipts"`) in the `create` body for a normal library upload. The row is then:
- excluded from `storage_mb` usage (B1 scope), so the store gets **unlimited storage**;
- hidden from the merchant's library;
- treated as an orphaned return photo by `cleanupOrphanedReturnPhotos`, which deletes it.

The proxy path (`uploadMediaDirect`) already refuses private folders; the presigned path must match.

Fix:
- Always store the folder taken from the validated storage key. Ignore `input.folder` on `create`, or refuse it if it differs from the key's folder.
- Also refuse private folders at `requestUpload`, so a presigned URL is never issued for `returns/` or `expense-receipts/` keys from the library endpoints.

Real-DB tests:
- `create` with a valid key and `folder: "returns"` stores the key's folder, or is refused.
- Its bytes count toward `storage_mb`.
- It appears in `list`.
- `requestUpload` with `folder: "returns"` is refused.

### R2. Local walkthrough evidence is still missing
Neither change record has walkthrough evidence. Claude could not run the admin app from your worktree (no `.env`, no dev database). Do the walkthrough from the round-1 prompt section 3 at **375 px and desktop**, and attach screenshots to your change record:
- grid view;
- table view;
- detail sheet with "Used in";
- upload tray showing a 6 MB JPG and an SVG refused with specific errors;
- Trash, including permanent delete blocked for a used file and for the store logo;
- the storage meter;
- a storefront return photo that does **not** appear in Media.

If any step fails, fix it and say what you changed.

## 2. Should fix
- **R3** The round-1 fixes record does not report on S1-S8. Add a short section to your new record: each S item, fixed or not, and where. (Claude's full heavy run of `4066341`: 97 files, 2045 tests, all passed, no worker crash; the earlier `signup-pipeline` crash did not recur.)
- **R4** S8: confirm the production web and worker Docker images build with `sharp` in `@bs/domain`. Run the image builds locally, or say plainly that you could not and why.
- **R5** Migration `0057` builds a unique index without `CONCURRENTLY`. `media` is small today, so this is acceptable. Add one line to the round-2 change record confirming generated keys are UUID-based, so production cannot hold duplicates. Do not change the migration.

## 3. Hand back
- Small commits (`fix(domain): ...`, `test(domain): ...`), trailer `Co-Authored-By: Antigravity <noreply@google.com>`, stage files by explicit path only.
- Rebase on the latest `origin/main` and run the full gate:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm docs:check`
  - `pnpm --filter @bs/domain test:fast`
  - `pnpm test:heavy:local` (whole suite, serial)
  - `pnpm --filter @bs/db test`

  Paste the real counts.
- New change record `docs/changes/2026-10-14-antigravity-media-library-phase-1-fixes-round-2.md` covering R1-R5 with evidence and screenshots.
- Mark your "In flight" line `[Ready for Claude re-verification]`.
