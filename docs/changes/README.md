# Change records

The shared, append-only log of **what changed, by which agent, and why**. It exists so any agent (Claude Code, Antigravity, Codex, a human) can see in minutes what the others did, without reading git history or asking.

## How it fits with the other docs

| Doc | Answers | Edited |
|---|---|---|
| `docs/changes/` (this folder) | What was changed, by whom, why, how it was verified | One **new file per change set**, never rewritten |
| [`progress.md`](../../progress.md) | Where are we: milestone status, known gaps, what is in flight | Updated in place when status changes |
| [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) | How the system is built, where things live | Updated in place when structure changes |
| [`docs/adr/`](../adr/README.md) | Why an architectural choice was made | New ADR per decision |
| `git log` | The exact diff | automatic |

**Why one file per change instead of one big log:** parallel agents on different branches all appending to one file collide on every merge. Separate files never conflict, sort by date, and can be searched or archived by folder.

## Rules

1. **Every change set that is merged (or handed off) gets one record.** A "change set" is one branch or one coherent piece of work, not one commit. Typos and pure formatting do not need one.
2. File name: `YYYY-MM-DD-<agent>-<short-slug>.md`, for example `2026-10-01-claude-themes-builder.md`. `<agent>` is one of `claude`, `antigravity`, `codex`, `cursor`, `copilot`, `zcode`, `human`.
3. Copy [`TEMPLATE.md`](TEMPLATE.md). Keep it short: a record is a pointer plus the non-obvious facts, not a diff. If it takes more than a screen, link a plan or ADR.
4. **Never edit someone else's record.** To correct or reverse one, write a new record and add `Supersedes: <file>` (and add `Superseded by: <file>` to the old one's header line only).
5. Write it **before you push or hand off**, in the same branch as the code, so it merges with the code.
6. Be honest in "Verification": what you ran, what you only read, what you did not do. The next agent trusts this section.
7. Records are run through `pnpm docs:check` (required header fields, file name). Newest records are the last files in the folder listing.

## Reading the log

```bash
ls docs/changes | tail -20          # most recent
grep -l "Area: .*themes" docs/changes/*.md   # everything that touched an area
```

Areas to use in the `Area:` field: `db`, `domain`, `contracts`, `auth`, `blocks`, `block-editor`, `web`, `admin`, `superadmin`, `platform`, `worker`, `payments`, `shipping`, `ui`, `config`, `infra`, `ci`, `docs`, `e2e`.
