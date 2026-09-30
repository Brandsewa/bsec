import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { hashPassword } from "@bs/auth";
import { createLogger, createPlatformStaffMember, createRuntime, type Runtime } from "@bs/domain";

const SPA = "http://localhost:5174";
process.env.BETTER_AUTH_SECRET = "test-platform-auth-secret-0123456789abcdef0123";
process.env.PLATFORM_AUTH_URL = "http://localhost:4000";
process.env.SUPERADMIN_ORIGINS = `https://superadmin.gobs.cloud,${SPA}`;

let env: TestDb;
let rt: Runtime;
let app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), enough to act as the authenticator app. */
function totp(base32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

class Jar {
  private cookies = new Map<string, string>();
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (!value || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  get header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get size() {
    return this.cookies.size;
  }
}

const IP = (n: number) => `203.0.113.${n}`;

async function send(jar: Jar, path: string, opts: { method?: string; body?: unknown; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? IP(10) };
  if (opts.origin !== null) headers.origin = opts.origin ?? SPA;
  if (jar.size > 0) headers.cookie = jar.header;
  const res = await app.request(`http://localhost:4000${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  jar.absorb(res);
  return res;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const { createApp } = await import("../src/app.ts");
  app = createApp(rt, createLogger("http-mfa-test"));
}, 240_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("platform login with MFA, end to end over HTTP (real Better Auth, real Postgres)", () => {
  it("bootstrap login -> authenticator enrolment -> forced re-login with a code -> a procedure works", async () => {
    await createPlatformStaffMember(rt._db.db, { email: "owner@platform.test", name: "Platform Owner", password: "correct horse battery staple", role: "platform_owner" });
    const jar = new Jar();

    // 1. Password sign-in creates a session, but the API stays closed to it
    const signIn = await send(jar, "/api/auth/sign-in/email", { body: { email: "owner@platform.test", password: "correct horse battery staple" } });
    expect(signIn.status).toBe(200);
    expect(await (await send(jar, "/api/platform/me")).json()).toMatchObject({ authenticated: true, isPlatformStaff: true, mfaEnrolled: false, mfaComplete: false });
    expect((await send(jar, "/platform/tenants")).status).toBe(403);

    // 2. Enrol an authenticator (needs the password again)
    const wrong = await send(jar, "/api/auth/two-factor/enable", { body: { password: "not the password" } });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const enable = await send(jar, "/api/auth/two-factor/enable", { body: { password: "correct horse battery staple" } });
    expect(enable.status).toBe(200);
    const { totpURI, backupCodes } = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    expect(backupCodes.length).toBeGreaterThan(3);
    const secret = new URL(totpURI).searchParams.get("secret")!;

    // enabling alone does not open the API: the first code must be verified
    expect((await send(jar, "/platform/tenants")).status).toBe(403);
    const verify = await send(jar, "/api/auth/two-factor/verify-totp", { body: { code: totp(secret) } });
    expect(verify.status).toBe(200);
    expect(await (await send(jar, "/api/platform/me")).json()).toMatchObject({ mfaEnrolled: true, mfaComplete: false, sessionValid: false });
    // verified but not completed: still closed (this session is password-era)
    expect((await send(jar, "/platform/tenants")).status).toBe(403);

    // 3. Completing enrolment kills every session, including this one
    const done = await send(jar, "/api/platform/mfa/complete", { method: "POST", body: {} });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, signInAgain: true });
    // the old session is gone from the database: replaying its cookie gets nothing
    expect(await (await send(jar, "/api/platform/me")).json()).toEqual({ authenticated: false });
    expect((await send(jar, "/platform/tenants")).status).toBe(401);

    // 4. Signing in again is password + authenticator code, and only then is there a session
    const jar2 = new Jar();
    const again = await send(jar2, "/api/auth/sign-in/email", { body: { email: "owner@platform.test", password: "correct horse battery staple" } });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await send(jar2, "/platform/tenants")).status).toBe(401); // password alone creates no session for an enrolled account
    expect((await send(jar2, "/api/auth/two-factor/verify-totp", { body: { code: "000000" } })).status).toBeGreaterThanOrEqual(400);
    const ok = await send(jar2, "/api/auth/two-factor/verify-totp", { body: { code: totp(secret) } });
    expect(ok.status).toBe(200);

    expect(await (await send(jar2, "/api/platform/me")).json()).toMatchObject({ authenticated: true, mfaComplete: true, sessionValid: true, role: "platform_owner" });
    const tenants = await send(jar2, "/platform/tenants");
    expect(tenants.status).toBe(200);
    expect(Array.isArray(await tenants.json())).toBe(true);

    // 5. The enrolment left an audit trail
    const audit = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "platform_staff.mfa_enrolled"));
    expect(audit).toHaveLength(1);
  });

  it("a store owner's login, a deactivated account and a backup code behave correctly", async () => {
    // a store owner (a normal store account) can sign in to the platform auth endpoint, but is not staff and gets nothing
    const [shop] = await rt._db.db.insert(schema.users).values({ email: "shopkeeper@shop.test", name: "Shop", emailVerified: true }).returning({ id: schema.users.id });
    await rt._db.db.insert(schema.accounts).values({ id: crypto.randomUUID(), userId: shop!.id, accountId: shop!.id, providerId: "credential", password: await hashPassword("a shopkeepers password 1") });
    const jar = new Jar();
    expect((await send(jar, "/api/auth/sign-in/email", { body: { email: "shopkeeper@shop.test", password: "a shopkeepers password 1" } })).status).toBe(200);
    expect(await (await send(jar, "/api/platform/me")).json()).toMatchObject({ authenticated: true, isPlatformStaff: false, mfaComplete: false });
    expect((await send(jar, "/platform/tenants")).status).toBe(403);
    expect((await send(jar, "/platform/overview")).status).toBe(403);
    expect((await send(jar, "/api/platform/mfa/complete", { body: {} })).status).toBe(403);

    // a second staff member enrols, then signs in with a backup code instead of the authenticator
    await createPlatformStaffMember(rt._db.db, { email: "backup@platform.test", name: "Backup", password: "backup staff password 1", role: "platform_admin" });
    const j = new Jar();
    await send(j, "/api/auth/sign-in/email", { body: { email: "backup@platform.test", password: "backup staff password 1" }, ip: IP(20) });
    const enable = await (await send(j, "/api/auth/two-factor/enable", { body: { password: "backup staff password 1" }, ip: IP(20) })).json() as { totpURI: string; backupCodes: string[] };
    await send(j, "/api/auth/two-factor/verify-totp", { body: { code: totp(new URL(enable.totpURI).searchParams.get("secret")!) }, ip: IP(20) });
    await send(j, "/api/platform/mfa/complete", { body: {}, ip: IP(20) });
    const j2 = new Jar();
    await send(j2, "/api/auth/sign-in/email", { body: { email: "backup@platform.test", password: "backup staff password 1" }, ip: IP(21) });
    const bc = await send(j2, "/api/auth/two-factor/verify-backup-code", { body: { code: enable.backupCodes[0] }, ip: IP(21) });
    expect(bc.status).toBe(200);
    expect((await send(j2, "/platform/tenants", { ip: IP(21) })).status).toBe(200);
    // a backup code works once
    const j3 = new Jar();
    await send(j3, "/api/auth/sign-in/email", { body: { email: "backup@platform.test", password: "backup staff password 1" }, ip: IP(22) });
    expect((await send(j3, "/api/auth/two-factor/verify-backup-code", { body: { code: enable.backupCodes[0] }, ip: IP(22) })).status).toBeGreaterThanOrEqual(400);

    // deactivation ends access immediately, even with a live session
    const [staff] = await rt._db.db.select().from(schema.users).where(eq(schema.users.email, "backup@platform.test"));
    await rt._db.db.update(schema.platformStaff).set({ isActive: false }).where(eq(schema.platformStaff.userId, staff!.id));
    expect((await send(j2, "/platform/tenants", { ip: IP(21) })).status).toBe(403);
  });
});

describe("origin, CORS and test-auth hardening", () => {
  it("refuses state-changing requests from a tenant storefront origin or with no origin, and never sends CORS headers to them", async () => {
    const jar = new Jar();
    for (const origin of ["https://evil-store.gobs.cloud", "https://gobs.cloud", "http://localhost:9999"]) {
      const res = await send(jar, "/api/platform/mfa/complete", { method: "POST", body: {}, origin });
      expect(res.status, origin).toBe(403);
      expect(res.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
    expect((await send(jar, "/api/platform/mfa/complete", { method: "POST", body: {}, origin: null })).status).toBe(403);

    const preflightEvil = await app.request("http://localhost:4000/api/rpc/tenants/list", { method: "OPTIONS", headers: { origin: "https://evil-store.gobs.cloud", "access-control-request-method": "POST" } });
    expect(preflightEvil.headers.get("access-control-allow-origin")).toBeNull();
    const preflightOk = await app.request("http://localhost:4000/api/rpc/tenants/list", { method: "OPTIONS", headers: { origin: SPA, "access-control-request-method": "POST" } });
    expect(preflightOk.headers.get("access-control-allow-origin")).toBe(SPA);
    expect(preflightOk.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("the X-Test-Staff-Id backdoor does nothing without the explicit test flag", async () => {
    const [staff] = await rt._db.db.select().from(schema.users).where(eq(schema.users.email, "owner@platform.test"));
    const res = await app.request("http://localhost:4000/platform/tenants", { headers: { "x-test-staff-id": staff!.id } });
    expect([401, 403]).toContain(res.status);
  });

  it("rate limits password guessing", async () => {
    const jar = new Jar();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await send(jar, "/api/auth/sign-in/email", { body: { email: "owner@platform.test", password: `wrong-password-${i}` }, ip: IP(99) })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401 || s === 400 || s === 403)).toBe(true);
    expect(statuses.slice(5).some((s) => s === 429)).toBe(true);
  });
});
