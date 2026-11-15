# Notion sync check: list repo records with no Notion row

- **Date:** 2026-11-15
- **Agent:** claude
- **Branch:** `ci/notion-sync-check` (merged in #260, 04fc77c; production deploy succeeded)
- **Area:** infra, docs
- **Type:** ci
- **Supersedes:** none

## Summary
AGENTS.md section 6 rule 7 (#258) makes every agent keep the BCOM Platform OS in Notion current, but Notion has no automation on our plan, so a missed update goes unnoticed. This adds `pnpm notion:check`, which lists change records (`docs/changes`) and ADRs (`docs/adr`) that have no row in the Notion Change Log or Decisions databases, and Notion rows that point at a file that no longer exists. When it was built the Notion Change Log had been 38 records behind the repo.

## What changed
- `scripts/check-notion-sync.mjs`: zero dependencies, offline, no token. Input is any text export of the two Notion databases (CSV export, a Notion query result as JSON, or a plain list): it only looks for `docs/changes/<file>.md` and `docs/adr/<file>.md` anywhere in the text, so column layout does not matter. Options: `--notion <file>` (required), `--since YYYY-MM-DD` (only change records on or after the day count), `--strict` (orphans also fail), `--json`. Exit 0 in sync, 1 missing rows, 2 bad usage.
- `scripts/check-notion-sync.test.mjs`: five `node:test` cases (listing, extraction from CSV/JSON/text, missing and orphans, `--since`, in sync).
- `package.json`: script `notion:check`. `docs/ARCHITECTURE.md`: `scripts/` row updated. `progress.md`: In flight line.
- Not wired into CI or the pre-push hook (see decisions).

## Decisions and trade-offs
- **No Notion API token.** Querying Notion from a script needs an integration token, which is a credential and an owner decision (rule 7 of the hard rules: secrets never in code; account and key creation is the owner's). So the script reads an export instead. A later step can add an API mode once the owner creates a read-only integration and stores its token as a secret.
- **Not in CI.** CI cannot read a private Notion workspace without that token, and a check that needs a manual export cannot gate a push. It is a session-end and weekly-hygiene tool, referenced from the Notion Session protocol page.
- Matching is by file name in the Source of truth or Repo path column, not by title, because titles in Notion are shortened.
- ADR rows only count when the Source of truth points at the ADR file; Owner decision rows have no file and are ignored.

## Verification
- Ran: `node --test scripts/check-notion-sync.test.mjs` (5 pass); `node scripts/check-docs.mjs` (ok); the CLI against a fixture (exit codes 0, 1, 2 as designed).
- Ran against real data: the Source of truth column of the Notion Change Log for 2026-11-01 onwards (66 rows, read through the Notion tools) against this branch: the only change record dated 2026-11-01 or later missing from Notion was the 2026-11-15 record of #258. That run also showed a duplicate Notion row for `2026-11-03-claude-deploy-log-check-fix` (added by mistake by an agent); the script lists missing files, not duplicates.
- NOT verified: a full run against all 280 Change Log rows and all Decisions rows; a run on a real Notion CSV export (the CSV path is covered only by a synthetic fixture); Windows paths with backslashes (the script matches forward slashes, which Notion URLs and repo paths use).
- Typecheck, lint, build and heavy tests not run: no TypeScript or package code changed; pushed with `SKIP_GATE=1` as AGENTS.md section 4 allows for docs-only pushes (this change touches scripts and docs only).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 3, `scripts/` row)
- [ ] ADR: not needed (tooling)
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Owner: should an API mode be added (needs a read-only Notion integration token)? Until then the check is manual.
- Done after merge: PR and commit recorded, In flight line removed, branch and worktree removed.

## Definition of done
No secrets, no generated files, no unrelated edits. Rule 7 (Notion updated) is done by hand on the Notion side after merge.
