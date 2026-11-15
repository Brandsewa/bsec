import { NextResponse } from "next/server";
import { getMarketContext } from "@/server/market.ts";
import { z } from "zod";
import {
  evaluateStorefrontAccess,
  getOrCreateCart,
  addToCart,
  updateCartItemQuantity,
  removeCartItem,
  checkStorefrontRateLimit,
  RateLimitExceededError,
  recordAnalyticsEvent,
  recordServerEvent,
  getClientIp,
} from "@bs/domain";
import { toMajorUnits } from "@bs/contracts/money";
import { server } from "@/server/runtime.ts";
import { CART_COOKIE_NAME, CART_COOKIE_MAX_AGE, getRequestHeaders, getCookieValue } from "../route.ts";

const AddItemSchema = z.object({
  token: z.string().optional(),
  variantId: z.string().min(1, "variantId is required"),
  quantity: z.number().int().positive("quantity must be positive"),
  properties: z.record(z.string(), z.unknown()).optional(),
});

const UpdateItemSchema = z.object({
  itemId: z.string().min(1, "itemId is required"),
  quantity: z.number().int().min(0, "quantity must be non-negative"),
});

const RemoveItemSchema = z.object({
  itemId: z.string().min(1, "itemId is required"),
});

export async function POST(req: Request) {
  try {
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json(
          { error: err.message },
          { status: 429, headers: { "Retry-After": String(err.retryAfter) } },
        );
      }
      throw err;
    }

    const json = await req.json().catch(() => ({}));
    const parsed = AddItemSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    const cookieToken = await getCookieValue(CART_COOKIE_NAME, req);
    let token = parsed.data.token || cookieToken;

    const marketCtx = await getMarketContext(access.tenantId);
    const marketId = marketCtx.marketId;
    // Creates the cart in the shopper's market, or moves an existing one there, so the price added is the price shown.
    const initialCart = await getOrCreateCart(rt, { ...tenantCtx, priceRegion: marketCtx.region }, token || undefined, undefined, marketId);
    token = initialCart.token;

    const cart = await addToCart(rt, tenantCtx, {
      token,
      variantId: parsed.data.variantId,
      quantity: parsed.data.quantity,
      properties: parsed.data.properties,
    });

    // Funnel event recorded on the server (ADR-047): no client JavaScript, and it never delays or fails the add to cart.
    const analyticsSecret = process.env.BETTER_AUTH_SECRET;
    if (analyticsSecret && (access.mode ?? "live") === "live") {
      let path = "/";
      try {
        path = new URL(h.get("referer") ?? "").pathname;
      } catch {
        // no usable referer: keep "/"
      }
      void recordAnalyticsEvent(
        rt,
        access.tenantId,
        {
          type: "add_to_cart",
          path,
          ip: getClientIp(h),
          userAgent: h.get("user-agent") ?? "",
          country: h.get("cf-ray") ? h.get("cf-ipcountry") : null,
          doNotTrack: h.get("sec-gpc") === "1" || h.get("dnt") === "1",
        },
        { secret: analyticsSecret },
      ).catch(() => undefined);
    }

    // Meta Conversions API AddToCart (ADR-047, slice 5c): only for visitors who accepted marketing cookies and stores that saved a token.
    // The id goes back to the browser so its pixel event and this one count once.
    let analyticsEventId: string | null = null;
    const added = cart.items.find((i) => i.variantId === parsed.data.variantId);
    if (added && (access.mode ?? "live") === "live") {
      const price = toMajorUnits(added.unitPriceSnapshot, cart.currency);
      analyticsEventId = await recordServerEvent(rt, access.tenantId, {
        name: "AddToCart",
        eventId: `atc_${crypto.randomUUID()}`,
        currency: cart.currency,
        value: Math.round(price * parsed.data.quantity * 100) / 100,
        items: [{ id: added.variant.sku?.trim() || added.variantId, quantity: parsed.data.quantity, price }],
        req: { cookieHeader: h.get("cookie"), ip: getClientIp(h), userAgent: h.get("user-agent"), sourceUrl: h.get("referer") },
      });
    }

    const response = NextResponse.json({
      cart,
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
      ...(analyticsEventId ? { analyticsEventId } : {}),
    });

    response.cookies.set({
      name: CART_COOKIE_NAME,
      value: cart.token,
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: CART_COOKIE_MAX_AGE,
    });

    response.cookies.set({
      name: "bs_cart_count",
      value: String(cart.itemCount),
      path: "/",
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: CART_COOKIE_MAX_AGE,
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error adding item to cart";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json(
          { error: err.message },
          { status: 429, headers: { "Retry-After": String(err.retryAfter) } },
        );
      }
      throw err;
    }

    const json = await req.json().catch(() => ({}));
    const parsed = UpdateItemSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const token = await getCookieValue(CART_COOKIE_NAME, req);
    if (!token) {
      return NextResponse.json({ error: "Cart token not found" }, { status: 400 });
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    const cart = await updateCartItemQuantity(rt, tenantCtx, {
      token,
      itemId: parsed.data.itemId,
      quantity: parsed.data.quantity,
    });

    const response = NextResponse.json({
      cart,
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
    });

    response.cookies.set({
      name: "bs_cart_count",
      value: String(cart.itemCount),
      path: "/",
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: CART_COOKIE_MAX_AGE,
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error updating cart item";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const h = await getRequestHeaders(req);
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });

    if (!access.tenantId) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    try {
      await checkStorefrontRateLimit(rt._db.db, access.tenantId);
    } catch (err: unknown) {
      if (err instanceof RateLimitExceededError) {
        return NextResponse.json(
          { error: err.message },
          { status: 429, headers: { "Retry-After": String(err.retryAfter) } },
        );
      }
      throw err;
    }

    const json = await req.json().catch(() => ({}));
    const parsed = RemoveItemSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const token = await getCookieValue(CART_COOKIE_NAME, req);
    if (!token) {
      return NextResponse.json({ error: "Cart token not found" }, { status: 400 });
    }

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    const cart = await removeCartItem(rt, tenantCtx, {
      token,
      itemId: parsed.data.itemId,
    });

    const response = NextResponse.json({
      cart,
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
    });

    response.cookies.set({
      name: "bs_cart_count",
      value: String(cart.itemCount),
      path: "/",
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: CART_COOKIE_MAX_AGE,
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error removing cart item";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
