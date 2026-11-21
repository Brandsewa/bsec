# Merchant AI access over MCP (plan, lean v1)

Status: **built (Phases 0, 1a, 1b, 2) on `feat/ai-access-mcp`, see section 17**; originally written as a plan. Owner request 2026-11-21; revised the same day (lean scope, owner decisions, Claude auth checklist, screens, consent), then **verified against the codebase on 2026-11-21** (section 16 lists what was checked and what changed). Builder: not assigned. ADR-050 (docs/adr/050-ai-access-mcp.md) is written; ADR-043 and 044 to 049 were taken by other work after this plan was drafted, so the number changed.

Goal: a merchant on the Growth plan or above connects their store to Claude and, in chat, checks orders, stock and sales, edits products and SEO, and publishes. The store admin controls exactly what the AI may do from one settings page. We build the foundations that are hard to change later, and keep every layer reusable if MCP is later replaced or joined by another protocol.

## 1. Owner decisions on record (2026-11-21)

1. **Plan gating:** AI access starts at the **Growth plan** (Growth and Pro; Starter sees an upgrade prompt). Same pattern as custom fields (`customFieldsEnabled`, Growth and above).
2. **Dedicated MCP settings page** in the store admin with two tabs: **Connection** (enable, setup steps, connection status) and **Permissions** (a matrix of resources by read, write, delete toggles).
3. **Usage limits** so the feature cannot be misused, with a clear "limit reached, resets in N minutes" message like Notion's connector.
4. **`/api/mcp` on the existing host** is acceptable if it carries no security risk (assessed in section 8).
5. **Upgradability:** if MCP is replaced later, the data and logic layers must be reusable. Section 4 defines the layers; only one thin layer is MCP-specific.
6. **Data (import and export) is removed from AI access.** The chatbot can already read and update records one by one, so import and export stay human-only tools.
7. **Customers: read only, including contact details** (name, email, phone, addresses), because merchants need them for shipping and follow-up. Customers can be edited later if needed. Nothing the AI reads is stored by bsec.
8. **Finance: read access is in scope** (write and delete stay permanently locked). First finance read stays small: profit and loss summary plus the expenses list; more is added later if wanted. **Limits** in section 7 are accepted as the starting point and will be raised later if needed.
9. **Enabling AI access needs an explicit consent** (acknowledgement of data sharing and responsibility, section 3.3), recorded and versioned.
10. **The connection must work first time.** Authentication follows Claude's current connector requirements exactly (section 14), because the owner hit authentication problems with an earlier MCP setup. The sign-in and consent screens follow the admin design system and theme (section 15).

## 2. What Shopify and Notion do (researched 2026-11-21)

Shopify (shopify.dev read directly; secondary blogs for the rest):

| Shopify offering | What it is | Auth | Lesson for us |
|---|---|---|---|
| Storefront Catalog / Cart MCP at `https://{shop}/api/ucp/mcp` | For **shoppers' AI agents**: search, cart. 5 catalog tools, cursor pagination (default 10, max 250), named JSON-RPC errors, cart update replaces the whole cart. | No key; every request carries an agent profile URL Shopify validates. | Shopper-side is a separate, later product (Shopify and Google's UCP). Copy the tool-design habits. |
| Shop MCP (`mcp.shop.com`) | Cross-merchant shopping and checkout for agents. | Optional shopper sign-in. | Same: separate track. |
| Dev MCP | Docs and schemas for developers, local, never touches a store. | None. | Not relevant. |
| AI Toolkit (April 2026) | Developer-first plugin; store management through the Shopify CLI's login. | Not documented. Docs show no scopes, read-only mode, write confirmation or merchant audit log. | Merchant-side AI is not a polished one-click product there. |
| Community Admin API servers (about 31 tools) | Wrap Admin GraphQL: products, orders, customers, inventory. | Static or app token, broad. | Shows what merchants expect; lacks consent, audit, revoke. |

Not confirmed: Shopify's rate limits, per-merchant enablement, how toolkit store management logs in, and whether any official hosted merchant MCP with OAuth exists (one blog claimed `@shopify/admin-mcp`; unverified). Shopify's toolkit sends the user's last message to a usage endpoint by default; we log tool name, status and duration only.

Notion (developers.notion.com): MCP tool calls count toward the normal API limits. Average about 3 requests per second with bursts; over the limit returns **HTTP 429 with a `Retry-After` header** (seconds), and clients must wait that long. Some secondary sources quote per-minute and search-specific caps (180 per minute, 30 searches per minute); unverified. We copy the behaviour (429, `Retry-After`, plain-language message), not the numbers.

Standards that drive the design: remote MCP over Streamable HTTP; OAuth 2.1 resource server with Protected Resource Metadata (RFC 9728), PKCE and resource-bound tokens (RFC 8707); Dynamic Client Registration today, Client ID Metadata Documents as the newer path; tool annotations are UX hints not security; never pass the MCP token on; tenant from validated auth only; validate the `Origin` header. Verify the current spec revision (2026-07-28 appeared as a stateless release candidate) at modelcontextprotocol.io in Phase 0. Claude custom connectors need a public HTTPS URL on a standard port; on Team and Enterprise only workspace Owners add them. ChatGPT needs Developer Mode and business plans for writes; Gemini CLI works with standard servers; consumer Gemini is unconfirmed.

## 3. The merchant experience

### 3.1 Settings > AI access (new page, `ai.manage` permission, owner and admin only)

**Tab 1: Connection**
- Master switch **Enable AI access** (off by default; Starter plan shows an upgrade prompt instead).
- Connector URL with a copy button, and numbered steps for Claude ("Settings > Connectors > Add custom connector > paste the URL > sign in and approve"). Short notes for Team plans (workspace Owner adds the connector).
- **Connection status:** "Not connected" or a list of connections (AI app, merchant user who approved, connected date, last used) with **Revoke** per connection.
- **Usage meter:** calls and writes today against the limits, next reset time, and a banner if a limit was hit.

**Tab 2: Permissions** (the matrix; all off by default, "Read only" preset button)

