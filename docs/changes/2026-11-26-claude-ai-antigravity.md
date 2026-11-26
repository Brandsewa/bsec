# AI access: connect Google Antigravity

- **Date:** 2026-11-26
- **Agent:** claude
- **Branch:** `feat/ai-antigravity` (not merged yet)
- **Area:** domain (OAuth allowlists), admin (Settings > AI access > Connection), docs
- **Type:** feature
- **Supersedes:** none

## Summary
Merchants can now connect Google Antigravity (App, editor, CLI) to their store, next to Claude. Antigravity signs in with its published Client ID Metadata Document and PKCE, which our OAuth server already supports; it only needed Antigravity's host and hosted callback on the allowlists, plus setup steps for merchants.

## What changed
- `packages/domain/src/ai/oauth.ts`: default redirect allowlist adds `https://antigravity.google/oauth-callback`; default CIMD hosts add `antigravity.google`.
- Settings > AI access > Connection: the card is now "Connect an AI app" with Claude and Google Antigravity tabs; the Antigravity tab shows the steps and a copyable `mcp_config.json` entry with the store's address.
- Approve screen: the "will not" list said "Delete anything permanently" even when a content Delete switch is on (content deletes since #315 are permanent for hidden items); it now says "Delete anything that is visible to shoppers" in that case.
- Docs: `docs/MCP-ANTIGRAVITY.md` (how Antigravity signs in, merchant steps, best practices), `DEPLOYMENT.md` (env defaults; an explicit Coolify value replaces them), `docs/ARCHITECTURE.md` section 24.

## Decisions and trade-offs
- CIMD rather than dynamic registration: Antigravity prefers it, the client identity is verifiable (the document is fetched from its own host) and nothing is stored per install.
- No API-key or bearer-header option is offered, although Antigravity supports `headers`: static secrets in a config file are the main risk the OAuth flow avoids.

## Verification
- Ran: `ai-access.int.test.ts` (real Postgres) 25 pass, including a new full connect test with Antigravity's published metadata document (stubbed fetch), its hosted callback, PKCE and the resource parameter; `ai-matrix.test.ts` passes with new redirect checks; admin eslint and tsc clean for the changed file.
- Local run (web on 3000, admin on 5180, seeded demo store): our server fetched Antigravity's live client metadata document and answered an authorize request with Antigravity's client id, hosted callback, PKCE and resource with a redirect to the approve screen, which reads "Connect Google Antigravity to your store?" and "The app will return to antigravity.google". The Connection tab's Google Antigravity tab shows the steps and the config with the store address; no horizontal scroll at 375 px.
- Checked Antigravity's live metadata document on 2026-11-26 (client name "Google Antigravity", single redirect URI, public client).
- NOT verified: a real Antigravity sign-in end to end (needs the change deployed: Antigravity must reach the store host, and its callback is hosted by Google). I did not press Approve locally.

## Docs updated
- [x] `docs/MCP-ANTIGRAVITY.md` (new), `DEPLOYMENT.md`, `docs/ARCHITECTURE.md`
- [x] ADR not needed (extends ADR-050)
- [x] `progress.md`

## Follow-ups and open questions
- Owner: if Coolify sets `AI_OAUTH_REDIRECT_URIS` or `AI_OAUTH_CIMD_HOSTS`, add the Antigravity values there.
- After deploy: connect Antigravity to a test store once and confirm the paste-code step.

## Definition of done
Gate steps run before the PR is opened.
