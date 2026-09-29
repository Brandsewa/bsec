import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { createStaffAuth } from "@bs/auth";
import { buildTenantContext } from "../src/context.ts";
import { createStoreOwner } from "../src/admin/create-owner.ts";
import { getAdminMe } from "../src/admin/me.ts";
import { clearLoginFailures, loginRetryAfter, recordLoginFailure } from "../src/system/login-limit.ts";
import type { Runtime } from "../src/runtime.ts";

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

const orgId = "0199a0a1-0000-7000-8000-000000000000";
const tenantA = "0199a0a1-0000-7000-8000-000000000001";
const tenantB = "0199a0a1-0000-7000-8000-000000000002";
const ORIGIN = "http://localhost:5173";
const API = "http://localhost:3000";
const EMAIL = "owner-a@admin-auth-test.example";
const PASSWORD = "correct-horse-battery";

function makeAuth() {
  return createStaffAuth(rwDb.db, {
    baseURL: API,
    secret: "a-test-secret-that-is-at-least-32-characters-long",
    trustedOrigins: [API, ORIGIN],
  });
}

async function post(auth: ReturnType<typeof makeAuth>, path: string, body: unknown, cookie?: string) {
  return auth.handler(
    new Request(`${API}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
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
  rwDb = createDb(as("app_rw", PW.rw), { max: 5 });

  const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Admin Auth Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES
      ('${tenantA}', '${orgId}', 'admin-auth-a1', 'Admin Auth Store A') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES
      ('${tenantB}', '${orgId}', 'admin-auth-b1', 'Admin Auth Store B') ON CONFLICT DO NOTHING;
    DELETE FROM users WHERE email LIKE '%@admin-auth-test.example';
  `);
  await pg.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("staff authentication, end to end on real Postgres", () => {
  it("creates the owner, signs in, and resolves the session", async () => {
    const created = await createStoreOwner(rwDb.db, {
      email: EMAIL,
      name: "Owner A",
      password: PASSWORD,
      tenantSlug: "admin-auth-a1",
    });
    expect(created.createdUser).toBe(true);
    expect(created.tenantId).toBe(tenantA);

    const auth = makeAuth();
    const res = await post(auth, "/sign-in/email", { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).toContain("bs-staff");

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(created.userId);
    expect(session?.user.email).toBe(EMAIL);
  });

  it("rejects a wrong password and unknown users", async () => {
    const auth = makeAuth();
    const wrong = await post(auth, "/sign-in/email", { email: EMAIL, password: "definitely-wrong-password" });
    expect(wrong.status).toBe(401);
    const unknown = await post(auth, "/sign-in/email", { email: "nobody@admin-auth-test.example", password: PASSWORD });
    expect(unknown.status).toBe(401);
  });

  it("has public sign-up disabled", async () => {
    const auth = makeAuth();
    const res = await post(auth, "/sign-up/email", {
      email: "intruder@admin-auth-test.example",
      password: "another-long-password",
      name: "Intruder",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    const { rows } = await pg.query("SELECT 1 FROM users WHERE email = 'intruder@admin-auth-test.example'");
    await pg.end();
    expect(rows).toHaveLength(0);
  });

  it("signing out invalidates the session", async () => {
    const auth = makeAuth();
    const signIn = await post(auth, "/sign-in/email", { email: EMAIL, password: PASSWORD });
    const cookie = cookieFrom(signIn);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    const out = await post(auth, "/sign-out", {}, cookie);
    expect(out.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it("lists only the stores the user belongs to, with the role's permissions", async () => {
    const [u] = (await rwDb.db.execute<{ id: string }>(
      (await import("drizzle-orm")).sql`select id from users where email = ${EMAIL}`,
    )).rows;
    const rt = { _db: rwDb } as unknown as Runtime;
    const me = await getAdminMe(rt, u!.id);
    expect(me.user.email).toBe(EMAIL);
    expect(me.stores.map((s) => s.tenantId)).toEqual([tenantA]);
    expect(me.stores[0]?.role).toBe("store_owner");
    expect(me.stores[0]?.permissions).toContain("orders.write");
  });

  it("the self-read policy exposes only the caller's own memberships, never another user's", async () => {
    const other = await createStoreOwner(rwDb.db, {
      email: "owner-b@admin-auth-test.example",
      name: "Owner B",
      password: "owner-b-long-password",
      tenantSlug: "admin-auth-b1",
    });
    const rt = { _db: rwDb } as unknown as Runtime;
    const [a] = (await rwDb.db.execute<{ id: string }>(
      (await import("drizzle-orm")).sql`select id from users where email = ${EMAIL}`,
    )).rows;
    const meA = await getAdminMe(rt, a!.id);
    const meB = await getAdminMe(rt, other.userId);
    expect(meA.stores.map((s) => s.tenantId)).toEqual([tenantA]);
    expect(meB.stores.map((s) => s.tenantId)).toEqual([tenantB]);

    // Without app.user_id set, a raw cross-tenant read of memberships returns nothing.
    const raw = await rwDb.db.execute(
      (await import("drizzle-orm")).sql`select count(*)::int as n from memberships`,
    );
    expect(Number((raw.rows[0] as { n: number }).n)).toBe(0);
  });

  it("does not let the owner of store A act on store B, even with a forged X-Store-Id", async () => {
    const auth = makeAuth();
    const signIn = await post(auth, "/sign-in/email", { email: EMAIL, password: PASSWORD });
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(signIn) }) });
    const sess = { user: { id: session!.user.id }, type: "staff" as const };

    const ok = await buildTenantContext(rwDb.db, {
      entryPath: "admin",
      headers: { "x-store-id": tenantA },
      session: sess,
    });
    expect(ok?.tenantId).toBe(tenantA);
    expect(ok?.permissions).toContain("products.write");

    await expect(
      buildTenantContext(rwDb.db, { entryPath: "admin", headers: { "x-store-id": tenantB }, session: sess }),
    ).rejects.toThrow(/no active membership/);
    await expect(
      buildTenantContext(rwDb.db, { entryPath: "admin", headers: { "x-store-id": tenantA }, session: null }),
    ).rejects.toThrow(/Unauthorized/);
  });

  it("re-running create-owner resets the password and keeps one user and one membership", async () => {
    const again = await createStoreOwner(rwDb.db, {
      email: EMAIL,
      name: "Owner A",
      password: "a-brand-new-long-password",
      tenantSlug: "admin-auth-a1",
    });
    expect(again.createdUser).toBe(false);
    const auth = makeAuth();
    expect((await post(auth, "/sign-in/email", { email: EMAIL, password: PASSWORD })).status).toBe(401);
    expect((await post(auth, "/sign-in/email", { email: EMAIL, password: "a-brand-new-long-password" })).status).toBe(200);

    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    const users = await pg.query("SELECT 1 FROM users WHERE email = $1", [EMAIL]);
    const members = await pg.query("SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2", [tenantA, again.userId]);
    await pg.end();
    expect(users.rows).toHaveLength(1);
    expect(members.rows).toHaveLength(1);
  });

  it("refuses short passwords and unknown stores", async () => {
    await expect(
      createStoreOwner(rwDb.db, { email: "x@admin-auth-test.example", name: "X", password: "short", tenantSlug: "admin-auth-a1" }),
    ).rejects.toThrow(/at least 10/);
    await expect(
      createStoreOwner(rwDb.db, { email: "y@admin-auth-test.example", name: "Y", password: "long-enough-password", tenantSlug: "no-such-store" }),
    ).rejects.toThrow(/No store/);
  });
});

describe("sign-in throttling counts failures only", () => {
  const ip = "203.0.113.7";
  const email = "throttle@admin-auth-test.example";

  it("locks an account after 5 failures, not before, and successful sign-ins never count", async () => {
    // Many successful sign-ins do not record anything, so they can never lock the account out.
    expect(await loginRetryAfter(rwDb.db, ip, email)).toBeNull();

    for (let i = 0; i < 4; i++) await recordLoginFailure(rwDb.db, ip, email);
    expect(await loginRetryAfter(rwDb.db, ip, email)).toBeNull();

    await recordLoginFailure(rwDb.db, ip, email);
    const wait = await loginRetryAfter(rwDb.db, ip, email);
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThan(0);
    expect(wait!).toBeLessThanOrEqual(900);

    // another account from another address is unaffected
    expect(await loginRetryAfter(rwDb.db, "198.51.100.9", "someone-else@admin-auth-test.example")).toBeNull();

    // a successful sign-in clears the account's count
    await clearLoginFailures(rwDb.db, email);
    expect(await loginRetryAfter(rwDb.db, "198.51.100.10", email)).toBeNull();
  });

  it("locks an address after 20 failures across different accounts", async () => {
    const badIp = "192.0.2.55";
    for (let i = 0; i < 19; i++) await recordLoginFailure(rwDb.db, badIp, `guess-${i}@admin-auth-test.example`);
    expect(await loginRetryAfter(rwDb.db, badIp, "fresh@admin-auth-test.example")).toBeNull();
    await recordLoginFailure(rwDb.db, badIp, "guess-19@admin-auth-test.example");
    expect(await loginRetryAfter(rwDb.db, badIp, "fresh@admin-auth-test.example")).not.toBeNull();
  });
});
