import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  checkSubdomainAvailability,
  reserveSubdomain,
  saveSignupLead,
  hashIpWithSalt,
  checkReserveSubdomainRateLimit,
  checkLeadCaptureRateLimit,
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

describe("S3: Slug reservations & Lead ownership verification", () => {
  it("allows the owning lead to re-check and refresh their reservation, but blocks other leads", async () => {
    const slug = "artisan-pottery-s3";

    // Create real leads with valid UUIDs
    const { leadId: leadA } = await saveSignupLead(rt._db.db, {
      email: "leada@example.com",
      desiredSlug: slug,
      step: "subdomain_selected",
    });
    const { leadId: leadB } = await saveSignupLead(rt._db.db, {
      email: "leadb@example.com",
      desiredSlug: slug,
      step: "subdomain_selected",
    });

    // 1. Lead A reserves the slug
    const resA = await reserveSubdomain(rt._db.db, slug, leadA);
    expect(resA.success).toBe(true);

    // 2. Lead A checks availability for the same slug -> should be available to Lead A
    const checkA = await checkSubdomainAvailability(rt._db.db, slug, leadA);
    expect(checkA.available).toBe(true);

    // 3. Lead B checks availability -> must NOT be available to Lead B
    const checkB = await checkSubdomainAvailability(rt._db.db, slug, leadB);
    expect(checkB.available).toBe(false);
    expect(checkB.reason).toMatch(/temporarily reserved/i);

    // 4. Lead B attempts to reserve -> must fail
    const resB = await reserveSubdomain(rt._db.db, slug, leadB);
    expect(resB.success).toBe(false);

    // 5. Lead A re-reserves to extend -> succeeds
    const resAExtend = await reserveSubdomain(rt._db.db, slug, leadA);
    expect(resAExtend.success).toBe(true);
  });

  it("hashes IP addresses with salt and does not store plaintext IP", () => {
    const ip = "203.0.113.42";
    const hash = hashIpWithSalt(ip);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(ip);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("enforces rate limits on subdomain reservations and lead capture", async () => {
    const testIp = "198.51.100.99";

    // Subdomain reservation rate limit
    for (let i = 0; i < 20; i++) {
      const res = await checkReserveSubdomainRateLimit(rt._db.db, testIp);
      expect(res.allowed).toBe(true);
    }
    const blockedReserve = await checkReserveSubdomainRateLimit(rt._db.db, testIp);
    expect(blockedReserve.allowed).toBe(false);
    expect(blockedReserve.retryAfter).toBeGreaterThan(0);

    // Lead capture rate limit
    for (let i = 0; i < 30; i++) {
      const res = await checkLeadCaptureRateLimit(rt._db.db, testIp);
      expect(res.allowed).toBe(true);
    }
    const blockedLead = await checkLeadCaptureRateLimit(rt._db.db, testIp);
    expect(blockedLead.allowed).toBe(false);
    expect(blockedLead.retryAfter).toBeGreaterThan(0);
  });
});
