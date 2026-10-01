import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, getAddressUpdateView } from "@bs/domain";
import { AddressCorrectionForm } from "@/components/account/AddressCorrectionForm.tsx";
import { server } from "@/server/runtime.ts";

export const metadata: Metadata = {
  title: "Update Delivery Address",
  description: "Correct the delivery address on your order",
  robots: { index: false, follow: false },
};

export default async function AddressUpdatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });
  if (!access.tenantId) notFound();

  const view = await getAddressUpdateView(rt._db.db, access.tenantId, token);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 space-y-5">
        <h1 className="text-2xl font-extrabold text-foreground">Delivery address</h1>
        {!view ? (
          <p className="text-sm text-muted-foreground" data-testid="address-invalid">
            This link is not valid or has expired. Please contact the store if you need to change where your order is
            delivered.
          </p>
        ) : !view.editable ? (
          <p className="text-sm text-muted-foreground" data-testid="address-locked">
            Order <span className="font-medium text-foreground">{view.orderNumber}</span> has already been handed over for
            delivery (or is closed), so the address can no longer be changed here. Please contact the store for help.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Fix the delivery address for order <span className="font-medium text-foreground">{view.orderNumber}</span>.
              You can change it until it is handed to the courier.
            </p>
            <AddressCorrectionForm token={token} initial={view.address} />
          </>
        )}
        <div className="border-t border-border pt-4">
          <Link href={`/`} className="text-sm font-medium text-primary hover:underline">
            ← Back to the store
          </Link>
        </div>
      </div>
    </div>
  );
}
