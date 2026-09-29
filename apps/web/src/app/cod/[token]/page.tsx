import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { evaluateStorefrontAccess, confirmCodOrder } from "@bs/domain";
import { server } from "@/server/runtime.ts";

interface CodConfirmationPageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ confirmed?: string }>;
}

export const metadata: Metadata = {
  title: "Confirm Your Cash on Delivery Order",
  description: "Verify and confirm your Cash on Delivery order",
};

export default async function CodConfirmationPage({ params, searchParams }: CodConfirmationPageProps) {
  const { token } = await params;
  const sp = searchParams ? await searchParams : {};
  const isConfirmed = sp.confirmed === "true";

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";

  const { rt } = server();
  const access = await evaluateStorefrontAccess(rt, host, { headers: h });

  if (!access.tenantId) {
    notFound();
  }

  async function handleConfirm() {
    "use server";
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) notFound();

    const tenantCtx = {
      tenantId: access.tenantId,
      storeStatus: (access.mode ?? "live"),
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["products.read"],
      requestId: crypto.randomUUID(),
    };

    try {
      await confirmCodOrder(rt, tenantCtx, token);
      redirect(`/cod/${token}?confirmed=true`);
    } catch {
      redirect(`/cod/${token}?error=failed`);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8 text-center">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        {isConfirmed ? (
          <div>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-4">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Order Confirmed!</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Thank you! Your Cash on Delivery order is now confirmed and our team is preparing it for dispatch.
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Continue Shopping
            </Link>
          </div>
        ) : (
          <div>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 mb-4">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Confirm Your COD Order</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Please click the button below to confirm that you requested this Cash on Delivery order.
            </p>
            <form action={handleConfirm}>
              <button
                type="submit"
                className="w-full rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                Yes, Confirm My Order
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
