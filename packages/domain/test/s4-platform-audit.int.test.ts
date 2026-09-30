import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { eq, desc } from "drizzle-orm";
import {
  createRuntime,
  type Runtime,
  platformCreateTenantForClient,
  resendTenantOwnerInvite,
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
  rt = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 15 });
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await platformDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("S4: Platform Audit, Staff ID Tracking & Invite Resend Revocation", () => {
  it("passes staff ID to audit log on store creation and invite generation", async () => {
    const slug = "audit-store-s4";
    const staffId = "018f0000-0000-7000-8000-000000000001";

    const created = await platformCreateTenantForClient(
      rt,
      {
        storeName: "Audit Test Store",
        slug,
        clientEmail: "founder@audit-store.local",
      },
      staffId,
    );

    // Verify audit logs recorded staffId
    const logs = await rt._db.db
      .select()
      .from(schema.platformAuditLogs)
      .where(eq(schema.platformAuditLogs.tenantId, created.tenantId))
      .orderBy(desc(schema.platformAuditLogs.createdAt));

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const hasStaffLog = logs.some((l) => l.actorUserId === staffId && l.actorType === "platform_staff");
    expect(hasStaffLog).toBe(true);
  });

  it("revokes previous unused invite when resending and records tenant.invite_resent audit log", async () => {
    const slug = "resend-store-s4";
    const staffId = "018f0000-0000-7000-8000-000000000002";
    const clientEmail = "client@resend-store.local";

    const created = await platformCreateTenantForClient(
      rt,
      {
        storeName: "Resend Store",
        slug,
        clientEmail,
      },
      staffId,
    );

    const firstToken = created.inviteToken;

    // Resend invite
    const resent = await resendTenantOwnerInvite(rt, {
      tenantId: created.tenantId,
      email: clientEmail,
      staffUserId: staffId,
    });

    const secondToken = resent.inviteToken;
    expect(secondToken).not.toBe(firstToken);

    // 1. First token must now be revoked/expired and fail
    await expect(
      acceptTenantOwnerInvite(rt, {
        token: firstToken,
        password: "NewPassword12345!",
      }),
    ).rejects.toThrow(/invalid, expired, or has already been used/);

    // 2. Second token must succeed
    const accepted = await acceptTenantOwnerInvite(rt, {
      token: secondToken,
      password: "NewPassword12345!",
    });
    expect(accepted.success).toBe(true);

    // 3. Audit log must contain tenant.invite_resent with staffId
    const [resendLog] = await rt._db.db
      .select()
      .from(schema.platformAuditLogs)
      .where(eq(schema.platformAuditLogs.action, "tenant.invite_resent"))
      .orderBy(desc(schema.platformAuditLogs.createdAt))
      .limit(1);

    expect(resendLog).toBeDefined();
    expect(resendLog!.actorUserId).toBe(staffId);
    expect(resendLog!.actorType).toBe("platform_staff");
    expect(resendLog!.tenantId).toBe(created.tenantId);
  });
});
