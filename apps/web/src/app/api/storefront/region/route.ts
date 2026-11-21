import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  checkStorefrontRateLimit,
  evaluateStorefrontAccess,
  getStatePricingScope,
  IN_STATE_NAMES,
  lookupStateByPincode,
  RateLimitExceededError,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { PIN_ERROR_COOKIE, STATE_COOKIE, STATE_SKIP_COOKIE } from "@/lib/market-constants.ts";

/**
 * State Pricing app, manual mode (ADR-044): turns the shopper's pincode into a state and remembers it in a cookie.
 * Works as a plain HTML form post (the popup ships no JavaScript) and as JSON. Does nothing unless the store's app is
 * active in manual mode. The cookie only sets the displayed and cart price.
 */
const COOKIE_BASE = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };

/** Where a form post returns to: the page it came from, on this host only. */
function backTo(req: Request, host: string): URL {
  const base = new URL(`${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`);
  try {
    const ref = new URL(req.headers.get("referer") ?? "");
    if (ref.host === base.host) return new URL(ref.pathname + ref.search, base);
  } catch {
    // no usable referer
  }
  return new URL("/", base);
}

export async function POST(req: Request) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const isForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const fail = (message: string, status: number) => {
    if (!isForm) return NextResponse.json({ error: message }, { status });
    const res = NextResponse.redirect(backTo(req, host), 303);
    res.cookies.set({ ...COOKIE_BASE, name: PIN_ERROR_COOKIE, value: message, maxAge: 60 });
    return res;
  };

  try {
    await checkStorefrontRateLimit(rt._db.db, access.tenantId);
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) return fail("Too many attempts. Please wait a moment.", 429);
    throw err;
  }

  const scope = await getStatePricingScope(rt, access.tenantId);
  if (!scope.active || scope.mode !== "manual") return NextResponse.json({ error: "Not available" }, { status: 404 });

  let pincode: string;
  let skip = false;
  if (isForm) {
    const form = await req.formData();
    pincode = String(form.get("pincode") ?? "").trim();
    skip = form.get("skip") !== null;
  } else {
    const body = (await req.json().catch(() => null)) as { pincode?: unknown } | null;
    pincode = typeof body?.pincode === "string" ? body.pincode.trim() : "";
  }

  if (skip) {
    // "Continue with standard prices": remembered for this browser session only.
    const res = NextResponse.redirect(backTo(req, host), 303);
    res.cookies.set({ ...COOKIE_BASE, name: STATE_SKIP_COOKIE, value: "1" });
    return res;
  }

  if (!/^[1-9][0-9]{5}$/.test(pincode)) return fail("Enter a valid 6-digit pincode", 400);
  const state = await lookupStateByPincode(rt, pincode);
  if (!state) return fail("We could not match that pincode. Please check it and try again.", 404);

  const res = isForm ? NextResponse.redirect(backTo(req, host), 303) : NextResponse.json({ state, stateName: IN_STATE_NAMES[state] });
  res.cookies.set({ ...COOKIE_BASE, name: STATE_COOKIE, value: state, maxAge: 365 * 24 * 3600 });
  return res;
}
