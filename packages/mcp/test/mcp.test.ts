import { describe, expect, it } from "vitest";
import type { AgentSession, Runtime } from "@bs/domain";
import { extractBearer, handleMcpRequest, isOriginAllowed, unauthorizedResponse } from "../src/index.ts";

const session = (matrix: AgentSession["settings"]["matrix"] = {}): AgentSession => ({
  ctx: { tenantId: "t", storeStatus: "live", actor: { type: "agent", userId: "u", connectionId: "c" }, roles: ["store_owner"], permissions: ["products.read", "products.write"], requestId: "r" },
  connection: { id: "c", clientName: "Claude", userId: "u" },
  settings: { matrix, allowPublishing: false },
  timezone: "Asia/Kolkata",
  currency: "INR",
  storeName: "Test",
});
// These requests are answered before the database is touched, so no runtime is needed.
const rt = {} as Runtime;
const post = (body: string) => new Request("https://root.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body });

describe("MCP adapter helpers", () => {
  it("accepts no Origin (server to server) and Claude's origins only", () => {
    expect(isOriginAllowed(null)).toBe(true);
    expect(isOriginAllowed("https://claude.ai")).toBe(true);
    expect(isOriginAllowed("https://claude.com")).toBe(true);
    expect(isOriginAllowed("https://evil.example")).toBe(false);
    expect(isOriginAllowed("https://claude.ai.evil.example")).toBe(false);
  });

  it("reads only a Bearer token from the Authorization header", () => {
    expect(extractBearer("Bearer bsat_abc")).toBe("bsat_abc");
    expect(extractBearer("bearer bsat_abc")).toBe("bsat_abc");
    expect(extractBearer("Basic abc")).toBeNull();
    expect(extractBearer("Bearer")).toBeNull();
    expect(extractBearer(null)).toBeNull();
  });

  it("the 401 carries an absolute resource_metadata address", async () => {
    const r = unauthorizedResponse("https://root.test");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://root.test/.well-known/oauth-protected-resource/api/mcp"');
    expect(r.headers.get("cache-control")).toBe("no-store");
    const withReason = unauthorizedResponse("https://root.test", 'The "token" expired');
    expect(withReason.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(withReason.headers.get("www-authenticate")).not.toContain('"token"');
  });
});

describe("MCP request handling", () => {
  it("serves POST only (the adapter is stateless and has no event stream)", async () => {
    const r = await handleMcpRequest(rt, session(), new Request("https://root.test/api/mcp", { method: "GET" }));
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("POST");
    expect((await handleMcpRequest(rt, session(), new Request("https://root.test/api/mcp", { method: "DELETE" }))).status).toBe(405);
  });

  it("rejects an unparseable body and an oversized body", async () => {
    expect((await handleMcpRequest(rt, session(), post("{not json"))).status).toBe(400);
    const big = await handleMcpRequest(rt, session(), post(JSON.stringify({ x: "a".repeat(300_000) })));
    expect(big.status).toBe(413);
  });

  it("answers a call to a tool the store has not allowed with the plain reason, not 'tool not found'", async () => {
    const r = await handleMcpRequest(rt, session(), post(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "create_product", arguments: {} } })));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { id: number; result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.id).toBe(7);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toMatch(/has not allowed AI apps to change products/);
  });

  it("lists only the tools the matrix allows", async () => {
    const r = await handleMcpRequest(rt, session({ products: { read: true } }), post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })));
    const body = (await r.json()) as { result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> } };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("list_products");
    expect(names).toContain("get_store_overview");
    expect(names).not.toContain("create_product");
    expect(names).not.toContain("list_orders");
    expect(body.result.tools.every((t) => t.annotations.readOnlyHint === true)).toBe(true);
  });
});
