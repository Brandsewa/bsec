import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  getAccountProfile,
  listAccountAlerts,
  listSecurityEvents,
  listSessions,
  mutedUserIds,
  recordSecurityEvent,
  revokeOtherSessions,
  revokeSession,
  setAccountAlertMuted,
  updateAccountProfile,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;

beforeAll(async () => {
  env = await startTestDb();
  // The same role the web app runs as, so these tests prove what production is allowed to do.
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 3 });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

async function makeUser(label: string) {
  const [u] = await rt._db.db
    .insert(schema.users)
    .values({ email: `${label}-${randomUUID()}@acct.test`, name: label })
    .returning();
  return u!;
}

async function makeSession(userId: string, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36", expiresInMs = 3_600_000) {
  const id = randomUUID();
  await rt._db.db.insert(schema.sessions).values({
    id,
    userId,
    token: `tok-${id}`,
    expiresAt: new Date(Date.now() + expiresInMs),
    ipAddress: "203.0.113.7",
    userAgent: ua,
  });
  return id;
}

describe("account profile", () => {
  it("updates only the caller's own row and leaves the email alone", async () => {
    const a = await makeUser("alice");
    const b = await makeUser("bob");
    const out = await updateAccountProfile(rt, a.id, {
      name: "  Alice Q  ",
      jobTitle: "Ops lead",
      timezone: "Asia/Kolkata",
      timeFormat: "24h",
      dateFormat: "dd/mm/yyyy",
      uiDensity: "compact",
      defaultLanding: "orders",
    });
    expect(out).toMatchObject({ name: "Alice Q", jobTitle: "Ops lead", timezone: "Asia/Kolkata", timeFormat: "24h", uiDensity: "compact", defaultLanding: "orders" });
    expect(out.email).toBe(String(a.email));
    const bob = await getAccountProfile(rt, b.id);
    expect(bob.name).toBe("bob");
    expect(bob.jobTitle).toBeNull();
  });

  it("rejects an empty name, a bad phone, an unknown timezone and a non-https picture", async () => {
    const a = await makeUser("carol");
    await expect(updateAccountProfile(rt, a.id, { name: "   " })).rejects.toThrow(/name is required/i);
    await expect(updateAccountProfile(rt, a.id, { phone: "abc" })).rejects.toThrow(/valid phone/i);
    await expect(updateAccountProfile(rt, a.id, { timezone: "Mars/Olympus" })).rejects.toThrow(/timezone/i);
    await expect(updateAccountProfile(rt, a.id, { image: "http://x.test/a.png" })).rejects.toThrow(/https/i);
  });

  it("clears a preference when null is sent", async () => {
    const a = await makeUser("dave");
    await updateAccountProfile(rt, a.id, { jobTitle: "Boss" });
    expect((await updateAccountProfile(rt, a.id, { jobTitle: null })).jobTitle).toBeNull();
  });
});

describe("account sessions", () => {
  it("lists only my live sessions, marks the current one and never returns a token", async () => {
    const a = await makeUser("erin");
    const other = await makeUser("frank");
    const s1 = await makeSession(a.id);
    await makeSession(a.id, "Mozilla/5.0 (iPhone) Safari/604");
    await makeSession(a.id, "x", -1000); // expired
    await makeSession(other.id);
    const list = await listSessions(rt, a.id, s1);
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current).map((s) => s.id)).toEqual([s1]);
    expect(JSON.stringify(list)).not.toContain("tok-");
    expect(list.map((s) => s.device).sort()).toEqual(["Chrome on Windows", "Safari on iOS"]);
  });

  it("revokes one of my other devices, refuses the current one, and cannot touch another user's session", async () => {
    const a = await makeUser("gina");
    const victim = await makeUser("hank");
    const cur = await makeSession(a.id);
    const dev = await makeSession(a.id);
    const theirs = await makeSession(victim.id);
    await expect(revokeSession(rt, a.id, cur, cur)).rejects.toThrow(/sign out/i);
    expect(await revokeSession(rt, a.id, theirs, cur)).toEqual({ revoked: false });
    expect(await listSessions(rt, victim.id, undefined)).toHaveLength(1);
    expect(await revokeSession(rt, a.id, dev, cur)).toEqual({ revoked: true });
    expect((await listSessions(rt, a.id, cur)).map((s) => s.id)).toEqual([cur]);
    expect((await listSecurityEvents(rt, a.id)).map((e) => e.type)).toContain("session_revoked");
  });

  it("signs out every other device but keeps the current one, and leaves other users alone", async () => {
    const a = await makeUser("iris");
    const o = await makeUser("jack");
    const cur = await makeSession(a.id);
    await makeSession(a.id);
    await makeSession(a.id);
    await makeSession(o.id);
    expect(await revokeOtherSessions(rt, a.id, cur)).toEqual({ count: 2 });
    expect((await listSessions(rt, a.id, cur)).map((s) => s.id)).toEqual([cur]);
    expect(await listSessions(rt, o.id, undefined)).toHaveLength(1);
    await expect(revokeOtherSessions(rt, a.id, undefined)).rejects.toThrow();
  });
});