| Resource | Read | Write | Delete | What the toggle means in v1 |
|---|---|---|---|---|
| Products | on/off | on/off | on/off | read: list, view, low stock, media library. write: create (draft), edit, SEO, variant prices, stock, attach library images. **delete = archive** (sets status `archived`, recoverable; never the existing `deleteProduct` service, which deletes permanently). Extra toggle under it: **Allow publishing** (make products visible), off by default. |
| Collections | on/off | on/off | Coming soon | read: list, view. write: create (always unpublished; collections default to `published = true`, so the tool sets it false), edit, SEO, add products. delete: not in v1, because the existing `deleteCollection` service deletes permanently; a reversible "unpublish" comes later |
| Customers | on/off | n/a | n/a | **read only**: name, email, phone, addresses, order count, total spent, first and last order date, tags. Needed for shipping and follow-up. Write and delete are not offered (later if wanted) |
| Orders | on/off | Coming soon | n/a | read: list, view, stats. write (notes, status): later. delete: never offered |
| Analytics | on/off | n/a | n/a | read: sales summary and reports |
| Finance | on/off | locked | locked | **read only**: profit and loss summary and the expenses list (read-only wrappers over the existing finance reports). Write and delete are **permanently locked**: AI never posts, edits or settles a money entry. The approving user must also hold `finance.read` (owner and admin by default) |

There is no Data row: import and export are not available to AI (owner decision 2026-11-21).

Rules for the matrix:
- A cell is **shown disabled with "Coming soon"** until at least one tool is registered for it. The matrix is therefore the stable policy layer; adding tools later never changes the page or the data model.
- **Delete means reversible only** (archive, soft delete, unpublish). Permanent deletion is never available to AI, consistent with ADR-024 and the rule that permanent deletes need explicit human confirmation.
- Changes apply **immediately to every connection** (checked on every call), so turning a toggle off cuts access at once.
- **Privacy:** bsec does not store what the AI reads; our call log keeps tool name, status and duration only. What the AI reads, including customer contact details when Customers read is on, is processed by the merchant's own AI provider under that provider's terms. The enable consent (section 3.3) and one sentence on the Connection tab say so.
- The matrix is a **ceiling**. A call is allowed only if the store matrix allows it **and** the approving merchant user still holds the matching store permission (`products.write` and so on). Demoting the user removes the AI's access too.

### 3.2 Authorize screen (admin route, merchant signed in)
Only a signed-in user with `ai.manage` in that store can approve, and never a platform support session. "Claude wants to connect to *Store name*." It lists what the store's current matrix allows (read-only list, no per-connection toggles in v1), the merchant user it will act as, and Approve or Cancel. Setting up a stricter set for one connection is a later feature.

### 3.3 Enable consent (acknowledgement and responsibility)

When the merchant presses **Enable AI access** (and only then), a dialog must be accepted before anything is turned on. Draft text, to be reviewed by your legal adviser before launch (I am not a lawyer; the wording below is a plain-language starting point, not legal advice):

> **Turn on AI access for {Store name}?**
> AI access lets an AI assistant that you choose (for example Claude) read and change information in your store through a connection you approve. Depending on the permissions you set, this can include:
> - Products, collections and prices
> - Orders and order history
> - **Customer details: names, email addresses, phone numbers and addresses**
> - Sales, reports, and finance summaries (profit and loss, expenses)
>
> Please note:
> - Information the AI reads is sent to the AI provider you connect (for example Anthropic) and is handled under that provider's own terms and privacy policy. {Platform legal name} does not store what your AI reads.
> - You decide what the AI may do in Permissions, and you can turn AI access off or disconnect any app at any time. Changes made by the AI are recorded in your activity log.
> - AI assistants can make mistakes. You are responsible for reviewing what the AI does in your store.
> - You are responsible for how customer and other data is shared with AI tools, including your privacy notice and your legal obligations to your customers (for example under the Digital Personal Data Protection Act, 2023).
> - To the extent permitted by law, {Platform legal name} is not liable for actions, decisions, losses or data handling by the AI provider or the AI assistant you connect.
>
> [ ] I have read and agree. [ Link: AI access terms ]   **[ Cancel ]  [ Enable AI access ]**

Rules:
- The **Enable** button stays disabled until the box is ticked; only a user with `ai.manage` can accept.
- Consent is **versioned and recorded**: `store_ai_settings` keeps `consent_version`, `consent_at`, `consent_by_user_id`, and an `audit_logs` row is written (action `ai.consent.accepted`, with the version). Turning access off and on again asks again.
- When the consent text changes (new version), enabled stores see the dialog again on their next visit to the page, and AI calls pause until accepted.
- Proposed small addition (drop it if you prefer): the first time the merchant switches on **Customers read** or **Finance read**, a short `ConfirmDialog` repeats that this data will be sent to their AI provider.
- Needs a published "AI access terms" page and a matching clause in the Terms of Service; both are legal-adviser tasks and are Phase 1 launch blockers, not code tasks. A disclaimer limits what bsec accepts responsibility for; it does not remove duties bsec or the merchant already has under data-protection law, so the adviser should confirm the wording and each party's role.
- The authorize screen (S3) also shows one line: "Information Claude reads goes to Anthropic under its terms."

## 4. Architecture in layers (upgradable by design)

```
 L5  Transport adapters      packages/mcp  (MCP now; OpenAPI/REST, ChatGPT, UCP, A2A later)
 L4  Auth server (OAuth)     generic tokens + connections, not MCP-specific
 L3  Policy + identity data  store_ai_settings, agent_connections, agent_tokens, agent_call_log
 L2  Capability layer        packages/agent-capabilities: protocol-neutral tool registry + policy engine
 L1  Domain services         packages/domain (exists; single source of business rules)
```

