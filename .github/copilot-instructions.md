# bsec: instructions for GitHub Copilot

All rules for coding agents live in [`AGENTS.md`](../AGENTS.md) at the repo root. Read it before suggesting or making changes, then [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Do not duplicate rules here.

Hard stops (full list in `AGENTS.md` section 2): tenant tables use `tenantTable()` + FORCE RLS; only `packages/db` and `packages/domain` import database drivers; no secrets in code or logs; no merchant-controlled code; never push to `main` with a failing gate. Add a record to `docs/changes/` for every change set.
