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
