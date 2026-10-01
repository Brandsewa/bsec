import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  CUSTOMER_SESSION_TTL_MS,
  RateLimitExceededError,
  checkStorefrontRateLimit,
  evaluateStorefrontAccess,
  getCustomerBySession,
  type CustomerRecord,
  type Runtime,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";

/** Host-only, httpOnly cookie holding the opaque customer session secret. */
export const CUSTOMER_COOKIE_NAME = "bs_customer_token";

export function customerCookie(value: string, maxAgeMs = CUSTOMER_SESSION_TTL_MS) {
  return {
    name: CUSTOMER_COOKIE_NAME,
    value,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export interface StoreRequest {
  rt: Runtime;
  tenantId: string;
  mode: string;
}

/** Resolves the store from the host, or null for an unknown host. */
export async function resolveStore(req?: Request): Promise<StoreRequest | null> {
  let h: Headers;
  try {
    h = await headers();
  } catch {
    h = req?.headers ?? new Headers();
  }
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) return null;
  return { rt, tenantId: access.tenantId, mode: access.mode ?? "live" };
}

/** The signed-in customer of this store for the current request, if the cookie is good. */
export async function currentCustomer(store: StoreRequest): Promise<CustomerRecord | null> {
  const jar = await cookies();
  return getCustomerBySession(store.rt._db.db, store.tenantId, jar.get(CUSTOMER_COOKIE_NAME)?.value);
}

/**
 * Cookie-authenticated writes must come from this store's own pages: when the browser says where the request came
 * from (Origin), it has to be the same host. Together with SameSite=Lax and JSON bodies this closes cross-site posts.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Domain errors are prefixed ("Not Found: ..."); those become 4xx with the readable text, anything else a generic 500. */
export function errorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof RateLimitExceededError) {
    return NextResponse.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfter) } });
  }
  const raw = err instanceof Error ? err.message : fallback;
  const m = /^(Bad Request|Not Found|Conflict|Precondition):\s*(.*)$/s.exec(raw);
  if (!m) return NextResponse.json({ error: fallback }, { status: 500 });
  const status = m[1] === "Not Found" ? 404 : m[1] === "Conflict" || m[1] === "Precondition" ? 409 : 400;
  return NextResponse.json({ error: m[2] }, { status });
}

/**
 * Common guard for signed-in JSON endpoints: same-origin, store known, rate limit, customer signed in.
 * Returns the context or the response to send back.
 */
export async function customerApi(req: Request): Promise<{ store: StoreRequest; customer: CustomerRecord } | NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const store = await resolveStore(req);
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  try {
    await checkStorefrontRateLimit(store.rt._db.db, store.tenantId);
  } catch (err) {
    return errorResponse(err, "Too many requests");
  }
  const customer = await currentCustomer(store);
  if (!customer) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
  return { store, customer };
}

/** Store and signed-in customer for a server-rendered account page; null when either is missing (the gate shows sign-in). */
export async function accountContext(): Promise<{ store: StoreRequest; customer: CustomerRecord } | null> {
  const store = await resolveStore();
  if (!store) return null;
  const customer = await currentCustomer(store);
  return customer ? { store, customer } : null;
}
