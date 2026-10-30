import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, getOrderByActionToken, getOrderReturnsByToken, readTrackingConfig } from "@bs/domain";
import { ReturnRequestForm } from "@/components/orders/ReturnRequestForm.tsx";
import { OrderDetailLayout } from "@/components/orders/OrderDetailLayout.tsx";
import { server } from "@/server/runtime.ts";

interface OrderTrackingPageProps {
  params: Promise<{ token: string }>;
}

export const metadata: Metadata = {
  title: "Order Status",
  description: "View your order status and details",
  robots: { index: false, follow: false },
};

export default async function OrderTrackingPage({ params }: OrderTrackingPageProps) {
  const { token } = await params;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });

  if (!access.tenantId) {
    notFound();
  }

  const order = await getOrderByActionToken(rt._db.db, access.tenantId, token);
  if (!order) {
    notFound();
  }

  const returnsView = await getOrderReturnsByToken(rt, access.tenantId, token);
  const trackingConfig = await readTrackingConfig(rt._db.db, access.tenantId);
  return (
    <div className="bs-skin mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <OrderDetailLayout
        order={order}
        trackingConfig={trackingConfig}
        afterTracking={
          returnsView && (returnsView.returns.length > 0 || returnsView.canRequest) ? (
            <ReturnRequestForm
              token={token}
              items={returnsView.items}
              reasons={returnsView.reasons}
              allowExchanges={returnsView.allowExchanges}
              policyText={returnsView.policyText}
              instructions={returnsView.instructions}
              existingReturns={returnsView.returns}
            />
          ) : null
        }
      />
    </div>
  );
}
