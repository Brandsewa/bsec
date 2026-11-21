import { ORPCError } from "@orpc/client";
import type { AdminMe } from "@bs/contracts";
import { apiBase } from "./config.ts";
import { client } from "./orpc.ts";
import { clearActiveStoreId } from "./session.ts";

export type SignInResult =
  | { ok: true }
  /** The password was right and the account has an authenticator: ask for the code next. */
  | { ok: false; twoFactorRequired: true; message: string }
  | { ok: false; twoFactorRequired?: false; message: string; retryAfter?: number };

export async function signIn(email: string, password: string): Promise<SignInResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/auth/sign-in/email`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { twoFactorRedirect?: boolean };
    if (data.twoFactorRedirect) return { ok: false, twoFactorRequired: true, message: "Enter the code from your authenticator app." };
    return { ok: true };
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "0") || undefined;
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again.", ...(retryAfter ? { retryAfter } : {}) };
  }
  if (res.status === 503) {
    return { ok: false, message: "Sign-in is not configured on the server yet." };
  }
  return { ok: false, message: "Incorrect email or password." };
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${apiBase()}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function failure(res: Response, fallback: string): Promise<string> {
  if (res.status === 429) return "Too many attempts. Please wait a few minutes and try again.";
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return data.message || data.error || fallback;
}

/** Second step of sign-in: the six digit code from the authenticator app. */
export async function verifyTotp(code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await postJson("/api/auth/two-factor/verify-totp", { code, trustDevice: false });
    return res.ok ? { ok: true } : { ok: false, message: await failure(res, "That code is not correct. Check the time on your phone and try again.") };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

/** Second step of sign-in with a one-time backup code instead of the app. */
export async function verifyBackupCode(code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await postJson("/api/auth/two-factor/verify-backup-code", { code });
    return res.ok ? { ok: true } : { ok: false, message: await failure(res, "That backup code is not valid or was already used.") };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

export interface MfaSetup {
  /** The otpauth:// address the QR code encodes. */
  uri: string;
  /** The same secret for typing into an app by hand. */
  secret: string;
  backupCodes: string[];
}

/** Step 1 of turning on the authenticator: needs the account password again. Nothing is active until the first code is checked. */
export async function startMfaSetup(password: string): Promise<{ ok: true; setup: MfaSetup } | { ok: false; message: string }> {
  try {
    const res = await postJson("/api/auth/two-factor/enable", { password });
    if (!res.ok) return { ok: false, message: await failure(res, "Could not start setup. Check your password.") };
    const data = (await res.json()) as { totpURI: string; backupCodes: string[] };
    return { ok: true, setup: { uri: data.totpURI, secret: new URL(data.totpURI).searchParams.get("secret") ?? "", backupCodes: data.backupCodes } };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

/** Step 2: the first code from the app switches the authenticator on. */
export async function finishMfaSetup(code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  return verifyTotp(code);
}

export async function disableMfa(password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await postJson("/api/auth/two-factor/disable", { password });
    return res.ok ? { ok: true } : { ok: false, message: await failure(res, "Could not turn it off. Check your password.") };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

/** Replaces the whole backup code set; the old codes stop working. Needs the password. */
export async function regenerateBackupCodes(password: string): Promise<{ ok: true; codes: string[] } | { ok: false; message: string }> {
  try {
    const res = await postJson("/api/auth/two-factor/generate-backup-codes", { password });
    if (!res.ok) return { ok: false, message: await failure(res, "Could not make new codes. Check your password.") };
    const data = (await res.json()) as { backupCodes: string[] };
    return { ok: true, codes: data.backupCodes };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${apiBase()}/api/auth/sign-out`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } finally {
    clearActiveStoreId();
  }
}

/** The signed-in user and their stores, or null when not signed in. */
export async function fetchMe(): Promise<AdminMe | null> {
  try {
    return await client.admin.me.get();
  } catch (err) {
    if (err instanceof ORPCError && (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN")) return null;
    throw err;
  }
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ORPCError && err.code === "UNAUTHORIZED";
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; message: string; retryAfter?: number }> {
  try {
    const res = await fetch(`${apiBase()}/api/auth/request-password-reset`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      return { ok: true, message: "If this email exists in our system, check your email for the reset link." };
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "0") || undefined;
      return { ok: false, message: "Too many reset attempts. Please wait a few minutes and try again.", ...(retryAfter ? { retryAfter } : {}) };
    }
    // Anti-enumeration: still show success message unless rate-limited
    return { ok: true, message: "If this email exists in our system, check your email for the reset link." };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: boolean; message: string; retryAfter?: number }> {
  try {
    const res = await fetch(`${apiBase()}/api/auth/reset-password`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
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
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/auth/change-password`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true }),
    });
    if (res.ok) {
      return { ok: true, message: "Password updated successfully." };
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    const err = data.message || data.error;
    return { ok: false, message: err || "Failed to change password. Make sure your current password is correct." };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}
