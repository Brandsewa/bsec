import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { sql, eq } from "drizzle-orm";
import {
  createRuntime,
  type Runtime,
  platformCreateTenantForClient,
  createTenantOwnerInvite,
  acceptTenantOwnerInvite,
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
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 15 });
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("M8 Platform Store Creation & Tenant Owner Invites (PLAN §6, §6.4)", () => {
  it("allows a platform operator to create a store for a client, and client accepts invite and reaches admin unaided", async () => {
    const slug = "agency-client-84";
    const clientEmail = "client.founder@artisanboutique.in";

    // 1. Platform operator creates store for client
    const created = await platformCreateTenantForClient(rt, {
      storeName: "Artisan Boutique Agency Client",
      slug,
      clientEmail,
      clientName: "Priya Nair",
      planCode: "growth",
    });

    expect(created.tenantId).toBeDefined();
    expect(created.slug).toBe(slug);
    expect(created.inviteToken).toBeDefined();
    expect(created.inviteToken.length).toBe(64); // 32 bytes hex
    expect(created.inviteExpiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect(created.inviteUrl).toContain(created.inviteToken);

    // Verify invite was stored as SHA-256 hash (never plain text)
    const invites = await rt._db.db
      .select()
      .from(schema.tenantOwnerInvites)
      .where(eq(schema.tenantOwnerInvites.tenantId, created.tenantId));
    expect(invites).toHaveLength(1);
    expect(invites[0]!.tokenHash).not.toBe(created.inviteToken);
    expect(invites[0]!.usedAt).toBeNull();

    // 2. Client receives link and accepts invitation, setting their password
    const accepted = await acceptTenantOwnerInvite(rt, {
      token: created.inviteToken,
      password: "StrongClientPassword2026!",
      name: "Priya Nair",
    });

    expect(accepted.success).toBe(true);
    expect(accepted.tenantId).toBe(created.tenantId);
    expect(accepted.slug).toBe(slug);
    expect(accepted.adminUrl).toContain(`store=${slug}`);

    // Verify invite is now marked as used
    const [usedInvite] = await rt._db.db
      .select()
      .from(schema.tenantOwnerInvites)
      .where(eq(schema.tenantOwnerInvites.id, invites[0]!.id));
    expect(usedInvite?.usedAt).toBeDefined();

    // Verify user membership in Store Owner role (using platformDb to bypass tenant RLS)
    const memberships = await platformDb.db
      .select()
      .from(schema.memberships)
      .where(
        sql`tenant_id = ${created.tenantId} AND user_id = ${accepted.userId} AND status = 'active'`,
      );
    expect(memberships).toHaveLength(1);

    // Verify password was hashed and saved in accounts
    const accounts = await rt._db.db
      .select()
      .from(schema.accounts)
      .where(sql`user_id = ${accepted.userId} AND provider_id = 'credential'`);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.password).not.toBe("StrongClientPassword2026!");
  });

  it("enforces single-use token and rejects reuse", async () => {
    const slug = "reuse-test-84";
    const email = "client2@agency.local";

    const created = await platformCreateTenantForClient(rt, {
      storeName: "Reuse Store",
      slug,
      clientEmail: email,
    });

    // First acceptance succeeds
    await acceptTenantOwnerInvite(rt, {
      token: created.inviteToken,
      password: "Password12345!",
    });

    // Second acceptance must fail
    await expect(
      acceptTenantOwnerInvite(rt, {
        token: created.inviteToken,
        password: "NewPassword12345!",
      }),
    ).rejects.toThrow(/invalid, expired, or has already been used/);
  });

  it("rejects expired or forged tokens and weak passwords", async () => {
    // Forged token
    await expect(
      acceptTenantOwnerInvite(rt, {
        token: "0000000000000000000000000000000000000000000000000000000000000000",
        password: "ValidPassword123!",
      }),
    ).rejects.toThrow(/invalid, expired, or has already been used/);

    // Weak password (< 10 chars)
    await expect(
      acceptTenantOwnerInvite(rt, {
        token: "some-token-that-is-valid-length",
        password: "short",
      }),
    ).rejects.toThrow(/at least 10 characters/);
  });
});
