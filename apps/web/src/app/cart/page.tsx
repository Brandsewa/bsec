import React from "react";
import type { Metadata } from "next";
import { headers, cookies } from "next/headers";
import { evaluateStorefrontAccess, getFreeShippingThresholdPaise, getOrCreateCart } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CartView, DEFAULT_CART_CONTENTS_OPTIONS } from "@/components/cart/CartView.tsx";
import { BlockRenderer } from "@/components/blocks/BlockRenderer.tsx";
import { getCachedThemePage } from "@/server/cached-storefront.ts";
import { CART_COOKIE_NAME } from "@/app/api/storefront/cart/route.ts";

export const metadata: Metadata = {
  title: "Shopping Cart",
  description: "View and edit items in your shopping cart.",
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });

  if (!access.tenantId) {
    return (
      <CartView
        cart={{
          id: "",
          token: "",
          currency: "INR",
          items: [],
          itemCount: 0,
          subtotal: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }}
      />
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

  const cookieStore = await cookies();
  const token = cookieStore.get(CART_COOKIE_NAME)?.value;

  const cart = await getOrCreateCart(rt, tenantCtx, token);

  // The theme's own cart layout, when the store has one; the built-in layout otherwise.
  const template = await getCachedThemePage(access.tenantId, "cart").catch(() => null);
  const freeShippingThresholdPaise = await getFreeShippingThresholdPaise(rt._db.db, access.tenantId).catch(() => null);
  if (!template) {
    // The built-in layout shows the free-shipping progress bar whenever the store has a free-shipping threshold.
    return (
      <div className="bs-skin">
        <CartView
          cart={cart}
          options={{ ...DEFAULT_CART_CONTENTS_OPTIONS, showFreeShippingBar: true }}
          freeShippingThresholdPaise={freeShippingThresholdPaise}
        />
      </div>
    );
  }
  return (
    <div className="bs-skin">
      <BlockRenderer
        blocks={template.blocks}
        renderData={template.renderData}
        context={{ renderCartContents: (options) => <CartView cart={cart} options={options} freeShippingThresholdPaise={freeShippingThresholdPaise} /> }}
      />
    </div>
  );
}
