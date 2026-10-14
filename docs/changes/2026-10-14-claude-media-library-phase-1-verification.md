# Media Library Phase 1: Claude verification and final fix

- **Date:** 2026-10-14
- **Agent:** claude
- **Branch:** `feat/media-library-phase-1` (not merged yet)
- **Area:** domain, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Verified Antigravity's Phase 1 after two send-back rounds (heads `ea54a3e`, `4066341`, `83d7326`) against `docs/MEDIA-LIBRARY-PLAN.md` section 11. All blocking defects are fixed. One new defect was found and fixed here: Media grid thumbnails were built through Cloudflare's `/cdn-cgi/image/` resizer whenever any public base URL existed, so every image tile was blank on local storage and would fail on any zone without Image Transformations.

## What changed
- `packages/domain/src/media-services.ts`: `buildThumbnailUrl` now uses the resizer only when `CDN_BASE_URL` is set explicitly; otherwise it returns the original public URL. Removed the unused storage-connection lookups it needed.
- `packages/domain/test/media-thumbnail.test.ts`: 4 unit tests for it.
- `.env.example`, `DEPLOYMENT.md`, `docs/ARCHITECTURE.md`: documented optional `CDN_BASE_URL` (a zone with Image Transformations enabled).

## Verification (Claude, local, final tree)
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`: pass.
- `pnpm --filter @bs/domain test:fast`: 48 files, 410 tests pass.
- Full heavy suite, serial, local Postgres (`node scripts/test-heavy-local.mjs --no-file-parallelism`): 97 files, 2046 tests, all passed.
- Reviewed by reading: migrations 0056/0057, `media-services.ts` (private folders, key validation, quota before download, per-tenant sweep, untracked references, folder tampering fix), quotas, jobs, catalog usage wiring, upload queue and UI source.
- Screenshots in `docs/test-evidence/2026-10-14-media-library/` viewed: grid, mobile, upload tray errors, detail sheet, trash confirm. Screenshots 07 and 08 are the same image, and 09 shows the confirm dialog, not the blocked result. Blocked deletes are proven by real-DB tests; the UI code handles `blocked` (media.tsx, media-detail-sheet.tsx).

## Not verified
- I did not run the admin app myself (no dev stack in the worktree); UI evidence is Antigravity's Playwright run plus source reading.
- Image previews in the detail sheet were blank in the screenshots. The walkthrough seeded rows; whether the files exist in storage was not checked.
- Cloudflare Image Transformations on the production zone: not checked, so `CDN_BASE_URL` stays unset.

## Docs updated
- [x] `docs/ARCHITECTURE.md`, `DEPLOYMENT.md`, `.env.example`
- [x] ADR-028 (Antigravity)
- [x] `progress.md`

## Follow-ups and open questions
- Owner: enable Cloudflare Image Transformations on the media zone and set `CDN_BASE_URL` if lighter thumbnails are wanted.
- Phase 2: shared picker, branding/page/theme usages, `replace` file.
