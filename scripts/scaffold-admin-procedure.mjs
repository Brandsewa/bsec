#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function toCamelCase(str) {
  return str.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function toKebabCase(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function toPascalCase(str) {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

// Generate domain service code
export function generateDomainServiceCode({ router, camelName, pascalName, kebabName }) {
  return `import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { assertPermission, type Runtime, type TenantContext } from "../context.ts";

export interface ${pascalName}Input {
  id: string;
  // TODO: Add fields for input payload
}

export interface ${pascalName}Result {
  id: string;
  success: boolean;
}

/**
 * ${camelName} admin domain service.
 * Follows AGENTS.md: assertPermission, withTenant, audit log, commit-then-read.
 */
export async function ${camelName}(
  rt: Runtime,
  ctx: TenantContext,
  input: ${pascalName}Input,
): Promise<${pascalName}Result> {
  // 1. Permission check
  assertPermission(ctx, "${router}.write");

  // 2. Transactional mutation & audit log inside withTenant
  const result = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    // TODO: Perform database updates / checks

    // Write audit log
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.userId,
      action: "${router}.${kebabName}",
      entityType: "${router}",
      entityId: input.id,
      metadata: { input },
    });

    return { id: input.id, success: true };
  });

  // 3. Side effects / cache invalidation / read-back AFTER commit
  // TODO: Invalidate cache or enqueue jobs if necessary

  return result;
}
`;
}

// Generate integration test code
export function generateIntegrationTestCode({ router, camelName, pascalName, kebabName }) {
  return `import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STORE_PERMISSIONS } from "@bs/auth";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { ${camelName} } from "../src/${router}/${kebabName}.ts";

let env: TestDb;
let rt: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });

  const tA = await provisionTenant(rt, {
    storeName: "Store A",
    slug: "store-a-" + Math.random().toString(36).slice(2, 6),
    owner: { email: "owner-a@test.local", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-a",
  };

  const tB = await provisionTenant(rt, {
    storeName: "Store B",
    slug: "store-b-" + Math.random().toString(36).slice(2, 6),
    owner: { email: "owner-b@test.local", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-b",
  };
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("${camelName} integration tests", () => {
  it("executes successfully within tenant", async () => {
    const res = await ${camelName}(rt, ctxA, { id: "0199a000-0000-7000-8000-000000000001" });
    expect(res.success).toBe(true);
  });

  it("enforces cross-store tenant isolation", async () => {
    // TODO: Verify tenant B cannot mutate or access tenant A resource
    await expect(
      ${camelName}(rt, ctxB, { id: "0199a000-0000-7000-8000-000000000001" })
    ).resolves.toBeDefined();
  });
});
`;
}

// Generate snippets
export function generateSnippets({ router, camelName, pascalName, kebabName }) {
  const contractSnippet = `// In packages/contracts/src/admin.ts:
// 1. Define schema:
export const ${camelName}InputSchema = z.object({
  id: z.string().uuid(),
});
export const ${camelName}OutputSchema = z.object({
  id: z.string(),
  success: z.boolean(),
});

// 2. Add to router contract:
${camelName}: adminAuthedProcedure
  .input(${camelName}InputSchema)
  .output(${camelName}OutputSchema),
`;

  const apiHandlerSnippet = `// In apps/web/src/server/api.ts (or corresponding route handler):
${camelName}: adminAuthedProcedure.handler(async ({ input, context }) => {
  return ${camelName}(context.runtime, context.tenantContext, input);
}),
`;

  const isolationSnippet = `// In packages/domain/test/isolation.int.test.ts (case map):
"${router}.${camelName}": async (rt, ctx, targetId) => {
  return ${camelName}(rt, ctx, { id: targetId });
},
`;

  const archSnippet = `// In docs/ARCHITECTURE.md API table:
| \`${router}.${camelName}\` | \`${router}.write\` | Staff | Admin | ${camelName} procedure |
`;

  return {
    contractSnippet,
    apiHandlerSnippet,
    isolationSnippet,
    archSnippet,
  };
}

// Run CLI when executed directly
if (process.argv[1] && (process.argv[1].endsWith("scaffold-admin-procedure.mjs") || process.argv[1].endsWith("scaffold-admin-procedure"))) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const nonFlagArgs = args.filter((a) => !a.startsWith("--"));

  if (nonFlagArgs.length < 2) {
    console.log(`
Usage: pnpm scaffold:admin-procedure <router> <name> [--write]

Arguments:
  <router>   Area/domain name (e.g. orders, products, quotes, returns, customers)
  <name>     Procedure name in kebab-case or camelCase (e.g. archive-order, archiveOrder)
  --write    Write domain service and test files to disk. Without this flag, snippets are only printed.
`);
    process.exit(1);
  }

  const [routerArg, nameArg] = nonFlagArgs;
  const router = toKebabCase(routerArg);
  const rawName = nameArg;
  const kebabName = toKebabCase(rawName);
  const camelName = toCamelCase(rawName);
  const pascalName = toPascalCase(rawName);

  const serviceFileName = `${kebabName}.ts`;
  const serviceRelPath = `packages/domain/src/${router}/${serviceFileName}`;
  const serviceFullPath = join(root, serviceRelPath);

  const testFileName = `${kebabName}.int.test.ts`;
  const testRelPath = `packages/domain/test/${testFileName}`;
  const testFullPath = join(root, testRelPath);

  const serviceCode = generateDomainServiceCode({ router, camelName, pascalName, kebabName });
  const testCode = generateIntegrationTestCode({ router, camelName, pascalName, kebabName });
  const snippets = generateSnippets({ router, camelName, pascalName, kebabName });

  console.log("\n======================================================================");
  console.log(`Scaffolding procedure: ${router}.${camelName}`);
  console.log("======================================================================\n");

  if (write) {
    mkdirSync(dirname(serviceFullPath), { recursive: true });
    if (!existsSync(serviceFullPath)) {
      writeFileSync(serviceFullPath, serviceCode, "utf8");
      console.log(`✓ Created service: ${serviceRelPath}`);
    } else {
      console.log(`! Service already exists: ${serviceRelPath}`);
    }

    mkdirSync(dirname(testFullPath), { recursive: true });
    if (!existsSync(testFullPath)) {
      writeFileSync(testFullPath, testCode, "utf8");
      console.log(`✓ Created test: ${testRelPath}`);
    } else {
      console.log(`! Test already exists: ${testRelPath}`);
    }
  } else {
    console.log(`(Dry run - use --write to create files on disk)\n`);
    console.log(`--- [Service File Skeleton: ${serviceRelPath}] ---`);
    console.log(serviceCode);
    console.log(`--- [Test File Skeleton: ${testRelPath}] ---`);
    console.log(testCode);
  }

  console.log("\n======================================================================");
  console.log("Snippets to manually add to shared files (Do NOT auto-edit):");
  console.log("======================================================================\n");

  console.log(snippets.contractSnippet);
  console.log(snippets.apiHandlerSnippet);
  console.log(snippets.isolationSnippet);
  console.log(snippets.archSnippet);
}
