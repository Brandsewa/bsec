# ADR-050: AI access for stores over MCP: layered capabilities, OAuth connections, a permission matrix

- **Status:** Accepted
- **Date:** 2026-11-21
- **Plan reference:** `docs/MCP-PLAN.md` (rules 1 to 7, 9, 12, 13; extends ADR-002, ADR-011, ADR-013, ADR-014, ADR-020; consistent with ADR-010)

## Context
Merchants want to manage their store from an AI assistant (Claude first, others later): read orders, stock and sales, edit products and SEO, publish. Doing this with pasted API keys has no consent, no scoping and no audit. A hosted MCP server needs OAuth, per-store permissions the merchant controls, limits against misuse, and an audit trail. The protocol (MCP) is young and changes; the data and rules we build must outlive it.

## Decision
1. **Five layers, only the top one is MCP.** L1 domain services (unchanged). L2 `packages/agent-capabilities`: a protocol-neutral capability registry (`id`, `resource`, `action`, Zod input, handler) plus the policy engine and output shaping. L3 data: tables named for agents, not MCP. L4 OAuth server in the web app. L5 `packages/mcp`: the MCP adapter (tool mapping, Streamable HTTP, protected resource metadata). A new protocol means a new L5 adapter.
2. **Endpoint:** `https://<root>/api/mcp` on the platform root host, in the web app, stateless. Bearer tokens only: cookies are ignored. It answers only on the platform root host (404 elsewhere), validates `Origin` only when present (claude.ai, claude.com), has no CORS for other sites, and is added to the storefront gate bypass list (ADR-014 decision 7).
3. **Identity.** A connection is one store, one approving staff user and one OAuth client. Tokens are opaque (`bsat_` access, 1 hour; `bsrt_` refresh, rotating with reuse detection), stored as SHA-256 hashes, audience-bound to the MCP URL. The store comes only from the connection, never from a header or argument.
4. **Authorization model.** A store-level **permission matrix** (resource by read, write, delete) is a ceiling. A call is allowed only if the matrix allows it, the approving user still holds the matching store permission, the store's plan includes AI access (`plans.features.ai_access`), the master switch is on with the current consent version accepted, and the `ai_access` feature flag is on. Delete means reversible only (archive); permanent deletion is never offered. Finance is read only; write and delete are locked. Import and export are not offered.
5. **Consent.** Enabling AI access requires accepting a versioned acknowledgement (data sent to the merchant's AI provider, merchant responsibility). Consent version, user and time are stored and audited; a new version pauses calls until accepted.
6. **Tables.** Tenant tables (`tenantTable()` + forced RLS, rule 1): `store_ai_settings`, `agent_connections`, `agent_call_log`. Platform-scoped tables (no RLS, like `support_sessions`, because a token must resolve before the store is known): `oauth_clients`, `oauth_authorization_requests`, `agent_tokens`. `app_rw` gets narrow grants on the platform tables (select, insert, delete, update of named columns only). This is a deliberate grant change (rule 9), covered by the grants suite.
7. **Actor.** New `agent` actor `{ userId, connectionId }`. Every write is audited as `actor_type = "agent"` with `before`, `after`, `connectionId` and `via` in `audit_logs.diff`. Existing `staff ? "staff" : "system"` mappings are fixed.
8. **Limits.** Per-minute and per-day limits live in `quota_definitions` (Growth = tier M, Pro = tier L) and use `checkRateLimit`; exceeding returns a plain message with `Retry-After`. Repeated denied calls pause a connection. A feature flag is the global kill switch; Super Admin can revoke a store's AI access.
9. **No outward effects.** v1 has no tool that sends email or SMS, fetches URLs or touches shipping (rule 14). Prompt-injection impact is bounded by the matrix, limits and audit.
10. **OAuth server is ours.** Better Auth 1.7.14 here has no OAuth provider plugin, so the server is a small custom module (`packages/domain/src/ai/oauth.ts`) with PKCE S256, DCR, CIMD from allowlisted hosts, `/token` with `authorization_code` and `refresh_token`, and RFC 9728 / RFC 8414 metadata, following Anthropic's connector requirements (plan section 14).
11. **Dependencies.** `@modelcontextprotocol/sdk` (exact version, direct dependency of `packages/mcp`), used in stateless mode.

## Consequences
- New tables and grants, permission `ai.manage` (owner and admin; denied to support sessions), actor type, quota keys, a login `returnTo`, middleware bypass, an admin settings page and an authorize screen.
- The matrix and capability layer are reusable by any future adapter (REST, ChatGPT actions, UCP).
- Web and MCP share a process until MCP load exceeds about 10% of web CPU or storefront p95 moves; then the adapter moves to its own container with no change to L1 to L4.
- A legal review of the consent text and an "AI access terms" page are launch blockers.
- Anthropic's connector behaviour changes; the compatibility checklist is re-run before release and monthly.

## Alternatives considered
- **Code Mode (model-written code in a sandbox):** wrong fit for a small surface, adds a code sandbox, conflicts with ADR-010.
- **Pasted API keys:** no consent, scoping or revoke.
- **Apps framework (ADR-043) for the master switch:** gives marketplace visibility but not plan gating, consent versioning or the matrix; a dedicated `store_ai_settings` row keeps those together. The marketplace can still list it later.
- **One MCP server per store:** operationally heavy.
- **OpenAPI-to-MCP conversion of the admin API:** hundreds of low-level tools, no matrix, poor model behaviour.
- **Per-connection scope picking in v1:** more UI, little value; the store matrix is the ceiling.