- **L1 Domain services:** unchanged. All rules, permission checks, audit, cache invalidation stay here (hard rules 3 to 6).
- **L2 Capability layer (new, `packages/agent-capabilities`):** a capability is `{ id, resource, action (read|write|delete), input (Zod), output, annotations, handler(ctx, input) }`. It also holds the **policy engine** (`store matrix AND user permission AND plan AND limits`), output shaping (cursor pagination, size cap, minor-unit money), and a neutral error model (`invalid_input`, `forbidden`, `rate_limited` with `retryAfterSeconds`, `not_found`, `conflict`). It does not know MCP, JSON-RPC or HTTP. It imports `@bs/domain` only (rule 2).
- **L3 Data:** tables are named for agents, not MCP. Two kinds, because a token must be resolved **before** the store is known:
  - **Tenant tables** (`tenantTable()` + `forceRlsSql`, rule 1): `store_ai_settings` (master switch, matrix, consent version, who and when), `agent_connections` (user, client, `protocol` column, status, last used), `agent_call_log` (tool, status, duration, bytes; pruned after 90 days by the existing maintenance job).
  - **Platform-scoped tables** (plain `pgTable`, no RLS, same pattern as `support_sessions`, which `validateSupportSessionToken` reads by token hash): `oauth_clients` (registered clients and redirect URIs), `oauth_authorization_requests` (short-lived, before consent, no tenant yet), `agent_tokens` (hash, kind, `tenant_id`, `connection_id`, expiry, family for reuse detection). `app_rw` gets only the narrow column grants it needs (select by hash, insert, revoke), mirroring the `support_sessions` grants in migration 0014. This is a grant change (hard rule 9), so it is decided in ADR-050 and covered by the grants test suite. Every other read happens inside `withTenant` once the token gave the tenant. The permission matrix is stored as data keyed by `resource` and `action`, so any future protocol reads the same rows. Audit uses actor `agent` plus `via: "mcp"` in metadata.
- **L4 OAuth server:** issues connection-bound tokens for any adapter. It lives in the web app next to Better Auth and reuses the staff session for the approval step. The library choice is made in Phase 0 (see section 16: no OAuth provider plugin is installed today).
- **L5 Adapter `packages/mcp`:** the only MCP-specific code: turns the capability registry into MCP tools (JSON Schema from the Zod inputs), Streamable HTTP and JSON-RPC handling, Protected Resource Metadata, annotations, error mapping. Swapping or adding a protocol means writing another adapter against L2 and reusing L1 to L4 untouched.

Naming rule: no `mcp` in table names, domain code or audit action names; MCP appears only in `packages/mcp`, the route and docs.

Request flow (v1):
```
Claude -> POST /api/mcp (Streamable HTTP, stateless, bearer token only)
  1 verify token (hash, audience, expiry, not revoked) -> connection -> tenant, user
  2 check Origin, plan feature, master switch, consent version, kill switches,
    store lifecycle (isAdminAccessAllowed / isAdminReadOnly: read-only stores refuse writes)
  3 rate limit (section 7)  -> 429 + Retry-After + plain message
  4 capability lookup -> policy: store matrix AND user permission
  5 call domain service with ctx { actor: { type: "agent", connectionId, userId } }
  6 shape output, log call (tool, status, duration, no payloads)
```

## 5. v1 capabilities (about 15; each declares resource and action)

Defaults: page size 20, max 50, opaque cursor. Output omits nulls; prices are integer minor units plus currency. Merchant- and shopper-written text (titles, reviews, notes) sits in clearly marked data fields. Writes accept an optional `idempotencyKey`, stored in the existing `idempotency_keys` table (replayed result on retry). `tools/list` returns only the tools the current matrix allows (so the model is not offered forbidden tools); every call is still checked again, because a client may cache an old list. Order tools show the customer's name, email, phone and shipping address only when Customers read is on; otherwise those fields are redacted.

| Capability | Resource.action |
|---|---|
| `get_store_overview` (always first: store name, currency, time zone, and which permissions this connection has; counts and sales appear only for resources the matrix allows) | none (always allowed once enabled) |
| `list_products`, `get_product`, `list_low_stock` (over `listInventoryLevels`), `list_media` (over `listMedia`, so "add the image called X" works) | products.read |
| `create_product` (draft only, one default variant), `update_product` (product fields: title, descriptions, SEO, categories, media ids), `update_variant` (price, compare-at price, SKU; over `updateVariant`; prices live on variants), `set_inventory` (over `adjustInventory`, with reason) | products.write |
| `publish_product`, `unpublish_product` | products.write **and** "Allow publishing" |
| `archive_product` (`updateProduct` with status `archived`; restoring is the same tool with status `draft`) | products.delete |
| `list_collections`, `get_collection` | collections.read |
| `create_collection` (`published = false`), `update_collection` (incl. SEO and product membership) | collections.write |
| `list_orders`, `get_order`, `get_order_stats` (over `listAdminOrders`, `getAdminOrderDetail`, `getAdminOrderStats`) | orders.read |
| `list_customers`, `get_customer` (over `listAdminCustomers`, `getAdminCustomerDetail`; includes name, email, phone, addresses) | customers.read |
| `get_sales_summary` (up to 92 days, grouped by day or product, 5 s statement timeout). **No analytics service exists yet** and `analytics.read` is not used anywhere today, so Phase 1b adds `getSalesSummary` to `packages/domain` (reusing the order totals that `getGmv` already reads) | analytics.read |
| `get_finance_summary` (period profit and loss), `list_expenses` (over `getProfitAndLoss` and `listExpenses`, which exist) | finance.read |

Not in v1: finance writes, data import and export (removed from AI access), order and customer writes, image by URL (media id only until the hardened image pipeline from `PRODUCT-BULK-IO-PLAN.md` ships), bulk change sets (section 10), anything that sends email or SMS, any shipping integration (rule 14).

For "update all SEO titles" in v1 the model calls `update_product` repeatedly; the write limits bound it, and audit keeps before and after values so undo can be added later. Expectation to set with merchants: each product is one write, so the Growth daily cap (200) covers about 200 products a day.

## 6. Plan gating and permissions in code

- `aiAccessEnabled(db, tenantId)`: reads the plan's `features` JSON like `customFieldsEnabled` does (it checks `features.custom_fields`, not the plan code). A data migration sets `features.ai_access = true` on the Growth and Pro plan rows, so Super Admin can change which plans include it without code. Plus master switch on, current consent version accepted, and the `ai_access` feature flag (ADR-011: global kill switch, per-store override as Super Admin's off switch, using the existing `isFeatureEnabled`). Starter gets a clear "available on Growth" error and an upgrade prompt in the page.
- New store permission `ai.manage` (capability family under ADR-020, owner and admin) guards the settings page and its API. Added to `STORE_PERMISSIONS`, support-session deny lists (support staff cannot change AI access), and the admin role seeds.
- New Actor variant `{ type: "agent", userId, connectionId }`. There are 8 places in `packages/domain` that write `ctx.actor.type === "staff" ? "staff" : "system"`; they are changed so agent writes show as `actor_type = "agent"` with `actor_id` = the approving user. `audit_logs.diff` (jsonb) carries `before`, `after`, `connectionId` and `via`.
- Lifecycle rules: plan downgrade below Growth pauses connections (not deleted; they resume on upgrade); removing a staff member, resetting their password or disabling their account revokes their connections; a read-only store (`isAdminReadOnly`) refuses AI writes.
- Sign-in return: `login.tsx` has no return-path support today. Phase 1a adds a `returnTo` parameter that accepts only internal admin paths (open-redirect safe), including after Google sign-in, so the authorize flow comes back to the authorize screen.
- Isolation suite: each new `admin.ai.*` procedure is mapped in `packages/domain/test/isolation.int.test.ts` (AGENTS.md section 4), and the new settings nav label gets its e2e selector.
- Admin API (contracts first): `admin.ai.settings.get/update`, `admin.ai.connections.list/revoke`, `admin.ai.usage.get`. Every settings change and revoke writes `audit_logs` (rule 6).

