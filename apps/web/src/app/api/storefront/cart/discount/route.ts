import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateStorefrontAccess,
  applyCartDiscount,
  removeCartDiscount,
  checkStorefrontRateLimit,
  RateLimitExceededError,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CART_COOKIE_NAME, getRequestHeaders, getCookieValue } from "../route.ts";

const ApplySchema = z.object({ code: z.string().trim().min(1, "Enter a discount code").max(64) });

/** Resolves the store and the shopper's cart token, or the response to send instead. */
async function resolveStoreAndCart(req: Request) {
  const h = await getRequestHeaders(req);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) return { error: NextResponse.json({ error: "Store not found" }, { status: 404 }) } as const;

  try {
    await checkStorefrontRateLimit(rt._db.db, access.tenantId);
  } catch (err: unknown) {
    if (err instanceof RateLimitExceededError) {
      return { error: NextResponse.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfter) } }) } as const;
    }
    throw err;
  }

  const token = await getCookieValue(CART_COOKIE_NAME, req);
  if (!token) return { error: NextResponse.json({ error: "Your cart is empty" }, { status: 400 }) } as const;

  const tenantCtx = {
    tenantId: access.tenantId,
    storeStatus: access.mode ?? "live",
    actor: { type: "system" as const },
    roles: ["store_admin"],
    permissions: ["products.read"],
    requestId: crypto.randomUUID(),
  };
  return { rt, tenantCtx, token } as const;
}

function failure(err: unknown) {
  const raw = err instanceof Error ? err.message : "Could not apply the code";
  const message = raw.replace(/^(Bad Request|Not Found|Conflict|Precondition):\s*/, "");
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Put a discount code on the shopper's cart. */
export async function POST(req: Request) {
  try {
    const r = await resolveStoreAndCart(req);
    if ("error" in r) return r.error;
    const parsed = ApplySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a discount code" }, { status: 400 });
    }
    const cart = await applyCartDiscount(r.rt, r.tenantCtx, { token: r.token, code: parsed.data.code });
    return NextResponse.json({ cart, itemCount: cart.itemCount, subtotal: cart.subtotal });
  } catch (err) {
    return failure(err);
  }
}

/** Take the discount code off the cart. */
export async function DELETE(req: Request) {
  try {
    const r = await resolveStoreAndCart(req);
    if ("error" in r) return r.error;
    const cart = await removeCartDiscount(r.rt, r.tenantCtx, { token: r.token });
    return NextResponse.json({ cart, itemCount: cart.itemCount, subtotal: cart.subtotal });
  } catch (err) {
    return failure(err);
  }
}
