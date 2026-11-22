# AI access for stores over MCP (Claude first)

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `feat/ai-access-mcp` (not merged yet)
- **Area:** db, auth, domain, contracts, web, admin, new packages `agent-capabilities` and `mcp`
- **Type:** feature
- **Supersedes:** none

## Summary
A merchant on the Growth plan or above can connect an AI app such as Claude to their store and manage it in chat: orders, stock, sales, finance summary, customers, and creating, editing, publishing and archiving products and collections. The merchant switches AI access on (after accepting a recorded, versioned acknowledgement), chooses what the AI may do in a read, write, delete permission grid, sees connections, usage and what the AI changed, and can disconnect an app at once. The platform keeps the AI inside limits and records every AI change as made by the AI app. Plan and decisions: `docs/MCP-PLAN.md`, ADR-050.

## What changed
- **Migration `0119_ai_access`:** tenant tables `store_ai_settings`, `agent_connections`, `agent_call_log` (forced RLS); platform-scoped `oauth_clients`, `oauth_authorization_requests`, `agent_tokens` (no RLS, narrow `app_rw` grants); `plans.features.ai_access` on Growth and Pro; feature flag `ai_access`; six `ai_*` quota keys (Growth tier M, Pro tier L).
- **Permission and actor:** `ai.manage` (owner and admin; denied to support sessions), actor type `agent`; catalog audit rows now record the approving user for agent writes.
- **OAuth server** (`packages/domain/src/ai/oauth.ts`, `tokens.ts`, routes in `apps/web/src/server/ai-http.ts`): dynamic registration, CIMD from allowlisted hosts, authorize, token (PKCE S256, single-use codes, rotating refresh tokens with reuse detection), revoke, discovery metadata at `/.well-known/oauth-*`. Follows Anthropic's connector checklist (plan section 14).
- **MCP endpoint** `POST /api/mcp` (`packages/mcp`, stateless Streamable HTTP, bearer only, root host only) over **24 capabilities** in `packages/agent-capabilities` (protocol-neutral registry, policy, limits, shaping, call log).
- **Store admin:** `/settings/ai-access` (Connection and Permissions tabs, consent dialog, setup check), `/oauth/authorize` (approve screen), login `returnTo`.
- **Tests added:** domain unit and integration (22 real-database tests for OAuth, lifecycle, limits, RLS, grants), capability unit and integration, MCP adapter tests, `admin.ai.*` mappings in the isolation suite, b2 grants allow-list.
- **Docs:** ARCHITECTURE section 24 and tables, DEPLOYMENT env vars, RUNBOOK Cloudflare note, ADR-050, plan build status.
- **Env vars (all optional):** `AI_ADMIN_ORIGIN`, `AI_OAUTH_REDIRECT_URIS`, `AI_OAUTH_CIMD_HOSTS`.

## Decisions and trade-offs
- Custom OAuth server: Better Auth 1.7.14 here has no OAuth provider plugin. About 400 lines, covered by real-database tests.
- Hosted in the web app at `/api/mcp` (no new container); the adapter is a separate package so it can move to its own app when MCP load warrants.
- Token tables are platform-scoped (a token resolves before the store is known), like `support_sessions`, with `app_rw` limited to select, insert, delete and update of named columns. The allow-list test `b2-grants` names them on purpose.
- `deleteProduct` and `deleteCollection` delete permanently, so the AI never calls them: "delete" means archive, collections delete is not offered.
- Integration tests for packages that may not import `@bs/db` use `@bs/domain/test-support` (re-exports `startTestDb`); no lint rule was loosened.

## Verification
- Heavy, `packages/domain` (`pnpm test:heavy:local`): 167 files passed, 1 failed (`settings-authorization.int.test.ts` assumed every `*.manage` permission is covered by legacy `settings.write`; `ai.manage` is deliberately standalone, so the test now lists it as an exception and asserts it). That file passes alone after the change; the whole domain heavy run was not repeated.
- Ran: `tsc` on domain, contracts, agent-capabilities, mcp, web and admin (clean); eslint on the new packages and the changed files (clean); fast tests: domain 803, web 298, admin 154, platform 7, agent-capabilities 15, mcp 7, plus auth, contracts, db and the rest of the monorepo passed in the turbo run; heavy: `packages/db` integration 22 pass, `ai-access.int.test.ts` 22 pass, `capabilities.int.test.ts` 6 pass, `isolation.int.test.ts` 1897 pass (local shared Postgres on 55432); `pnpm docs:check` ok.
- Exercised by hand on the local stack (web 3000, admin 5180, demo store, Growth plan): an end-to-end script (discovery, registration, authorize, approve, token, MCP initialize, tools/list, 12 tool calls including a draft write, SEO edit, publish refusal and archive, refresh rotation, reuse detection, revoke) passed all checks; the settings page, consent dialog, Permissions tab, setup check and the approve screen were driven in the browser pane in dark mode and at 375 px.
- NOT verified: a real Claude connection (needs a public https address and Cloudflare to let Anthropic's ranges through), MCP Inspector from a public address, light theme of the new screens, ChatGPT and Gemini, CIMD against a live client, load at the sizing in plan section 7, and the heavy suites of `apps/platform` and `apps/web` (the local heavy run stopped at the first failing package).

## Docs updated
- [x] `docs/ARCHITECTURE.md` (sections 3, 7, 8, 16, 24)
- [x] ADR-050
- [x] `DEPLOYMENT.md` and `infra/coolify/RUNBOOK.md`
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Owner: yes or no to the Cloudflare skip rule for Anthropic's address ranges (needed before a real Claude connection).
- Legal: review the consent wording (`packages/domain/src/ai/consent.ts`, draft) and publish an "AI access terms" page; fill in the company name. Launch blocker.
- Not built: notification events for a new connection, scheduling of `pruneAgentCallLog` and `pruneOAuthData`, image by URL, bulk change sets with undo, order and customer writes, other AI apps.

## Definition of done
Gate steps listed under Verification were run; no secrets or generated files are in the diff (`routeTree.gen.ts` is generated and ignored); not merged, so the merge follow-ups in AGENTS.md section 5 are still to do.