## 7. Usage limits (Notion-style)

Behaviour the user sees: when a limit is hit the AI gets a plain message such as "AI access limit reached for this store. It resets in 12 minutes" (Claude relays it), the HTTP response is `429` with `Retry-After`, and the Connection tab shows the same.

| Limit | Default (Growth) | Default (Pro) | Window |
|---|---|---|---|
| Calls per connection | 60 | 120 | per minute |
| Calls per store (all connections) | 120 | 300 | per minute |
| Write calls per store | 20 | 60 | per minute |
| Report calls (`get_sales_summary`, stats) per store | 10 | 30 | per minute |
| Calls per store per day | 3,000 | 15,000 | per day, resets at 00:00 in the store's time zone |
| Write calls per store per day | 200 | 1,000 | per day |

- Numbers are accepted starting values. They live in the existing quota tables (`quota_definitions` rows with `tier_m` for Growth and `tier_l` for Pro, resolved by `resolveTenantQuota`; Growth is M and Pro is L in `plan-tiers.ts`; the `QuotaKey` type in `system/rate-limit.ts` is extended), not in code, so Super Admin can tune them per tier or per store without a deploy. New keys: `ai.calls.min.conn`, `ai.calls.min.store`, `ai.writes.min.store`, `ai.reports.min.store`, `ai.calls.day.store`, `ai.writes.day.store`.
- Counters use the existing `checkRateLimit` (atomic **fixed-window** counters in `rate_limit_counters`; it already returns `retryAfter`, which becomes the `Retry-After` header). The daily window key includes the store-local date, so it resets at local midnight. Reads fail open with a "try again" message if the counter store is down; writes and token checks fail closed (ADR-013).
- Hard bounds regardless of limits: page size 50, response size about 25 KB, report range 92 days, `SET LOCAL statement_timeout = '5s'` inside report reads (a small new helper in the domain read path). The report rate limit replaces the earlier "one running report per store" idea, which needed a new locking mechanism.
- Abuse protection: repeated denied or invalid calls (for example 20 forbidden calls in a minute) pause the connection for 10 minutes; Super Admin has a "revoke all AI access for this store" action (writes `platform_audit_logs`) and a global kill switch (ADR-011 feature flag).
- Scale sizing to load-test: 10,000 connected stores, 5% active at once, one call per 5 seconds, about 100 requests per second average, 3x bursts.
- Split trigger: move the adapter to its own container (`apps/mcp`) when MCP uses more than about 10% of web CPU or storefront p95 moves during an agent load test. Because the adapter is a library (`packages/mcp`), this is a deployment change, not a rewrite.

## 8. Is `/api/mcp` on the existing host safe?

Yes, with these controls required (acceptance criteria for Phase 1). Risks considered and how each is closed:

| Risk of sharing the host | Control |
|---|---|
| Staff cookie is scoped to the root domain and would be sent to `/api/mcp` (ambient credentials, CSRF-style abuse) | The MCP route **ignores cookies entirely** and accepts only `Authorization: Bearer`. A test sends a valid staff cookie with no token and expects 401. |
| Browser pages calling the endpoint cross-origin, DNS rebinding | Validate `Origin` **only when one is present**: allow `https://claude.ai` and `https://claude.com`, reject any other; requests with no `Origin` (server to server) pass. Anthropic lists overly strict Origin checks as a cause of connection timeouts, so this is tested against the real connector. No CORS headers for other sites. |
| Endpoint reachable on merchant custom domains and storefront hosts | Serve only on the platform root host (same pattern as the `/signup` and `/api/saas/` rule S6 in `middleware.ts`); other hosts get 404. |
| Storefront gate (maintenance, suspended, unknown host) blocking or confusing the API | Add `/api/mcp`, `/api/oauth/` and `/.well-known/oauth-*` to the gate's bypass list in `apps/web/src/middleware.ts` (ADR-014 decision 7), and let the endpoint decide per store (a suspended store's connections return a clear "store unavailable"). |
| Resource contention with the storefront | Separate rate-limit buckets and hard output bounds (section 7); load test before launch; documented split trigger. |
| A bug in MCP code affecting checkout | Adapter is isolated in `packages/mcp`; kill switch removes the route's effect at once; real-database cross-tenant tests gate every PR. |
| Token theft | Hashed storage, 1-hour access tokens, rotating refresh with reuse detection, PKCE, audience binding, instant revoke (checked per call, cached 30 s at most). |
| Confused deputy | The MCP token is never forwarded; calls run as the approving user with intersected permissions. |
| Prompt injection from store text | No outward-sending tools, no URL fetch in v1, marked data fields, matrix ceiling, write caps, audit with before and after. |
| Secrets | Never in tool output (rule 7); logs hold tool name, status and duration only. |

Residual risk: web and MCP share one process until the split trigger fires. That is acceptable at launch scale and is monitored.

## 9. Phases and acceptance criteria

Each phase is a separate PR chain with change record, ARCHITECTURE update and the verification gate (AGENTS.md section 4).

**Phase 0: spike and decisions (2 to 3 days, throwaway).** Verify the current MCP spec revision; choose the OAuth server approach (Better Auth 1.7.14 here has no OAuth provider plugin installed, so compare an official Better Auth OAuth provider package, if one exists for this version and supports PKCE, DCR, CIMD, refresh rotation and resource indicators, against a small custom server); pick and pin the MCP SDK version; a hello-world `/api/mcp` tool that Claude's custom connector can add and call, **including the full OAuth sign-in on claude.ai web and in Claude Code (the section 14 checklist is the spike's pass criteria)**. *Done when:* ADR-050 accepted and the OAuth approach chosen.

