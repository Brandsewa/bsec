import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { allocateSequenceNumber } from "../src/orders/sequences.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;

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
  // Create a pool with 25 connections to comfortably serve 20 parallel workers
  rwDb = createDb(as("app_rw", PW.rw), { max: 25 });

  const orgId = "0199a0c4-0000-7000-8000-000000000000";
  const tenantId = "0199a0c4-0000-7000-8000-000000000001";
  const pgClient = new (await import("pg")).default.Client({ connectionString: as("app_rw", PW.rw) });
  await pgClient.connect();
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'test-store', 'Test Store') ON CONFLICT DO NOTHING;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("PLAN §11.2 Number Sequences & Concurrency Proof", () => {
  const tenantId = "0199a0c4-0000-7000-8000-000000000001";

  it("allocates sequential formatted numbers with prefix and padding", async () => {
    const seq1 = await allocateSequenceNumber(rwDb.db, tenantId, "order", "", {
      defaultPrefix: "ORD-",
      defaultPadding: 5,
    });
    expect(seq1.raw).toBe(1);
    expect(seq1.formatted).toBe("ORD-00001");

    const seq2 = await allocateSequenceNumber(rwDb.db, tenantId, "order", "", {
      defaultPrefix: "ORD-",
      defaultPadding: 5,
    });
    expect(seq2.raw).toBe(2);
    expect(seq2.formatted).toBe("ORD-00002");
  });

  it("PLAN §11.2 Concurrency Proof: 20 parallel clients, 1,000 orders -> 1,000 unique numbers, no gaps", async () => {
    const kind = "stress_order";
    const totalWorkers = 20;
    const allocationsPerWorker = 50; // 20 * 50 = 1,000 total allocations
    const totalAllocations = totalWorkers * allocationsPerWorker;

    // Run 20 concurrent workers in parallel
    const workerPromises = Array.from({ length: totalWorkers }, async () => {
      const results: number[] = [];
      for (let i = 0; i < allocationsPerWorker; i++) {
        const seq = await allocateSequenceNumber(rwDb.db, tenantId, kind, "2026-27", {
          defaultPrefix: "ORD-2627-",
          defaultPadding: 6,
        });
        results.push(seq.raw);
      }
      return results;
    });

    const allWorkerResults = await Promise.all(workerPromises);
    const flattened = allWorkerResults.flat();

    expect(flattened.length).toBe(totalAllocations);

    // Assert uniqueness: exactly 1,000 distinct values
    const uniqueSet = new Set(flattened);
    expect(uniqueSet.size).toBe(totalAllocations);

    // Assert gapless: numbers must form exactly [1, 2, ..., 1000]
    const sorted = [...flattened].sort((a, b) => a - b);
    expect(sorted[0]).toBe(1);
    expect(sorted[sorted.length - 1]).toBe(totalAllocations);

    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i]).toBe(i + 1);
    }
  }, 60_000);
});
