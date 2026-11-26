# Connecting Google Antigravity to a store (AI access over MCP)

Status: built on `feat/ai-antigravity` (2026-11-26). Google Antigravity (the App, the editor and the CLI) can connect to a store's AI access endpoint the same way Claude does. Nothing about permissions, limits or audit changes: the store's Settings > AI access matrix applies to every connected app (ADR-050, `docs/MCP-PLAN.md`).

## How Antigravity signs in (checked against antigravity.google/docs/mcp on 2026-11-26)

- Transport: Streamable HTTP only, which is what `/api/mcp` serves (stateless).
- Discovery: Protected Resource Metadata at `/.well-known/oauth-protected-resource` (its `resource` must equal the server URL), then the authorization server metadata. Ours advertise `client_id_metadata_document_supported: true`, `code_challenge_methods_supported: ["S256"]` and a non-empty `issuer`, which Antigravity requires.
- Client: Antigravity tries, in order, a client ID from the user's config, then its **Client ID Metadata Document** (`https://antigravity.google/oauth/client-metadata.json`, public client, `token_endpoint_auth_method: none`), then dynamic client registration. We use the CIMD path: no client ID, secret or API key is created or shared.
- Redirect: the hosted callback `https://antigravity.google/oauth-callback`. In the App the merchant pastes the code it shows into "Enter authorization code".
- Tokens: PKCE S256 and the `resource` parameter on both requests; Antigravity stores and refreshes the tokens itself (our access tokens last 1 hour, refresh tokens 30 days, rotating).

What we changed: `antigravity.google` is now an approved CIMD host and `https://antigravity.google/oauth-callback` an approved redirect address (`packages/domain/src/ai/oauth.ts`, defaults). If Coolify sets `AI_OAUTH_REDIRECT_URIS` or `AI_OAUTH_CIMD_HOSTS` explicitly, those values replace the defaults and must list the Antigravity values too.

## Merchant steps (also shown in Settings > AI access > Connection, "Google Antigravity" tab)

1. Turn on AI access and accept the terms (Growth plan or above), then set the permissions.
2. In Antigravity open the MCP server settings (App: Customizations > Installed > MCP Servers; editor: MCP Servers > Manage MCP Servers > View raw config; CLI: `~/.gemini/config/mcp_config.json`, or `.agents/mcp_config.json` in one project).
3. Add the store, using the address from the settings page:

```json
{
  "mcpServers": {
    "my-store": { "serverUrl": "https://<platform host>/api/mcp" }
  }
}
```

4. Press Authenticate, sign in to the store admin, approve, and paste the code Antigravity asks for.
5. The connection appears under Connected apps as "Google Antigravity" and can be disconnected there at any time.

## Best practices we follow (and tell merchants)

- No secrets in `mcp_config.json`: OAuth replaces API keys and bearer headers; we never issue a static token.
- Least privilege: the permission matrix is a ceiling and new rows are off; writes are saved as drafts unless the store allows publishing.
- Antigravity can run agents with little supervision; destructive tools need `confirm: true` and only touch hidden items, and every change is in the audit log as made by "Google Antigravity".
- Tool results that contain store or shopper text are marked as data, not instructions (prompt-injection guard).
- Merchants can narrow the tools further in Antigravity itself with `enabledTools` or `disabledTools`.

## Not verified

A real Antigravity sign-in against a deployed store (needs the change deployed; the hosted callback cannot reach a local machine). Tested: the full OAuth flow with Antigravity's published client metadata document on a real database (`packages/domain/test/ai-access.int.test.ts`).