**Phase 1a: connect end to end (one slice).** Tables and grants; OAuth endpoints and metadata; authorize screen and sign-in `returnTo`; `store_ai_settings` with the enable consent; Connection tab (switch, consent dialog, URL and steps, connections with revoke, Setup check); plan feature and kill switch; middleware bypass and root-host restriction; `agent` actor; MCP adapter with one tool, `get_store_overview`. *Done when:* the section 14 checklist passes (MCP Inspector plus a real Claude connection on claude.ai web, Claude Desktop and Claude Code); a Starter store is refused; revoke blocks the next call; cookie-only, wrong-host and bad-`Origin` requests are rejected; the cross-tenant token test passes on a real database; S1, S1b, S3 and S4 match the approved mockups in light, dark and 375 px.

**Phase 1b: permissions, limits and read tools.** Permissions tab and matrix; policy engine; quota keys and 429 handling with the usage meter; abuse pause; connection notifications (S5); `getSalesSummary` domain service; all read capabilities in section 5. *Done when:* Claude answers "orders today", "low stock", "sales last 30 days" and "profit last month" on a seeded store; toggling a cell off removes the tool from `tools/list` and blocks the next call; hitting a limit returns 429 with `Retry-After` and the message, and the meter shows it; all tests in section 11 pass; the agent load test shows no storefront regression.

**Phase 2: draft writes, publish, archive.** `create_product`, `update_product`, `update_variant`, `set_inventory`, collection writes, publish with its extra toggle, `archive_product`, idempotency keys, write limits. *Done when:* every write has an `agent` audit row with before and after; publish rules enforced; cache tags invalidated after commit; a merchant creates, edits SEO for and publishes a product from a Claude chat on staging; hostile product text cannot trigger a write outside the matrix.

**Phase 3 and beyond (on demand):** image by URL, change sets and undo, order writes, per-connection scope narrowing, merchant-lowerable limits, CIMD from hosts beyond Claude's, ChatGPT and Gemini CLI verification, split to `apps/mcp`, MCP Apps cards, shopper-side agent commerce (UCP) as its own plan.

## 10. Designed now, built later: change sets (bulk)

Later design: `propose_bulk_change` (up to 200 `{id, values}` items validated and stored with before and after, nothing written), approval in chat or admin, `apply_change_set` as a pg-boss job (one transaction per item, audit per item), `undo_change_set` for unchanged items. It becomes one more capability in L2 with its own matrix cell, so nothing in v1 needs rework.

## 11. Test plan

- Real database (`*.int.test.ts`): cross-tenant matrix for every capability; matrix ANDed with user permission (demoted user loses access); Starter store refused; token expiry, rotation, reuse detection, revoke; limits and reset; cookie-only request rejected; wrong host and bad `Origin` rejected; new tenant tables pass the RLS suite; the platform-scoped token tables expose only the granted columns to `app_rw` (grants suite); lifecycle rules (plan downgrade pauses, staff removal and password reset revoke, read-only store refuses writes); consent version bump pauses calls; `archive_product` never removes the row.
- Unit: policy engine truth table, output shaping and size caps, annotation correctness, masking.
- Security: injection test set (hostile product names, reviews, order notes), audit-coverage test extended for the agent actor.
- Compatibility: manual Claude custom connector walkthrough recorded as a `test` change record; ChatGPT and Gemini CLI later.
- Load: agent load at the section 7 sizing with storefront p95 measured alongside.

## 12. ADR-050 outline

Context: merchants want AI assistants to run their store; no confirmed official hosted, consent-scoped merchant MCP exists elsewhere. Decision: layered design (L1 domain, L2 protocol-neutral capability layer with policy engine, L3 policy and identity data, L4 OAuth, L5 MCP adapter at `/api/mcp` on the root host); Growth-and-above gating; store-level permission matrix as a ceiling intersected with the approving user's permissions; delete means reversible only; finance is read-only, customers are read-only including contact details, data import/export is excluded; token tables are platform-scoped with narrow `app_rw` grants (like `support_sessions`) while connections and settings are tenant tables; plan access comes from `plans.features.ai_access`; Notion-style limits from quota tables; `agent` actor with before and after audit; no outward-sending tools; bulk deferred behind a change-set design. Consequences: new tables and grants, permission, actor type, quota keys, two new dependencies (MCP SDK, and an OAuth server library or custom code), middleware change, login `returnTo`, split trigger. Alternatives: Code Mode (wrong fit, needs a code sandbox, conflicts with ADR-010), one server per store (heavy), pasted API keys (no consent or revoke), OpenAPI-to-MCP conversion (hundreds of low-level tools), per-connection scope picking in v1 (more UI, little value yet).

## 13. Remaining questions

Everything earlier is answered (section 1). What is left:

1. **Legal wording:** the consent text in section 3.3 and the AI access terms page need your legal adviser. Also needed: the exact legal name of the platform company to put in the text.
2. **Customer privacy notice:** whether stores should be told to add an AI line to their own privacy notice (the consent dialog tells them they are responsible; a ready-made sentence in the page makes it easy).
3. **Extra confirm** when switching on Customers read or Finance read for the first time: keep or drop?

## 14. Claude connection and authentication checklist (must all pass)

Researched 2026-11-21 from Anthropic's connector developer docs (`claude.com/docs/connectors/building/*`), the support guide, Anthropic's published IP ranges and the `anthropics/claude-ai-mcp` issue tracker. Re-verify in Phase 0; Anthropic changes this surface often, and the cached pages read may be stale.

**What Claude supports:** MCP authorization spec revisions 2025-03-26, 2025-06-18 and 2025-11-25; Streamable HTTP (legacy SSE is deprecated); RFC 9728 protected resource metadata (required); RFC 8414 authorization server metadata with OpenID discovery as a fallback; Dynamic Client Registration (RFC 7591); Client ID Metadata Documents (CIMD); PKCE with S256 (mandatory). Not supported: `client_credentials`. Sources disagree on whether Claude sends the RFC 8707 `resource` parameter (the troubleshooting page says it does; the auth page does not mention it), so **our server accepts `resource` when present, requires it to equal our MCP URL, never requires it, and always issues tokens whose audience is the MCP URL.**

