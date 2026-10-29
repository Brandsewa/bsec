import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerOrderDetail, getCustomerReturnableOrders, getCustomerReturns, readTrackingConfig } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { buttonVariants } from "@bs/ui/server";
import { OrderDetailLayout } from "@/components/orders/OrderDetailLayout.tsx";
import { describeReturnStatus } from "@/components/account/return-labels.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await accountContext();
  if (!ctx) return null;
  if (!UUID.test(id)) notFound();
  const order = await getCustomerOrderDetail(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, id);
  if (!order) notFound();
  const trackingConfig = await readTrackingConfig(ctx.store.rt._db.db, ctx.store.tenantId);

  // Returns have their own section; this page only points into it
  const [eligible, myReturns] = await Promise.all([
    getCustomerReturnableOrders(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id),
    getCustomerReturns(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id),
  ]);
  const canReturn = eligible.orders.some((o) => o.orderId === order.id);
  const returnsHere = myReturns.filter((r) => r.orderId === order.id);

  return (
    <div>
      <Link href="/account/orders" className="mb-4 inline-block text-sm font-semibold text-[var(--brand-ink)] transition-opacity hover:opacity-70">
        ← All orders
      </Link>
      <OrderDetailLayout
        order={order}
        trackingConfig={trackingConfig}
        headerAside={
          canReturn || returnsHere.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              {returnsHere.map((r) => (
                <Link key={r.id} href={`/account/returns/${r.id}`} className="text-xs font-semibold text-[var(--brand-ink)] hover:opacity-70">
                  {r.number} · {describeReturnStatus(r.status).label}
                </Link>
              ))}
              {canReturn ? (
                <Link href={`/account/returns?request=${order.id}`} className={buttonVariants({ variant: "secondary", size: "md" })}>
                  Request a return
                </Link>
              ) : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}
