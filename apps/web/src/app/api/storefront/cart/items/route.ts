import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateStorefrontAccess,
  getOrCreateCart,
  addToCart,
  updateCartItemQuantity,
  removeCartItem,
} from "@bs/domain";
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

    if (!token) {
      const initialCart = await getOrCreateCart(rt, tenantCtx);
      token = initialCart.token;
    }

    const cart = await addToCart(rt, tenantCtx, {
      token,
      variantId: parsed.data.variantId,
      quantity: parsed.data.quantity,
      properties: parsed.data.properties,
    });

    const response = NextResponse.json({
      cart,
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
    });

    response.cookies.set({
      name: CART_COOKIE_NAME,
      value: cart.token,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: CART_COOKIE_MAX_AGE,
    });

    response.cookies.set({
      name: "bs_cart_count",
      value: String(cart.itemCount),
      path: "/",
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
      sameSite: "lax",
      maxAge: CART_COOKIE_MAX_AGE,
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error removing cart item";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
