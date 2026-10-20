import { apiBase } from "./config.ts";
import { messageOf } from "./errors.ts";

export type PlatformRole = "platform_owner" | "platform_admin" | "platform_support";

export interface PlatformUser {
  id: string;
  email: string;
  name?: string | null;
  role: PlatformRole;
}

/** Where a login stands (GET /api/platform/me). Usable before MFA is complete. */
export interface LoginStatus {
  authenticated: boolean;
  userId?: string;
  email?: string;
  name?: string | null;
  isPlatformStaff?: boolean;
  role?: PlatformRole | null;
  mfaRequired?: boolean;
  mfaEnrolled?: boolean;
  mfaComplete?: boolean;
  sessionValid?: boolean;
}

export type SignInResult =
  | { ok: true }
  | { ok: false; twoFactorRequired: true }
  | { ok: false; twoFactorRequired: false; message: string; retryAfter?: number };

const JSON_HEADERS = { "content-type": "application/json" };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${apiBase()}${path}`, { method: "POST", credentials: "include", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return data.message || data.error || fallback;
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  let res: Response;
  try {
    res = await post("/api/auth/sign-in/email", { email, password });
  } catch {
    return { ok: false, twoFactorRequired: false, message: "Could not reach the platform server. Check your connection." };
  }

  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { twoFactorRedirect?: boolean; twoFactorRequired?: boolean };
    if (data.twoFactorRedirect || data.twoFactorRequired) return { ok: false, twoFactorRequired: true };
    return { ok: true };
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "0") || undefined;
    return { ok: false, twoFactorRequired: false, message: "Too many attempts. Please wait a few minutes.", ...(retryAfter ? { retryAfter } : {}) };
  }
  return { ok: false, twoFactorRequired: false, message: "Incorrect email or password." };
}

export async function verifyTotp(code: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await post("/api/auth/two-factor/verify-totp", { code });
    return res.ok ? { ok: true } : { ok: false, message: await errorMessage(res, "Invalid two-factor code.") };
  } catch {
    return { ok: false, message: "Could not reach the platform server." };
  }
}

export async function verifyBackupCode(code: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await post("/api/auth/two-factor/verify-backup-code", { code });
    return res.ok ? { ok: true } : { ok: false, message: await errorMessage(res, "Invalid backup code.") };
  } catch {
    return { ok: false, message: "Could not reach the platform server." };
  }
}

export async function signOut(): Promise<void> {
  try {
    await post("/api/auth/sign-out", {});
  } catch {
    /* ignore */
  }
}

export async function fetchLoginStatus(): Promise<LoginStatus> {
  try {
    const res = await fetch(`${apiBase()}/api/platform/me`, { credentials: "include" });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as LoginStatus;
  } catch {
    return { authenticated: false };
  }
}

/** The signed-in platform user, or null unless the session is fully valid (staff + MFA complete + fresh session). */
export async function fetchPlatformMe(): Promise<PlatformUser | null> {
  const s = await fetchLoginStatus();
  if (!s.authenticated || !s.sessionValid || !s.role || !s.email || !s.userId) return null;
  return { id: s.userId, email: s.email, name: s.name ?? null, role: s.role };
}

export interface MfaSetup {
  secret: string;
  otpauthUri: string;
  backupCodes: string[];
}

/** Step 1 of enrolment: generates the authenticator secret and backup codes (needs the account password again). */
export async function startMfaSetup(password: string): Promise<{ ok: true; setup: MfaSetup } | { ok: false; message: string }> {
  try {
    const res = await post("/api/auth/two-factor/enable", { password });
    if (!res.ok) return { ok: false, message: await errorMessage(res, "Could not start authenticator setup. Check your password.") };
    const data = (await res.json()) as { totpURI: string; backupCodes: string[] };
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    return { ok: true, setup: { secret, otpauthUri: data.totpURI, backupCodes: data.backupCodes } };
  } catch (err) {
    return { ok: false, message: messageOf(err, "Could not reach the platform server.") };
  }
}

/** Step 2 + 3: verify the first code, then complete enrolment (ends every session; the next sign-in needs a code). */
export async function finishMfaSetup(code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const verified = await verifyTotp(code);
  if (!verified.ok) return { ok: false, message: verified.message ?? "That code is not correct. Check the time on your phone and try again." };
  try {
    const res = await post("/api/platform/mfa/complete", {});
    if (!res.ok) return { ok: false, message: await errorMessage(res, "Could not complete setup.") };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: messageOf(err, "Could not reach the platform server.") };
  }
}

export async function acceptStaffInvitation(token: string, password: string, name: string): Promise<{ ok: true; email: string } | { ok: false; message: string }> {
  try {
    const res = await post("/api/platform/staff/accept-invitation", { token, password, name: name || undefined });
    if (!res.ok) return { ok: false, message: await errorMessage(res, "This invitation is invalid or has expired.") };
    const data = (await res.json()) as { email: string };
    return { ok: true, email: data.email };
  } catch (err) {
    return { ok: false, message: messageOf(err, "Could not reach the platform server.") };
  }
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; message: string; retryAfter?: number }> {
  try {
    const res = await post("/api/auth/request-password-reset", { email });
    if (res.ok) {
      return { ok: true, message: "If this email exists in our system, check your email for the reset link." };
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "0") || undefined;
      return { ok: false, message: "Too many reset attempts. Please wait a few minutes and try again.", ...(retryAfter ? { retryAfter } : {}) };
    }
    return { ok: true, message: "If this email exists in our system, check your email for the reset link." };
  } catch {
    return { ok: false, message: "Could not reach the platform server. Check your connection." };
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; message: string; retryAfter?: number }> {
  try {
    const res = await post("/api/auth/reset-password", { token, newPassword });
    if (res.ok) {
      return { ok: true, message: "Your password has been reset successfully. You can now sign in." };
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "0") || undefined;
      return { ok: false, message: "Too many attempts. Please wait a few minutes and try again.", ...(retryAfter ? { retryAfter } : {}) };
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    const err = data.message || data.error;
    if (err?.toLowerCase().includes("token") || res.status === 400) {
      return { ok: false, message: "This password reset link is invalid or has expired." };
    }
    return { ok: false, message: err || "Failed to reset password. Please try again." };
  } catch {
    return { ok: false, message: "Could not reach the platform server. Check your connection." };
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await post("/api/auth/change-password", { currentPassword, newPassword, revokeOtherSessions: true });
    if (res.ok) {
      return { ok: true, message: "Password updated successfully." };
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    const err = data.message || data.error;
    return { ok: false, message: err || "Failed to change password. Make sure your current password is correct." };
  } catch {
    return { ok: false, message: "Could not reach the platform server. Check your connection." };
  }
}
