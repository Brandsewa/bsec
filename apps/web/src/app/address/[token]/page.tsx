import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateStorefrontAccess, getAddressUpdateView } from "@bs/domain";
import { AuthShell } from "@bs/ui";
import { AddressCorrectionForm } from "@/components/account/AddressCorrectionForm.tsx";
import { getCachedStoreName } from "@/server/cached-storefront.ts";
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

  const storeName = await getCachedStoreName(access.tenantId).catch(() => "Store");
  const view = await getAddressUpdateView(rt._db.db, access.tenantId, token);

  return (
    <AuthShell
      variant="store"
      brand={{ name: storeName }}
      title="Delivery address"
      description={view ? `Order ${view.orderNumber}` : ""}
      footer={
        <Link href="/" className="text-xs text-[var(--brand-ink)] hover:underline">
          ← Back to the store
        </Link>
      }
    >
      {!view ? (
        <p className="text-xs text-[var(--muted-foreground)] leading-relaxed" data-testid="address-invalid">
          This link is not valid or has expired. Please contact the store if you need to change where your order is
          delivered.
        </p>
      ) : !view.editable ? (
        <p className="text-xs text-[var(--muted-foreground)] leading-relaxed" data-testid="address-locked">
          Order <span className="font-semibold text-[var(--foreground)]">{view.orderNumber}</span> has already been handed over for
          delivery (or is closed), so the address can no longer be changed here. Please contact the store for help.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
            Fix the delivery address for order <span className="font-semibold text-[var(--foreground)]">{view.orderNumber}</span>.
            You can change it until it is handed to the courier.
          </p>
          <AddressCorrectionForm token={token} initial={view.address} />
        </div>
      )}
    </AuthShell>
  );
}
