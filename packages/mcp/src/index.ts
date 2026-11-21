/**
 * The MCP adapter (ADR-050, layer L5): the only MCP-specific code. It turns the protocol-neutral capability registry into MCP
 * tools and speaks Streamable HTTP in stateless mode (no session id; one fresh server per request, so any web instance can
 * answer any request). Authentication, plan, consent, limits and the permission matrix are decided before and below this layer.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { z } from "zod";
import { capabilitiesFor, findCapability, refusalFor, runCapability } from "@bs/agent-capabilities";
import type { AgentSession, Runtime } from "@bs/domain";

/** Origins allowed to call the endpoint from a browser context. Calls with no Origin (server to server, as Claude's are) always pass. */
const ALLOWED_ORIGINS = ["https://claude.ai", "https://claude.com"];

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

export function extractBearer(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return m?.[1] ?? null;
}

/** 401 with the discovery pointer Claude needs: an ABSOLUTE resource_metadata URL (relative ones are silently rejected). */
export function unauthorizedResponse(base: string, description?: string): Response {
  const meta = `${base}/.well-known/oauth-protected-resource/api/mcp`;
  const params = [`resource_metadata="${meta}"`, ...(description ? [`error="invalid_token"`, `error_description="${description.replace(/"/g, "'")}"`] : [])];
  return new Response(JSON.stringify({ error: description ? "invalid_token" : "unauthorized", ...(description ? { error_description: description } : {}) }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": `Bearer ${params.join(", ")}`, "cache-control": "no-store" },
  });
}

function buildServer(rt: Runtime, session: AgentSession): McpServer {
  const server = new McpServer(
    { name: "brand-sewa-store", version: "1.0.0" },
    { instructions: `You are connected to the store "${session.storeName}". Call get_store_overview first. Money is in minor units (paise). Changes are recorded in the store's activity log as made by this app.` },
  );
  for (const cap of capabilitiesFor(session)) {
    const shape = (cap.input as unknown as z.ZodObject<z.ZodRawShape>).shape;
    server.registerTool(
      cap.name,
      {
        title: cap.title,
        description: cap.description,
        inputSchema: shape,
        annotations: {
          title: cap.title,
          readOnlyHint: cap.annotations.readOnly,
          destructiveHint: cap.annotations.destructive,
          idempotentHint: cap.annotations.idempotent,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        const result = await runCapability(rt, session, cap.name, args);
        if (!result.ok) {
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }] };
        }
        const content = [{ type: "text" as const, text: JSON.stringify(result.data) }];
        if (result.notice) content.push({ type: "text" as const, text: result.notice });
        return { content };
      },
    );
  }
  return server;
}

const MAX_BODY_BYTES = 256 * 1024;

/**
 * A client may call a tool it listed earlier that the store has since switched off (or never allowed). The SDK would answer
 * "tool not found"; this answers with the plain reason the AI can relay to the merchant instead.
 */
function refusedKnownTool(session: AgentSession, body: unknown): Response | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const msg = body as { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: unknown } };
  if (msg.method !== "tools/call" || typeof msg.params?.name !== "string") return null;
  const cap = findCapability(msg.params.name);
  if (!cap) return null;
  const reason = refusalFor(session, cap);
  if (!reason) return null;
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? null, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "forbidden", message: reason } }) }] } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Handles one MCP request for an authenticated AI session. Only POST is served: this adapter is stateless and has no event stream. */
export async function handleMcpRequest(rt: Runtime, session: AgentSession, req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed", error_description: "Use POST." }), {
      status: 405,
      headers: { allow: "POST", "content-type": "application/json" },
    });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413, headers: { "content-type": "application/json" } });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413, headers: { "content-type": "application/json" } });
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }), { status: 400, headers: { "content-type": "application/json" } });
  }
  const refused = refusedKnownTool(session, parsedBody);
  if (refused) return refused;

  const server = buildServer(rt, session);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req, { parsedBody });
  } finally {
    // The response is fully built (JSON mode), so the per-request server can be released.
    void server.close().catch(() => undefined);
  }
}