**Checklist (each line is an acceptance test):**
1. **URL:** `https://<root>/api/mcp`, standard port 443, **no redirect of any kind** (no trailing-slash, www or host redirect; Next.js trailing-slash handling is tested on the exact URL). Anthropic reports "server URL redirects to a different host" as an auth failure cause.
2. **401 challenge:** an unauthenticated request returns `401` with `WWW-Authenticate: Bearer resource_metadata="https://<root>/.well-known/oauth-protected-resource/api/mcp"`. The URL is **absolute** (relative values are silently rejected per Anthropic's tracker). A root `/.well-known/oauth-protected-resource` fallback also answers.
3. **Protected resource metadata:** `resource` equals the MCP URL exactly (including the path); `authorization_servers` lists our issuer; `scopes_supported` includes `offline_access`.
4. **Authorization server metadata** at `/.well-known/oauth-authorization-server` (plus an `/.well-known/openid-configuration` fallback): `issuer` is the identical string everywhere; `code_challenge_methods_supported: ["S256"]`; `registration_endpoint` present; `client_id_metadata_document_supported: true` with `"none"` in `token_endpoint_auth_methods_supported` (Claude only uses CIMD when both are advertised, otherwise it falls back to DCR; both paths are tested).
5. **Redirect URIs:** accept exactly `https://claude.ai/api/mcp/auth_callback` (the list is configuration, so `https://claude.com/api/mcp/auth_callback` or later domains are a config change) and, for Claude Code, loopback `http://localhost` and `http://127.0.0.1` callbacks **with any port**. Every other redirect URI is rejected unless registered (open-redirect protection).
6. **Endpoints:** `/register` takes `application/json`; `/token` takes `application/x-www-form-urlencoded`; PKCE S256 verified; authorization codes single-use and valid 60 seconds, bound to the redirect URI and code challenge; refresh tokens **rotate in the same response that invalidates the old one**; an invalid or reused refresh token returns `invalid_grant`; access tokens last 1 hour (Claude refreshes on 401 and about 5 minutes before expiry). Discovery, registration and token endpoints answer in under 10 seconds (refresh under 30).
7. **Network path:** Anthropic's connector traffic, including discovery and token calls, comes from `160.79.104.0/21` and `153.61.208.0/20` (current list: platform.claude.com/docs/en/api/ip-addresses; five older addresses are phased out). Bot protection or a WAF in front of our domain that challenges or blocks these ranges on `/api/mcp`, `/api/oauth/*` and `/.well-known/*` makes the connection fail with a 403 our app never generated. **Adding a Cloudflare skip rule for those paths is a Cloudflare configuration change and needs the owner's explicit yes** (AGENTS.md section 5); it is listed in the runbook and checked in the Setup check below.
8. **Do not gate on `clientInfo`** (Claude identifies as `claude-ai`, `Anthropic` or `claude-code`). Tool results stay far below Claude's 150,000-character cap (ours is about 25 KB); tool calls finish well inside the 240-second timeout.
9. **Reference ids:** the merchant help text tells them to quote the `ofid_...` reference shown in Claude's error message when contacting support, and our logs record request ids for every step of the OAuth sequence (authorize, consent, token, first MCP call), never secrets.

10. **Protocol version:** Claude's documented authorization support goes up to 2025-11-25, so we implement 2025-06-18 and 2025-11-25 behaviour (and accept 2025-03-26), with the SDK's Streamable HTTP transport in **stateless mode** (no session id; `GET` on `/api/mcp` returns 405). Nothing depends on the 2026-07-28 revision; adopt it when Claude does.
11. **CIMD safety:** a CIMD `client_id` is a URL we must fetch, which is an outbound request (server-side request forgery risk). In v1 we fetch CIMD documents only from allowlisted hosts (`claude.ai`, `claude.com`, others later by configuration), https only, 5-second timeout, 64 KB cap, cached. Other clients use DCR.
12. **DCR hygiene:** `/register` is rate-limited per IP (for example 10 per hour), accepts only allowlisted redirect URIs, and clients unused for 30 days are pruned by the maintenance job.
13. **Loopback clients** (Claude Code and other local apps) are labelled on the authorize screen as "an app on this computer, such as Claude Code", because their name is self-declared.
14. **Token format:** opaque random tokens with recognisable prefixes (`bsat_` access, `bsrt_` refresh), stored only as SHA-256 hashes, so a leaked token is caught by secret scanning (add a custom pattern to the repo's push protection).
15. **No body logging:** request logging skips bodies and `Authorization` headers on `/api/mcp` and `/api/oauth/*`.

**Validation before every release:**
- `npx @modelcontextprotocol/inspector --cli https://<root>/api/mcp --transport http --method tools/list` (with a test token) in a script under `scripts/`.
- A recorded manual run: add the connector in claude.ai web (Pro or Max path), in Claude Desktop, and with `claude mcp add --transport http bsec https://<root>/api/mcp` in Claude Code; revoke and reconnect; let a token expire and confirm silent refresh. Result goes in a `docs/changes/` record of type `test`.
- Re-run monthly and whenever Anthropic's connector docs change.

**Merchant-side steps shown in the Connection tab** (copy to confirm against live Claude UI before launch):
- Pro or Max: Customize > Connectors > Add custom connector > paste the URL > in the OAuth step keep **Use Claude's published identity (Recommended)** > Connect > sign in to bsec and approve.
- Team or Enterprise: a workspace Owner adds it in Organization settings > Connectors > Add > Custom > Web; each member then clicks Connect.
- Free Claude accounts allow one custom connector.
- A collapsed "For developers" note shows the Claude Code command.
- If sign-in fails: the three most likely causes with fixes (popup blocked; signed in to the wrong store or without permission; connector says "Reconnect" so run through sign-in again), and the Setup check.

**Setup check (Connection tab):** a server-side self-test of what Claude needs from us: MCP URL answers 401 with an absolute `resource_metadata` header, protected resource metadata and authorization server metadata parse and agree on issuer and resource, S256 and CIMD fields present, no redirect on the MCP URL. Shows green ticks or the first failing step in plain language. Cheap to build and it catches most of the failures seen in Anthropic's tracker before a merchant does.

## 15. Screens and design (follow `docs/admin-ui-standards.md` and the admin theme)

Rules for all screens: components only from `@bs/ui` and the admin settings kit (`SettingsPageFrame`, `SettingsCard`, `Switch`, `Badge`, `EmptyState`, `ConfirmDialog`, `ScrollTabs` or `Tabs`, `Field`, `StatusBadge`, `toast`); semantic tokens only (no hex, no inline styles, no bare borders: `border border-border`, dividers `border-border/60`); Geist type scale from section 4 of the standards; both light and dark with white cards on the grey canvas and elevated dark cards; every route declares a `pendingComponent` (`PageSkeleton` for settings, `AuthCardSkeleton` for the consent screen; hard rule 11); usable at 375 px; no native selects or `window.confirm`; toggles have accessible names such as "Products, Read". New nav label "AI access" is added to the settings navigation, and the e2e selectors for the sidebar are updated in the same change (AGENTS.md section 4).

**S1. Settings > AI access > Connection** (`/settings/ai-access`, `SettingsPageFrame` with tabs Connection and Permissions; search param `?tab=`)
```
AI access                                             [ Switch: Enabled ]
Let an AI assistant such as Claude help run your store.
-- SettingsCard: Connect Claude ---------------------------------------
 Connector URL  [ https://<root>/api/mcp                     ] [Copy]
 1. In Claude, open Customize > Connectors > Add custom connector.
 2. Paste the URL above and press Add.
 3. Press Connect, sign in to your store and approve.
 > Team plan or Claude Code? (collapsed)           [Check my setup]
-- SettingsCard: Status ------------------------------------------------
 Claude          Approved by you · Connected 21 Nov · Last used 2 min ago  [Revoke]
 (empty: EmptyState "No AI apps connected yet")
-- SettingsCard: Usage today -------------------------------------------
 Calls 214 of 3,000   Writes 12 of 200   Resets in 9 h      [banner if a limit is hit]
 Note: bsec does not store what your AI reads. It goes to your AI provider.
```
Starter plan: the whole page shows one `EmptyState` with an "Upgrade to Growth" button (same pattern as custom fields). Staff without `ai.manage`: read-only notice "Ask the store owner". Disabled switch: the other cards are shown dimmed with "Turn on AI access to connect".

**S1b. Enable consent dialog:** pressing the Enable switch opens a `Dialog` with the section 3.3 text, a checkbox and the two buttons; the switch only turns on after acceptance. Sections of the text are rendered as a short bulleted list in `text-sm`, the customer-details line in `font-medium`, buttons per the standards (md, rectangular). On phones it becomes a full-height sheet with a sticky footer for the buttons.

**S2. Permissions tab**
```
-- SettingsCard: What AI can do ----------------------------------------
                         Read   Write  Delete
 Products                 [on]   [on]   [off]     Allow publishing [off]
 Collections              [on]   [on]   [ - ]
 Customers (incl. contact) [on]   -      -
 Orders                   [on]  Coming soon  -
 Analytics                [on]    -      -
 Finance (read only)      [off]  locked locked
 [Read-only preset]                          Changes apply immediately.
```
Table-like grid built from the shared table tokens (`bg-muted/40` header, `border-border/60` rows, tabular alignment); cells with no tool yet show a muted "Coming soon" badge; locked cells show a lock icon with a tooltip; on phones each row becomes a stacked card with its three switches. A short "Delete means archive; nothing is permanently deleted" note sits under the card. Each change saves immediately with a `toast` and an audit row.

**S3. Authorize screen** (`/oauth/authorize?request=<id>` in the admin app, outside the store layout, built on `AuthShell` like `login.tsx`, so it matches the sign-in look in light and dark)
```
[bsec logo]
 Connect "Claude" to your store?
 claude.ai  (app name is supplied by the app and not verified by bsec)
 Store  [ Aarav Boutique  v ]        (picker only if you belong to several)
 Claude will be able to:
   ✓ View products, collections, orders, customers (incl. contact details), sales
   ✓ Create and edit products and collections (drafts)
   ✗ Publish, delete, change settings, move money
 It acts as you (Priya, Owner). You can change this or disconnect any time in Settings > AI access.
 [ Cancel ]                                   [ Approve and connect ]
```
Flow: Claude opens our `/api/oauth/authorize`; the server validates client, redirect URI and PKCE, stores a short-lived request, and redirects to this screen. Not signed in: sign in through the normal admin login, then return here (`returnTo`). Approve sends the browser to the registered redirect URI with the code; Cancel sends `access_denied`. The list of abilities is generated from the live Permissions matrix, so it never drifts. States: AI access off or Starter plan (explains and links to the right place, or says who can fix it); user lacks `ai.manage` ("Ask the owner"); expired or unknown request ("This link expired. Go back to Claude and press Connect again."); a redirect URI that is not on the allowlist (hard error, no redirect). The consent page sets `frame-ancestors 'none'` (clickjacking) and shows the redirect host so a look-alike app is visible.

**S4. Revoke dialog:** `ConfirmDialog` "Disconnect Claude? It stops working immediately. You can connect again any time."

**S5. Notifications:** a new notification event `ai.connection.created` and `ai.connection.revoked` (in-app and email to owner and admins, via the notification manager, ADR-039) so a new connection is never silent.

**S6. Limit reached:** the Connection tab shows an inline alert ("AI limit reached. Resets in 12 minutes") and the AI gets the same sentence as a tool error with `Retry-After`.

Design deliverables before build: a short mockup pass for S1 to S3 in light, dark and 375 px (owner review), then the build follows the approved mockups; Phase 1 acceptance includes a walkthrough with screenshots of each state.

## 16. Verification against the code (2026-11-21)

What was checked in the repository, and what changed in this plan as a result:

| Checked | Found | Change made |
|---|---|---|
| `deleteProduct` | Permanently deletes the product row | `archive_product` uses `updateProduct` with status `archived`; the hard-delete service is never exposed |
| `deleteCollection` and collection schema | Permanent delete; `collections.published` defaults to true | Collections delete is "Coming soon"; `create_collection` sets `published = false` |
| Product pricing | Prices live on variants (`updateVariant`) | Added `update_variant` |
| Images by media id | The model has no way to find media ids | Added `list_media` over the existing `listMedia` |
| Analytics | No analytics service; `analytics.read` is unused | Phase 1b adds `getSalesSummary` to the domain |
| Finance | `getProfitAndLoss` and `listExpenses` exist | Tools map to them directly |
| Orders, customers, inventory | `listAdminOrders`, `getAdminOrderDetail`, `getAdminOrderStats`, `listAdminCustomers`, `getAdminCustomerDetail`, `listInventoryLevels`, `adjustInventory` exist | Tools map to them |
| Plan gating | `customFieldsEnabled` reads `plans.features.custom_fields`, not the plan code | AI access uses `plans.features.ai_access` (data migration for Growth and Pro) |
| Quotas | `quota_definitions` uses `tier_xs..tier_l`; `QuotaKey` is a closed union; `checkRateLimit` is fixed-window and returns `retryAfter` | Text corrected (no "sliding"); keys added to the union |
| Token lookup before tenant | `support_sessions` is a platform-scoped table read by token hash, with narrow `app_rw` grants (migration 0014) | Token, client and authorization-request tables follow that pattern; the grant change goes in ADR-050 |
| Idempotency | `idempotency_keys` tenant table exists | Reused |
| Audit | `audit_logs.diff` is jsonb; 8 services map non-staff actors to "system" | Before and after go in `diff`; the 8 mappings are fixed |
| Sign-in return | `login.tsx` has no `returnTo` | Added to Phase 1a |
| Libraries | Better Auth 1.7.14 is installed **without** an OAuth provider or MCP plugin; `@modelcontextprotocol/sdk` is present only as a transitive dependency of the shadcn CLI | Phase 0 picks the OAuth server approach (an official Better Auth OAuth provider package if one fits, else a small custom server) and adds the MCP SDK as a direct, exactly pinned dependency, justified in the change record |
| Claude protocol support | Claude's documented auth support stops at 2025-11-25 | Checklist item 10: no dependency on 2026-07-28 |
| ADR number | Highest is ADR-042 | ADR-050 is free |
| Internal consistency | ADR outline still said "customers basic"; Orders and Collections cells disagreed with the wireframe; Phase 1 was too big for one slice | Fixed; Phase 1 split into 1a and 1b |

Also improved (not code findings): the overview tool respects the matrix; `tools/list` is filtered by the matrix; only `ai.manage` users can approve; lifecycle rules (downgrade, staff removal, read-only store); CIMD fetch allowlist; DCR hygiene; loopback labelling; token prefixes; no body logging; the merchant expectation for the daily write cap.

Still to verify in Phase 0 (cannot be settled by reading code): the live Claude connector behaviour and screens, the current MCP spec revision, the OAuth library choice, whether `tenant_size_tiers` always follows the plan (Growth to M, Pro to L) so limits resolve correctly, and whether Cloudflare's bot or firewall settings block Anthropic's IP ranges (the owner's yes is needed before changing Cloudflare).

## 17. Build status (2026-11-21, branch `feat/ai-access-mcp`)

Built and tested locally against the seeded demo store: Phase 0 (decisions: custom OAuth server because Better Auth 1.7.14 has no OAuth provider plugin installed; MCP SDK 1.32.2 pinned, stateless), Phase 1a, Phase 1b and Phase 2 as one change set. ADR-050 is Accepted. What exists is described in `docs/ARCHITECTURE.md` section 24.

**Differences from this plan (all on purpose):**
- ADR number is 050 (043 to 049 were taken meanwhile).
- `get_sales_summary` wraps the analytics reports that were built in the meantime (ADR-047), so no new analytics service was needed.
- `list_low_stock` became `list_inventory` (search, low or out of stock); added `list_categories` and `list_media` (needed to publish and attach images), `get_order_stats`, `update_variant`.
- Matrix cells with no tool yet (collections delete, orders write) show "Soon"; the "Allow publishing" switch also covers publishing a collection.
- A reused refresh token or authorization code revokes the connection itself, not only its tokens.
- Added "Changes made by AI" (from the audit log, with before and after) and a recent calls list to the Connection tab.
- The extra confirmation when switching on Customers or Finance read was not built (it was an open question).
- Order tools hide customer contact details unless Customers read is also on (the plan only said so for customer tools).

**Not built yet:** Claude connector test from a real public HTTPS address (needs the Cloudflare rule and a deployed address; only the local flow and our own checks were run), ChatGPT and Gemini, image by URL, bulk change sets and undo, order and customer writes, notification events for a new connection (S5), scheduling of the retention jobs, the AI terms page and legal review of the consent wording, the AI access section in Super Admin (the existing Features page can switch the `ai_access` flag off globally or per store, which is the kill switch).

## Sources

- Shopify agents overview: https://shopify.dev/docs/agents ; Shop MCP: https://shopify.dev/docs/agents/shop-mcp ; agent profiles: https://shopify.dev/docs/agents/profiles
- Shopify Storefront Catalog MCP: https://shopify.dev/docs/agents/catalog/storefront-catalog ; migration notice: https://shopify.dev/docs/apps/build/storefront-mcp
- Shopify AI Toolkit: https://shopify.dev/docs/apps/build/ai-toolkit and https://github.com/Shopify/shopify-ai-toolkit
- Shopify Universal Commerce Protocol: https://www.shopify.com/ucp
- Community Shopify MCP server: https://github.com/geli2001/shopify-mcp
- Notion MCP rate limits: https://developers.notion.com/guides/mcp/rate-limits ; request limits: https://developers.notion.com/reference/request-limits
- MCP authorization: https://modelcontextprotocol.io/specification/draft/basic/authorization
- MCP client registration (CIMD, DCR): https://modelcontextprotocol.io/specification/latest/basic/authorization/client-registration
- MCP security best practices: https://modelcontextprotocol.io/specification/latest/basic/security_best_practices
- MCP tool annotations: https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/ ; 2026 roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- OWASP MCP Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
- Claude custom connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Claude connector developer docs (authentication, testing, troubleshooting, directory): https://claude.com/docs/connectors/building , https://claude.com/docs/connectors/building/authentication , https://claude.com/docs/connectors/building/troubleshooting , https://claude.com/docs/directory/publish
- Anthropic IP addresses: https://platform.claude.com/docs/en/api/ip-addresses
- Known connector auth issues (tracker): https://github.com/anthropics/claude-ai-mcp/issues
- Gemini CLI MCP servers: https://www.geminicli.com/docs/tools/mcp-server
- Production MCP guidance: https://thenewstack.io/15-best-practices-for-building-mcp-servers-in-production/
