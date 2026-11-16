/**
 * Team access on real PostgreSQL (audit A2-03, A2-04, docs/audit/2026-11-A2-auth-permissions.md):
 * - accepting a staff invitation writes an audit row (rule 6);
 * - two owners demoting each other at the same moment leave exactly one owner (a smoke check: the race itself is rare and this test
 *   does not reproduce it reliably without the row lock; the fix rests on Postgres FOR UPDATE semantics, see the audit record).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { buildTenantContext, type TenantContext } from "../src/context.ts";
import { provisionTenant } from "../src/saas/provisioning.ts";
import { acceptInvitation, inviteStaff, listMemberships, listStoreRoles, setMemberRole } from "../src/admin/team.ts";

let env: TestDb;
let rt: Runtime;
let tenantId: string;
let ownerId: string;

async function ctxFor(userId: string): Promise<TenantContext> {
  const ctx = await buildTenantContext(rt._db.db, { entryPath: "admin", headers: { "x-store-id": tenantId }, session: { user: { id: userId }, type: "staff" } });
  return ctx!;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 8 });
  const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const rand = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: "Team Access Store",
    slug: `team-access-${rand}`,
    owner: { email: `owner-${rand}@team-access.test`, name: "Owner", password: `Pw-${rand}-long-enough-1` },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = t.tenantId;
  ownerId = t.ownerId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

async function addMember(email: string, roleName: string) {
  const ownerCtx = await ctxFor(ownerId);
  const role = (await listStoreRoles(rt, ownerCtx)).find((r) => r.name === roleName);
  if (!role) throw new Error(`role ${roleName} missing`);
  const inv = await inviteStaff(rt, ownerCtx, { email, roleId: role.id });
  if (!inv.token) throw new Error("invite token missing");
  await acceptInvitation(rt, { storeId: tenantId, token: inv.token, name: email, password: "A-long-enough-password-1" });
  return { roleId: role.id, inviteId: inv.id };
}

describe("team access (real DB)", () => {
  it("accepting an invitation writes an audit row naming the role, never the token", async () => {
    const { inviteId } = await addMember("staff-a@team-access.test", "store_admin");
    const rows = await withTenant(rt._db.db, tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.tenantId, tenantId), eq(schema.auditLogs.action, "staff_invitation.accept"))),
    );
    const row = rows.find((r) => r.targetId === inviteId);
    expect(row).toBeDefined();
    expect(JSON.stringify(row?.diff)).toContain("store_admin");
    expect(JSON.stringify(row)).not.toMatch(/token/i);
  });

  it("two owners demoting each other at the same moment leave exactly one owner (smoke check)", async () => {
    await addMember("owner-two@team-access.test", "store_owner");
    const ownerCtx = await ctxFor(ownerId);
    const members = await listMemberships(rt, ownerCtx);
    const first = members.find((m) => m.userId === ownerId)!;
    const second = members.find((m) => m.email === "owner-two@team-access.test")!;
    const adminRole = (await listStoreRoles(rt, ownerCtx)).find((r) => r.name === "store_admin")!;
    const secondCtx = await ctxFor(second.userId);

    const results = await Promise.allSettled([
      setMemberRole(rt, ownerCtx, { id: second.id, roleId: adminRole.id }),
      setMemberRole(rt, secondCtx, { id: first.id, roleId: adminRole.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owners = await withTenant(rt._db.db, tenantId, (tx) =>
      tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .innerJoin(schema.roles, and(eq(schema.roles.id, schema.memberships.roleId), eq(schema.roles.tenantId, schema.memberships.tenantId)))
        .where(and(eq(schema.roles.name, "store_owner"), eq(schema.memberships.status, "active"))),
    );
    expect(owners).toHaveLength(1);
  });
});
