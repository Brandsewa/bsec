import React from "react";
import type { Metadata } from "next";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { evaluateStorefrontAccess, getOrCreateCart } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { CheckoutContainer } from "@/components/checkout/CheckoutContainer.tsx";
import { CART_COOKIE_NAME } from "@/app/api/storefront/cart/route.ts";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Secure Checkout",
};

export default async function CheckoutPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });

  if (!access.tenantId) {
    redirect("/cart");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(CART_COOKIE_NAME)?.value;

  if (!token) {
    redirect("/cart");
  }

  const tenantCtx = {
    tenantId: access.tenantId,
    storeStatus: access.mode ?? "live",
    actor: { type: "system" as const },
    roles: ["store_admin"],
    permissions: ["products.read"],
    requestId: crypto.randomUUID(),
  };

  const cart = await getOrCreateCart(rt, tenantCtx, token);

  if (!cart.items || cart.items.length === 0) {
    redirect("/cart");
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mb-8">
        Checkout
      </h1>

      <CheckoutContainer cart={cart} />
    </div>
  );
}
