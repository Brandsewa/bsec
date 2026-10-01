import { ORPCError } from "@orpc/client";
import type { AdminMe } from "@bs/contracts";
import { apiBase } from "./config.ts";
import { client } from "./orpc.ts";
import { clearActiveStoreId } from "./session.ts";

export type SignInResult =
  | { ok: true }
  | { ok: false; message: string; retryAfter?: number };

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
  if (res.ok) return { ok: true };
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "0") || undefined;
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again.", ...(retryAfter ? { retryAfter } : {}) };
  }
  if (res.status === 503) {
    return { ok: false, message: "Sign-in is not configured on the server yet." };
  }
  return { ok: false, message: "Incorrect email or password." };
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
