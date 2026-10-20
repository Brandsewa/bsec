# CI: Docker layer cache uses mode=min to stay under the Actions cache limit

- **Date:** 2026-10-20
- **Agent:** claude
- **Branch:** `ci/buildkit-cache-min` (merged in the PR that adds this file)
- **Area:** ci
- **Type:** ci
- **Supersedes:** none

## Summary
The repository's GitHub Actions cache reached 11.66 GB against the 10 GB limit (553 caches). Most of it was BuildKit layer cache: `cache-to: type=gha,mode=max` stored every intermediate layer, about 345 MB per entry, for six images on every `main` run. GitHub evicts least recently used caches on its own, so nothing broke, but useful caches were being evicted too.

## What changed
- `.github/workflows/ci.yml`: image build `cache-to` is now `mode=min` (final layers only).
- One-time clear of the existing `buildkit-blob-*` caches via the GitHub API.

## Decisions and trade-offs
`mode=min` keeps a much smaller footprint and gives slightly less layer reuse (the first build after a dependency change may be a little slower). A registry cache in GHCR would free the quota entirely but is more setup; not needed yet.

## Verification
- Ran: `pnpm docs:check` (see PR checks). The new setting only takes effect on the next `main` image build.
- NOT verified: build-time impact; compare the next two `main` runs.

## Docs updated
- [ ] `docs/ARCHITECTURE.md` not needed (no structure change)
- [ ] ADR not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK not needed
- [ ] `progress.md` not needed

## Follow-ups and open questions
- If builds get noticeably slower, move the cache to `type=registry` in GHCR.

## Definition of done
Gate passes in CI; no secrets, generated files or unrelated edits in the diff.
