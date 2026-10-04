import { describe, expect, it } from "vitest";

// Dynamic import for .mjs script file in test
const { generateDomainServiceCode, generateIntegrationTestCode, generateSnippets } =
  // @ts-expect-error dynamic import of root mjs script
  await import("../../../scripts/scaffold-admin-procedure.mjs");

describe("scaffold-admin-procedure unit tests", () => {
  const params = {
    router: "orders",
    camelName: "archiveOrder",
    pascalName: "ArchiveOrder",
    kebabName: "archive-order",
  };

  it("generates correct domain service code following architecture standards", () => {
    const code = generateDomainServiceCode(params);
    expect(code).toContain("export async function archiveOrder(");
    expect(code).toContain('assertPermission(ctx, "orders.write");');
    expect(code).toContain("await withTenant(rt._db.db, ctx.tenantId, async (tx) => {");
    expect(code).toContain('action: "orders.archive-order",');
    expect(code).toContain("schema.auditLogs");
  });

  it("generates integration test skeleton with isolation test structure", () => {
    const code = generateIntegrationTestCode(params);
    expect(code).toContain('describe("archiveOrder integration tests"');
    expect(code).toContain('import { archiveOrder } from "../src/orders/archive-order.ts";');
    expect(code).toContain('it("enforces cross-store tenant isolation"');
  });

  it("generates exact snippets for the 4 shared files", () => {
    const snippets = generateSnippets(params);
    expect(snippets.contractSnippet).toContain("export const archiveOrderInputSchema");
    expect(snippets.contractSnippet).toContain("archiveOrder: adminAuthedProcedure");
    expect(snippets.apiHandlerSnippet).toContain("archiveOrder: adminAuthedProcedure.handler");
    expect(snippets.isolationSnippet).toContain('"orders.archiveOrder": async (rt, ctx, targetId)');
    expect(snippets.archSnippet).toContain("| `orders.archiveOrder` | `orders.write` |");
  });
});
