import { NextResponse } from "next/server";
import { evaluateStorefrontAccess, applyCartDiscount, getOrCreateCart, checkStorefrontRateLimit, RateLimitExceededError } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CART_COOKIE_MAX_AGE, CART_COOKIE_NAME, getCookieValue, getRequestHeaders } from "../../api/storefront/cart/route.ts";

/** Only a path on this store: never another site, never a protocol-relative `//host`. */
function safePath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/cart";
  return raw;
}

/**
 * A shareable discount link (`/discount/DIWALI20?to=/products/pickle`). It puts the code on the shopper's cart, keeping
 * it for later when the cart is still empty, then sends them on. A code that is not valid is simply not applied: the
 * shopper still lands where the link points, and the cart says why when they try it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode).trim().slice(0, 64);
  const to = safePath(new URL(req.url).searchParams.get("to"));
  const h = await getRequestHeaders(req);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const redirect = (token?: string) => {
    const res = NextResponse.redirect(new URL(to, `${h.get("x-forwarded-proto") ?? "https"}://${host}`));
    if (token) {
      res.cookies.set({
        name: CART_COOKIE_NAME,
        value: token,
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: CART_COOKIE_MAX_AGE,
      });
    }
    return res;
  };

  try {
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId || !code) return redirect();
    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) return redirect();
      throw err;
    }
    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };
    const existing = await getCookieValue(CART_COOKIE_NAME, req);
    const cart = await getOrCreateCart(rt, tenantCtx, existing);
    await applyCartDiscount(rt, tenantCtx, { token: cart.token, code, allowEmpty: true }).catch(() => null);
    return redirect(cart.token);
  } catch {
    return redirect();
  }
}
