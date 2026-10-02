# bsec: instructions for Google Antigravity / Gemini

The single rule book for every coding agent in this repo is **[`AGENTS.md`](AGENTS.md)**. Read it fully before doing anything, then [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the latest files in [`docs/changes/`](docs/changes/README.md).

Do not duplicate rules here. If a rule is missing or wrong, fix `AGENTS.md`.

Antigravity specifics:
- Sign commits with `Co-Authored-By: Antigravity <noreply@google.com>`.
- Write a change record in `docs/changes/` (`<date>-antigravity-<slug>.md`) before you hand off or push.
- Hand-off plans written for you live in `docs/*-PLAN.md` with acceptance criteria; a verifier agent checks each one.
- Work only in your own git worktree/branch; never push to `main` with a failing gate (a push to `main` deploys production).