describe("security events", () => {
  it("records, lists newest first, scopes to the user, and is append-only for the runtime role", async () => {
    const a = await makeUser("kate");
    const b = await makeUser("liam");
    await recordSecurityEvent(rt._db.db, { userId: a.id, type: "password_changed", ip: "198.51.100.1", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605" });
    await recordSecurityEvent(rt._db.db, { userId: a.id, type: "mfa_enabled" });
    await recordSecurityEvent(rt._db.db, { userId: b.id, type: "sign_in" });
    const list = await listSecurityEvents(rt, a.id);
    expect(list.map((e) => e.type)).toEqual(["mfa_enabled", "password_changed"]);
    expect(list.find((e) => e.type === "password_changed")?.device).toBe("Safari on macOS");
    // app_rw may insert and read only
    await expect(rt._db.db.delete(schema.securityEvents).where(eq(schema.securityEvents.userId, a.id))).rejects.toThrow();
    await expect(rt._db.db.update(schema.securityEvents).set({ type: "x" }).where(eq(schema.securityEvents.userId, a.id))).rejects.toThrow();
  });

  it("never throws when the write fails", async () => {
    await expect(recordSecurityEvent(rt._db.db, { userId: randomUUID(), type: "sign_in" })).resolves.toBeUndefined();
  });
});

describe("account alerts (mute)", () => {
  it("mutes and unmutes a store alert for me only, and refuses locked or unknown alerts", async () => {
    const a = await makeUser("mia");
    const b = await makeUser("ned");
    const alerts = await listAccountAlerts(rt, a.id);
    const unlocked = alerts.find((x) => !x.locked)!;
    expect(unlocked.muted).toBe(false);
    await setAccountAlertMuted(rt, a.id, unlocked.key, true);
    await setAccountAlertMuted(rt, a.id, unlocked.key, true); // idempotent
    expect((await listAccountAlerts(rt, a.id)).find((x) => x.key === unlocked.key)?.muted).toBe(true);
    expect((await listAccountAlerts(rt, b.id)).find((x) => x.key === unlocked.key)?.muted).toBe(false);
    expect([...(await mutedUserIds(rt._db.db, unlocked.key, [a.id, b.id]))]).toEqual([a.id]);
    await setAccountAlertMuted(rt, a.id, unlocked.key, false);
    expect((await listAccountAlerts(rt, a.id)).find((x) => x.key === unlocked.key)?.muted).toBe(false);
    await expect(setAccountAlertMuted(rt, a.id, "not.an.event", true)).rejects.toThrow(/unknown/i);
    const locked = alerts.find((x) => x.locked);
    if (locked) await expect(setAccountAlertMuted(rt, a.id, locked.key, true)).rejects.toThrow(/cannot be switched off/i);
  });
});

describe("address display", () => {
  it("shows readable addresses", async () => {
    const { displayIp } = await import("../src/index.ts");
    expect(displayIp("0000:0000:0000:0000:0000:0000:0000:0001")).toBe("localhost");
    expect(displayIp("::1")).toBe("localhost");
    expect(displayIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(displayIp("2001:db8::1")).toBe("2001:db8::1");
    expect(displayIp(null)).toBeNull();
  });
});

describe("session list shows readable addresses", () => {
  it("formats the stored address", async () => {
    const u = await makeUser("zoe");
    const id = randomUUID();
    await rt._db.db.insert(schema.sessions).values({ id, userId: u.id, token: `tok-${id}`, expiresAt: new Date(Date.now() + 3_600_000), ipAddress: "0000:0000:0000:0000:0000:0000:0000:0001", userAgent: "x" });
    expect((await listSessions(rt, u.id, undefined))[0]?.ip).toBe("localhost");
  });
});

describe("second-factor rate limit", () => {
  it("allows 10 tries per address in the window, then refuses with a retry time", async () => {
    const { checkStaffTwoFactorRateLimit, RateLimitExceededError } = await import("../src/index.ts");
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < 10; i++) await checkStaffTwoFactorRateLimit(rt._db.db, { ip });
    const err = await checkStaffTwoFactorRateLimit(rt._db.db, { ip }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitExceededError);
    expect((err as InstanceType<typeof RateLimitExceededError>).retryAfter).toBeGreaterThan(0);
    // another address is unaffected
    await expect(checkStaffTwoFactorRateLimit(rt._db.db, { ip: "203.0.113.250" })).resolves.toBeUndefined();
  });
});
