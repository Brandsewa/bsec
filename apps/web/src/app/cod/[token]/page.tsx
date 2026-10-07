import React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { evaluateStorefrontAccess, confirmCodOrder } from "@bs/domain";
import { AuthShell, Button } from "@bs/ui";
import { getCachedStoreName } from "@/server/cached-storefront.ts";
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

  const storeName = await getCachedStoreName(access.tenantId).catch(() => "Store");

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
    <AuthShell
      variant="store"
      brand={{ name: storeName }}
      title={isConfirmed ? "Order Confirmed!" : "Confirm Your COD Order"}
      description={
        isConfirmed
          ? "Thank you! Your Cash on Delivery order is now confirmed and our team is preparing it for dispatch."
          : "Please confirm that you requested this Cash on Delivery order."
      }
      footer={
        <Link href="/" className="text-xs text-[var(--brand-ink)] hover:underline">
          ← Return to store
        </Link>
      }
    >
      {isConfirmed ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--success-soft)] text-[var(--success)]">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <Button asChild size="md" className="w-full">
            <Link href="/">Continue Shopping</Link>
          </Button>
        </div>
      ) : (
        <form action={handleConfirm} className="space-y-4">
          <Button type="submit" size="md" className="w-full">
            Yes, Confirm My Order
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
