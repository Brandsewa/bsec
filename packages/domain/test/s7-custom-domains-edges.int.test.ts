import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  provisionTenant,
  addCustomDomain,
  setPrimaryDomain,
  type CustomDomainProvider,
  type CustomHostnameResult,
  type CustomHostnameStatusResult,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let platformDb: DbHandle;
let rt: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 15 });
  platformDb = createDb(as("app_platform", PW.platform), { max: 5 });
  rt = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 15 });
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await container?.stop();
});

class MockEdgeDomainProvider implements CustomDomainProvider {
  isConfigured(): boolean {
    return true;
  }
  async createCustomHostname(hostname: string): Promise<CustomHostnameResult> {
    return {
      providerHostnameId: `cf_${hostname}`,
      hostname,
      cnameTarget: "stores.bcom.si",
      status: "awaiting_dns",
      sslStatus: "initializing",
    };
  }
  async getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameStatusResult> {
    return {
      providerHostnameId,
      hostname: "dummy",
      status: "active",
      sslStatus: "active",
    };
  }
  async deleteCustomHostname(_providerHostnameId: string): Promise<{ deleted: boolean }> {
    return { deleted: true };
  }
}

describe("S7: Custom domain edge cases & unique DB constraint", () => {
  it("enforces unique DB constraint on domains.hostname across stores and case-insensitively", async () => {
    // 1. Provision Store 1 and Store 2
    const store1 = await provisionTenant(rt, {
      storeName: "Edge Store 1",
      slug: "edge-store-1-s7",
      owner: { email: "edge1@test.local", name: "Edge One" },
      planCode: "growth", // S tier (1 custom domain)
    });

    const store2 = await provisionTenant(rt, {
      storeName: "Edge Store 2",
      slug: "edge-store-2-s7",
      owner: { email: "edge2@test.local", name: "Edge Two" },
      planCode: "growth", // S tier (1 custom domain)
    });

    const provider = new MockEdgeDomainProvider();

    // 2. Store 1 adds custom domain
    await addCustomDomain(rt, store1.tenantId, {
      hostname: "store.artisanboutique.in",
      provider,
    });

    // 3. Store 2 attempts to add same hostname (different casing) -> application error
    await expect(
      addCustomDomain(rt, store2.tenantId, {
        hostname: "STORE.ARTISANBOUTIQUE.IN",
        provider,
      }),
    ).rejects.toThrow(/already registered/i);

    // 4. Raw DB insert with duplicate hostname (citext) fails with PostgreSQL unique violation (code 23505)
    let rawError: unknown;
    try {
      await rt._db.db.insert(schema.domains).values({
        tenantId: store2.tenantId,
        hostname: "STORE.ARTISANBOUTIQUE.IN",
        type: "custom",
      });
    } catch (e: unknown) {
      rawError = e;
    }
    expect(rawError).toBeDefined();
    const pgErr = rawError as { cause?: { code?: string; constraint?: string } };
    expect(pgErr.cause?.code).toBe("23505");
    expect(pgErr.cause?.constraint).toBe("domains_hostname_unique");
  });

  it("strictly blocks setPrimaryDomain across all non-active state machine states", async () => {
    const store = await provisionTenant(rt, {
      storeName: "States Store",
      slug: "states-store-s7",
      owner: { email: "states@test.local", name: "States Owner" },
      planCode: "pro", // M tier (3 custom domains)
    });

    const nonActiveStates = ["requested", "awaiting_dns", "verifying", "ssl_pending", "failed"] as const;

    for (const st of nonActiveStates) {
      const [dom] = await rt._db.db
        .insert(schema.domains)
        .values({
          tenantId: store.tenantId,
          hostname: `test-${st}.domainstates.in`,
          type: "custom",
          status: st,
          sslStatus: "initializing",
        })
        .returning();

      await expect(setPrimaryDomain(rt, store.tenantId, dom!.id)).rejects.toThrow(
        /Only active, verified domains can be designated as primary/,
      );
    }
  });
});
