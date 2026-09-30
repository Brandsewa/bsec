import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { hashPassword, verifyPassword } from "@bs/auth";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  createRuntime,
  type Runtime,
  provisionTenant,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let platformDb: DbHandle;
let rtPlatform: Runtime;

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
  platformDb = createDb(as("app_platform", PW.platform), { max: 10 });
  rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 10 });
}, 180_000);

afterAll(async () => {
  await platformDb?.close();
  await rtPlatform?.close();
  await container?.stop();
});

describe("B1: Signup account takeover prevention", () => {
  it("never modifies victim's password or emailVerified when an attacker signs up with victim email", async () => {
    const victimEmail = "victim@company.com";
    const originalPassword = "VictimOriginalPassword123!";
    const originalHash = await hashPassword(originalPassword);

    // 1. Seed existing victim user with unverified email and original password
    const [victim] = await platformDb.db
      .insert(schema.users)
      .values({
        email: victimEmail,
        name: "Victim User",
        emailVerified: false,
      })
      .returning({ id: schema.users.id });
    expect(victim).toBeDefined();

    await platformDb.db.insert(schema.accounts).values({
      id: randomUUID(),
      userId: victim!.id,
      accountId: victim!.id,
      providerId: "credential",
      password: originalHash,
    });

    // 2. Attacker attempts self-service signup using victim's email and a new attacker password
    const attackerPassword = "AttackerStolenPassword999!";
    const slug = "victim-store-takeover";

    await provisionTenant(rtPlatform, {
      storeName: "Victim Impersonated Store",
      slug,
      owner: {
        email: victimEmail,
        name: "Attacker Impersonator",
        password: attackerPassword,
      },
      source: "self_service",
    });

    // 3. Assert victim's password hash in the accounts table has NOT changed
    const accountRows = await platformDb.db.execute<{ password: string }>(sql`
      SELECT password FROM accounts WHERE user_id = ${victim!.id} AND provider_id = 'credential';
    `);
    expect(accountRows.rows.length).toBe(1);
    const currentHash = accountRows.rows[0]!.password;

    // Attacker's password must NOT match victim's account
    const attackerVerified = await verifyPassword({ hash: currentHash, password: attackerPassword });
    expect(attackerVerified).toBe(false);

    // Victim's original password must still match
    const victimVerified = await verifyPassword({ hash: currentHash, password: originalPassword });
    expect(victimVerified).toBe(true);

    // Victim's emailVerified must NOT have been artificially flipped to true
    const userRows = await platformDb.db.execute<{ email_verified: boolean }>(sql`
      SELECT email_verified FROM users WHERE id = ${victim!.id};
    `);
    expect(userRows.rows[0]!.email_verified).toBe(false);

    // An owner invite must have been created for the victim to complete setup
    const inviteRows = await platformDb.db.execute<{ id: string; email: string }>(sql`
      SELECT id, email FROM tenant_owner_invites WHERE email = ${victimEmail};
    `);
    expect(inviteRows.rows.length).toBeGreaterThan(0);
  });
});
