import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createLogger, createPlatformStaffMember, createRuntime, type Runtime } from "@bs/domain";

const SPA = "http://localhost:5174";
process.env.BETTER_AUTH_SECRET = "test-platform-auth-secret-0123456789abcdef0123";
process.env.PLATFORM_AUTH_URL = "http://localhost:4000";
process.env.SUPERADMIN_ORIGINS = `https://superadmin.gobs.cloud,${SPA}`;

let env: TestDb;
let rt: Runtime;
let app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

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
      const eqIdx = pair!.indexOf("=");
      const name = pair!.slice(0, eqIdx);
      const value = pair!.slice(eqIdx + 1);
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
  app = createApp(rt, createLogger("platform-password-reset-test"));
}, 240_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("platform password reset and change flow (PLAN §4)", () => {
  it("anti-enumeration: unknown and known email return identical 200 response and payload", async () => {
    await createPlatformStaffMember(rt._db.db, {
      email: "known@platform.test",
      name: "Known Staff",
      password: "password12345678",
      role: "platform_admin",
    });

    const jar = new Jar();

    // 1. Request reset for known email
    const resKnown = await send(jar, "/api/auth/request-password-reset", {
      body: { email: "known@platform.test" },
      ip: IP(50),
    });
    expect(resKnown.status).toBe(200);
    const bodyKnown = (await resKnown.json()) as { status: boolean; message: string };

    // 2. Request reset for unknown email
    const resUnknown = await send(jar, "/api/auth/request-password-reset", {
      body: { email: "unknown@platform.test" },
      ip: IP(51),
    });
    expect(resUnknown.status).toBe(200);
    const bodyUnknown = (await resUnknown.json()) as { status: boolean; message: string };

    expect(bodyKnown.status).toBe(true);
    expect(bodyUnknown.status).toBe(true);
    expect(bodyKnown.message).toBe(bodyUnknown.message);
  });

  it("rate limits password reset requests (max 3 per 15 min per IP)", async () => {
    const jar = new Jar();
    const testIp = IP(55);

    // 3 allowed
    for (let i = 0; i < 3; i++) {
      const res = await send(jar, "/api/auth/request-password-reset", {
        body: { email: `test-${i}@platform.test` },
        ip: testIp,
      });
      expect(res.status).toBe(200);
    }

    // 4th is blocked by in-memory rate limiter (429)
    const res4 = await send(jar, "/api/auth/request-password-reset", {
      body: { email: "test-blocked@platform.test" },
      ip: testIp,
    });
    expect(res4.status).toBe(429);
  });

  it("full reset flow: token minted, single-use, old sessions revoked, MFA still preserved", async () => {
    await createPlatformStaffMember(rt._db.db, {
      email: "mfa-reset@platform.test",
      name: "MFA Staff",
      password: "original password 10+",
      role: "platform_admin",
    });

    // Sign in and complete MFA enrolment so MFA is active on the account
    const j1 = new Jar();
    await send(j1, "/api/auth/sign-in/email", {
      body: { email: "mfa-reset@platform.test", password: "original password 10+" },
      ip: IP(60),
    });
    const enable = (await (
      await send(j1, "/api/auth/two-factor/enable", {
        body: { password: "original password 10+" },
        ip: IP(60),
      })
    ).json()) as { totpURI: string; backupCodes: string[] };
    const totpSecret = new URL(enable.totpURI).searchParams.get("secret")!;
    await send(j1, "/api/auth/two-factor/verify-totp", {
      body: { code: totp(totpSecret) },
      ip: IP(60),
    });
    await send(j1, "/api/platform/mfa/complete", { body: {}, ip: IP(60) });

    // Establish an active session with valid MFA
    const activeJar = new Jar();
    await send(activeJar, "/api/auth/sign-in/email", {
      body: { email: "mfa-reset@platform.test", password: "original password 10+" },
      ip: IP(61),
    });
    await send(activeJar, "/api/auth/two-factor/verify-totp", {
      body: { code: totp(totpSecret) },
      ip: IP(61),
    });
    const meActive = await (await send(activeJar, "/api/platform/me", { ip: IP(61) })).json();
    expect(meActive).toMatchObject({ authenticated: true, sessionValid: true });

    // Request password reset
    const resetJar = new Jar();
    await send(resetJar, "/api/auth/request-password-reset", {
      body: { email: "mfa-reset@platform.test" },
      ip: IP(62),
    });

    // Query verification table to find the token for mfa-reset@platform.test
    const [mfaUser] = await rt._db.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, "mfa-reset@platform.test"));
    expect(mfaUser).toBeDefined();

    const verifications = await rt._db.db.select().from(schema.verifications);
    const resetVerification = verifications
      .filter((v) => v.identifier.startsWith("reset-password:") && v.value === mfaUser!.id)
      .pop();
    expect(resetVerification).toBeDefined();
    const token = resetVerification!.identifier.replace("reset-password:", "");

    // Reset password using the token
    const resReset = await send(resetJar, "/api/auth/reset-password", {
      body: { token, newPassword: "new strong password 10+" },
      ip: IP(63),
    });
    expect(resReset.status).toBe(200);

    // Old session MUST be revoked
    const meAfterReset = await (await send(activeJar, "/api/platform/me", { ip: IP(61) })).json();
    expect(meAfterReset).toMatchObject({ authenticated: false });

    // Single-use: using the same token again must fail
    const resReuse = await send(resetJar, "/api/auth/reset-password", {
      body: { token, newPassword: "another password 10+" },
      ip: IP(63),
    });
    expect(resReuse.status).toBeGreaterThanOrEqual(400);

    // Old password no longer works
    const oldLogin = await send(new Jar(), "/api/auth/sign-in/email", {
      body: { email: "mfa-reset@platform.test", password: "original password 10+" },
      ip: IP(64),
    });
    expect(oldLogin.status).toBeGreaterThanOrEqual(400);

    // New password works AND STILL REQUIRES MFA (password reset NEVER disables MFA!)
    const newLoginJar = new Jar();
    const newLogin = await send(newLoginJar, "/api/auth/sign-in/email", {
      body: { email: "mfa-reset@platform.test", password: "new strong password 10+" },
      ip: IP(65),
    });
    expect(newLogin.status).toBe(200);
    const newLoginData = (await newLogin.json()) as { twoFactorRedirect?: boolean };
    expect(newLoginData.twoFactorRedirect).toBe(true);

    // Completing TOTP verification opens access
    const totpVerify = await send(newLoginJar, "/api/auth/two-factor/verify-totp", {
      body: { code: totp(totpSecret) },
      ip: IP(65),
    });
    expect(totpVerify.status).toBe(200);
    const meVerified = await (await send(newLoginJar, "/api/platform/me", { ip: IP(65) })).json();
    expect(meVerified).toMatchObject({ authenticated: true, sessionValid: true });
  });

  it("authenticated change-password updates password and revokes other sessions", async () => {
    await createPlatformStaffMember(rt._db.db, {
      email: "change-pw@platform.test",
      name: "Change PW Staff",
      password: "current-password-10+",
      role: "platform_admin",
    });

    const jar1 = new Jar();
    await send(jar1, "/api/auth/sign-in/email", {
      body: { email: "change-pw@platform.test", password: "current-password-10+" },
      ip: IP(70),
    });

    // Second session
    const jar2 = new Jar();
    await send(jar2, "/api/auth/sign-in/email", {
      body: { email: "change-pw@platform.test", password: "current-password-10+" },
      ip: IP(71),
    });

    // Change password from session 1
    const resChange = await send(jar1, "/api/auth/change-password", {
      body: {
        currentPassword: "current-password-10+",
        newPassword: "updated-password-10+",
        revokeOtherSessions: true,
      },
      ip: IP(70),
    });
    expect(resChange.status).toBe(200);

    // jar2 session was revoked
    const me2 = await (await send(jar2, "/api/platform/me", { ip: IP(71) })).json();
    expect(me2).toMatchObject({ authenticated: false });

    // Old password rejected
    const testOld = await send(new Jar(), "/api/auth/sign-in/email", {
      body: { email: "change-pw@platform.test", password: "current-password-10+" },
      ip: IP(72),
    });
    expect(testOld.status).toBeGreaterThanOrEqual(400);

    // New password accepted
    const testNew = await send(new Jar(), "/api/auth/sign-in/email", {
      body: { email: "change-pw@platform.test", password: "updated-password-10+" },
      ip: IP(73),
    });
    expect(testNew.status).toBe(200);
  });
});
