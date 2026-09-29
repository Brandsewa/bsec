import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { evaluateStorefrontAccess, getOrCreateCart } from "@bs/domain";
import { server } from "@/server/runtime.ts";

export const CART_COOKIE_NAME = "bs_cart_token";
export const CART_COOKIE_MAX_AGE = 30 * 24 * 3600; // 30 days in seconds

export async function getRequestHeaders(req?: Request): Promise<Headers> {
  try {
    return await headers();
  } catch {
    return req?.headers ?? new Headers();
  }
}

export async function getCookieValue(name: string, req?: Request): Promise<string | undefined> {
  try {
    const cookieStore = await cookies();
    const val = cookieStore.get(name)?.value;
    if (val) return val;
  } catch {
    // outside request scope
  }
  if (req) {
    const cookieHeader = req.headers.get("cookie") ?? "";
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return undefined;
}

export async function GET(req: Request) {
  try {
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    const existingToken = await getCookieValue(CART_COOKIE_NAME, req);
    const cart = await getOrCreateCart(rt, tenantCtx, existingToken);

    const response = NextResponse.json({
      cart,
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
    });

    // If new token created or cookie not set to current token, set cookie
    if (!existingToken || existingToken !== cart.token) {
      response.cookies.set({
        name: CART_COOKIE_NAME,
        value: cart.token,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: CART_COOKIE_MAX_AGE,
      });
    }

    // Also update non-httpOnly bs_cart_count for fast client-side badge hydration
    response.cookies.set({
      name: "bs_cart_count",
      value: String(cart.itemCount),
      path: "/",
      sameSite: "lax",
      maxAge: CART_COOKIE_MAX_AGE,
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error getting cart";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
