import { afterEach, describe, expect, it, vi } from "vitest";
import { disableMfa, finishMfaSetup, regenerateBackupCodes, signIn, startMfaSetup, verifyBackupCode, verifyTotp } from "../src/lib/auth.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function mockFetch(res: Response | Error) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (res instanceof Error) throw res;
    return res.clone();
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("sign-in with two-step verification", () => {
  it("asks for a code when the account has an authenticator", async () => {
    mockFetch(json({ twoFactorRedirect: true }));
    expect(await signIn("a@b.test", "password-123")).toMatchObject({ ok: false, twoFactorRequired: true });
  });

  it("signs in straight away without one, and keeps the generic wrong-password message", async () => {
    mockFetch(json({ user: { id: "u" } }));
    expect(await signIn("a@b.test", "password-123")).toEqual({ ok: true });
    mockFetch(json({ message: "Invalid email or password" }, 401));
    expect(await signIn("a@b.test", "wrong")).toEqual({ ok: false, message: "Incorrect email or password." });
  });

  it("reports a rate limit", async () => {
    mockFetch(json({}, 429, { "retry-after": "120" }));
    expect(await signIn("a@b.test", "x")).toMatchObject({ ok: false, retryAfter: 120 });
  });
});

describe("second step and authenticator management", () => {
  it("verifies a code and a backup code, and explains a refusal", async () => {
    const spy = mockFetch(json({ token: "t" }));
    expect(await verifyTotp("123456")).toEqual({ ok: true });
    expect(String(spy.mock.calls[0]?.[0])).toContain("/api/auth/two-factor/verify-totp");
    mockFetch(json({ message: "Invalid code" }, 401));
    expect(await verifyTotp("000000")).toEqual({ ok: false, message: "Invalid code" });
    mockFetch(json({}, 429));
    expect((await verifyBackupCode("x")).ok).toBe(false);
  });

  it("starts setup with the password, returning the secret and backup codes", async () => {
    const spy = mockFetch(json({ totpURI: "otpauth://totp/Brand%20Sewa:a@b.test?secret=ABCDEF&issuer=Brand%20Sewa", backupCodes: ["aaaa-bbbb", "cccc-dddd"] }));
    const res = await startMfaSetup("my-password");
    expect(res).toMatchObject({ ok: true, setup: { secret: "ABCDEF", backupCodes: ["aaaa-bbbb", "cccc-dddd"] } });
    expect(JSON.parse(String(spy.mock.calls[0]?.[1]?.body))).toEqual({ password: "my-password" });
  });

  it("a wrong password stops setup, turn-off and new backup codes", async () => {
    mockFetch(json({ message: "Invalid password" }, 400));
    expect(await startMfaSetup("nope")).toEqual({ ok: false, message: "Invalid password" });
    expect(await disableMfa("nope")).toEqual({ ok: false, message: "Invalid password" });
    expect(await regenerateBackupCodes("nope")).toEqual({ ok: false, message: "Invalid password" });
  });

  it("finishing setup checks the first code, and new backup codes come back once", async () => {
    mockFetch(json({ token: "t" }));
    expect(await finishMfaSetup("123 456")).toEqual({ ok: true });
    mockFetch(json({ backupCodes: ["x1", "x2"] }));
    expect(await regenerateBackupCodes("pw")).toEqual({ ok: true, codes: ["x1", "x2"] });
  });

  it("survives a network failure with a plain message", async () => {
    mockFetch(new Error("offline"));
    const res = await verifyTotp("123456");
    expect(res.ok).toBe(false);
  });
});
