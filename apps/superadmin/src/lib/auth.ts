import { apiBase } from "./config.ts";

export interface PlatformUser {
  id: string;
  email: string;
  name?: string | null;
  twoFactorEnabled?: boolean;
}

export type SignInResult =
  | { ok: true }
  | { ok: false; twoFactorRequired: true }
  | { ok: false; twoFactorRequired: false; message: string; retryAfter?: number };

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
    return { ok: false, twoFactorRequired: false, message: "Could not reach platform server. Check your connection." };
  }

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data?.twoFactorRedirect || data?.twoFactorRequired) {
      return { ok: false, twoFactorRequired: true };
    }
    return { ok: true };
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "0") || undefined;
    return { ok: false, twoFactorRequired: false, message: "Too many attempts. Please wait a few minutes.", ...(retryAfter ? { retryAfter } : {}) };
  }

  const errData = await res.json().catch(() => ({}));
  if (errData?.code === "TWO_FACTOR_REQUIRED" || errData?.message?.includes("two-factor")) {
    return { ok: false, twoFactorRequired: true };
  }

  return { ok: false, twoFactorRequired: false, message: errData?.message || "Incorrect email or password." };
}

export async function verifyTotp(code: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/auth/two-factor/verify-totp`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    return { ok: false, message: err?.message || "Invalid two-factor code." };
  } catch {
    return { ok: false, message: "Could not reach platform server." };
  }
}

export async function verifyBackupCode(code: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/auth/two-factor/verify-backup-code`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    return { ok: false, message: err?.message || "Invalid backup code." };
  } catch {
    return { ok: false, message: "Could not reach platform server." };
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
  } catch {
    // ignore
  }
}

export async function fetchPlatformMe(): Promise<PlatformUser | null> {
  try {
    const res = await fetch(`${apiBase()}/api/auth/get-session`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.session || !data?.user) return null;
    return {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      twoFactorEnabled: data.user.twoFactorEnabled,
    };
  } catch {
    return null;
  }
}
