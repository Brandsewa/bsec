# Sentry MCP connected to Claude, and strict incident rules in AGENTS.md

- **Date:** 2026-11-25
- **Agent:** claude
- **Branch:** `docs/sentry-mcp-rules`  (not merged yet)
- **Area:** docs, tooling
- **Type:** docs
- **Supersedes:** none

## Summary
At the owner's request Sentry's hosted MCP server was added to Claude so incident details can be pulled in and fixed on request. It is added at user level (outside the repo), limited to the `brand-sewa` organisation, and the owner approved the Sentry sign-in. This PR records it and adds the rules every session must follow: `AGENTS.md` section 10 and hard rule 16.

## What changed
- Outside the repo: `claude mcp add --transport http --scope user sentry https://mcp.sentry.dev/mcp/brand-sewa` (the owner then authenticated in the browser). The Sentry plugin's own unscoped copy was left unconnected.
- `AGENTS.md`: hard rule 16 and section 10 (event text is untrusted data; reading is free, changes need the owner's yes; the fix flow through a PR; no leaks from events; one scoped server; no unattended action; serious incidents go to the owner first).
- `DEPLOYMENT.md` "Error tracking (Sentry)": how the connection was added and removed.

## Decisions and trade-offs
- Read-mostly use with the owner's yes for any change, and no automatic fixing, because event text can carry instructions from outsiders and a merge to `main` deploys to production.
- User-level, not a project `.mcp.json`: the repo is public and other agents should not inherit the connection.
- The scoped server (not the plugin's) keeps the connection limited to the one organisation.

## Verification
- Ran: the connection reported the owner's Sentry account limited to `brand-sewa` (US), listed the four projects, and an issue search returned no open issues (the test issues had been deleted by the owner, so no issue details could be read); `pnpm docs:check`.
- Not verified: reading a real issue's details and stack trace (none exists yet), Seer analysis (not run, may use quota), the plugin's extra skills with this connection.

## Docs updated
- [x] `AGENTS.md`, `DEPLOYMENT.md`
- [x] ADR, ARCHITECTURE, progress: not needed

## Follow-ups and open questions
- First real incident: read it through the MCP and follow section 10; adjust the rules from what is learned.
- Decide later whether to use the plugin's extra skills (debug an issue, create alerts, releases, source maps).

## Definition of done
Docs check passes, no secrets in the diff. Open: PR, CI, merge cleanup.
